import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RegistrationCompleteGuard } from "../common/guards/registration-complete.guard";

export const RENTAL_FORMULAS = ["4h", "day", "week"] as const;
export type RentalFormula = (typeof RENTAL_FORMULAS)[number];

/** Le client choisit un véhicule du catalogue et une formule : le PRIX est calculé ici, jamais envoyé par le client. */
export class BookDto {
  @IsString() @MaxLength(64) vehicleId: string;
  @IsIn(RENTAL_FORMULAS as unknown as string[]) formula: RentalFormula;
  /** Nombre de jours, pour la formule « day » uniquement (1 par défaut). */
  @IsOptional() @IsInt() @Min(1) @Max(30) days?: number;
}

export class VehicleDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsInt() @Min(1) @Max(60) seats: number;
  @IsInt() @Min(1000) @Max(5_000_000) pricePerDay: number;
  @IsOptional() @IsInt() @Min(1000) @Max(5_000_000) price4h?: number | null;
  @IsOptional() @IsInt() @Min(1000) @Max(20_000_000) priceWeek?: number | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

type VehicleRow = {
  id: string; name: string; seats: number; pricePerDay: number; price4h: number | null; priceWeek: number | null; active: boolean;
};

/** Formules réellement proposées pour ce véhicule, avec leur prix (une formule sans prix n'est pas proposée). */
export function vehicleFormulas(v: Pick<VehicleRow, "pricePerDay" | "price4h" | "priceWeek">) {
  return [
    ...(v.price4h ? [{ id: "4h" as const, price: v.price4h }] : []),
    { id: "day" as const, price: v.pricePerDay },
    ...(v.priceWeek ? [{ id: "week" as const, price: v.priceWeek }] : []),
  ];
}

/** Prix total d'une réservation, calculé côté serveur. */
export function rentalPrice(v: Pick<VehicleRow, "pricePerDay" | "price4h" | "priceWeek">, formula: RentalFormula, days = 1): number {
  if (formula === "4h") {
    if (!v.price4h) throw new BadRequestException("La formule « 4 heures » n'est pas proposée pour ce véhicule.");
    return v.price4h;
  }
  if (formula === "week") {
    if (!v.priceWeek) throw new BadRequestException("La formule « semaine » n'est pas proposée pour ce véhicule.");
    return v.priceWeek;
  }
  return v.pricePerDay * Math.max(1, Math.trunc(days));
}

@Injectable()
export class RentalService {
  constructor(private prisma: PrismaService) {}

  async catalog() {
    const vehicles = await this.prisma.rentalVehicle.findMany({ where: { active: true }, orderBy: { pricePerDay: "asc" } });
    return vehicles.map((v) => ({
      id: v.id, name: v.name, seats: v.seats, pricePerDay: v.pricePerDay, price4h: v.price4h, priceWeek: v.priceWeek,
      formulas: vehicleFormulas(v),
    }));
  }

  async book(clientId: string, dto: BookDto) {
    const vehicle = await this.prisma.rentalVehicle.findUnique({ where: { id: dto.vehicleId } });
    if (!vehicle || !vehicle.active) throw new NotFoundException("Véhicule indisponible");
    const totalPrice = rentalPrice(vehicle, dto.formula, dto.days ?? 1);
    return this.prisma.rentalBooking.create({
      data: {
        clientId,
        vehicleId: vehicle.id,
        vehicleModel: vehicle.name,
        formula: dto.formula,
        pricePerDay: vehicle.pricePerDay,
        totalPrice,
      },
    });
  }

  mine(clientId: string) {
    return this.prisma.rentalBooking.findMany({ where: { clientId }, orderBy: { createdAt: "desc" } });
  }

  /* ---- Administrateur : gestion du catalogue ---- */
  adminList() {
    return this.prisma.rentalVehicle.findMany({ orderBy: { createdAt: "asc" } });
  }

  adminCreate(dto: VehicleDto) {
    return this.prisma.rentalVehicle.create({
      data: {
        name: dto.name.trim(), seats: dto.seats, pricePerDay: dto.pricePerDay,
        price4h: dto.price4h ?? null, priceWeek: dto.priceWeek ?? null, active: dto.active ?? true,
      },
    });
  }

  async adminUpdate(id: string, dto: VehicleDto) {
    const existing = await this.prisma.rentalVehicle.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException("Véhicule introuvable");
    return this.prisma.rentalVehicle.update({
      where: { id },
      data: {
        name: dto.name.trim(), seats: dto.seats, pricePerDay: dto.pricePerDay,
        price4h: dto.price4h ?? null, priceWeek: dto.priceWeek ?? null, ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
  }
}

@Controller("rentals")
@UseGuards(JwtAuthGuard)
export class RentalController {
  constructor(private svc: RentalService) {}

  @Get("catalog")
  catalog() {
    return this.svc.catalog();
  }

  @Post()
  @UseGuards(RegistrationCompleteGuard)
  book(@CurrentUser() u, @Body() dto: BookDto) {
    return this.svc.book(u.userId, dto);
  }

  @Get("mine")
  mine(@CurrentUser() u) {
    return this.svc.mine(u.userId);
  }
}

@Controller("admin/rentals")
@UseGuards(JwtAuthGuard, RolesGuard)
export class RentalAdminController {
  constructor(private svc: RentalService) {}

  // GET /admin/rentals/vehicles — tout le catalogue, actifs ou non
  @Get("vehicles")
  @Roles(Role.ADMIN)
  list() {
    return this.svc.adminList();
  }

  @Post("vehicles")
  @Roles(Role.ADMIN)
  create(@Body() dto: VehicleDto) {
    return this.svc.adminCreate(dto);
  }

  // PUT /admin/rentals/vehicles/:id — modifie prix, places ou désactive (active: false)
  @Put("vehicles/:id")
  @Roles(Role.ADMIN)
  update(@Param("id") id: string, @Body() dto: VehicleDto) {
    return this.svc.adminUpdate(id, dto);
  }
}

@Module({ controllers: [RentalController, RentalAdminController], providers: [RentalService] })
export class RentalModule {}
