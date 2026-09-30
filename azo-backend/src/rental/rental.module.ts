import { Body, Controller, Get, Injectable, Module, Post, UseGuards } from "@nestjs/common";
import { IsInt, IsString } from "class-validator";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";

class BookDto {
  @IsString() vehicleModel: string;
  @IsString() formula: string; // "day" | "4h" | "week"
  @IsInt() pricePerDay: number;
}

// Catalogue statique pour démarrer — à remplacer par une table Vehicle gérée par les loueurs
const CATALOG = [
  { id: "corolla", name: "Toyota Corolla Prestige", pricePerDay: 28000, seats: 4 },
  { id: "tucson", name: "Hyundai Tucson SUV Confort", pricePerDay: 35000, seats: 5 },
];

@Injectable()
export class RentalService {
  constructor(private prisma: PrismaService) {}
  catalog() { return CATALOG; }
  book(clientId: string, dto: BookDto) { return this.prisma.rentalBooking.create({ data: { ...dto, clientId } }); }
  mine(clientId: string) { return this.prisma.rentalBooking.findMany({ where: { clientId }, orderBy: { createdAt: "desc" } }); }
}

@Controller("rentals")
@UseGuards(JwtAuthGuard)
export class RentalController {
  constructor(private svc: RentalService) {}
  @Get("catalog") catalog() { return this.svc.catalog(); }
  @Post() book(@CurrentUser() u, @Body() dto: BookDto) { return this.svc.book(u.userId, dto); }
  @Get("mine") mine(@CurrentUser() u) { return this.svc.mine(u.userId); }
}

@Module({ controllers: [RentalController], providers: [RentalService] })
export class RentalModule {}
