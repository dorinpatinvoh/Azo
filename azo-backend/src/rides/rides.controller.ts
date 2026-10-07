import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from "class-validator";
import { Type } from "class-transformer";
import { Role } from "@prisma/client";
import { RidesService } from "./rides.service";
import { CreateRideDto } from "./dto/create-ride.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";

/**
 * Position optionnelle du chauffeur, transmise quand il ouvre son radar
 * (`GET /rides/pending?lat=…&lng=…`). Sans elle, le radar reste utilisable : aucune
 * demande n'est écartée et le classement se fait du plus ancien au plus récent.
 */
class RadarQueryDto {
  @IsOptional() @Type(() => Number) @Min(-90) @Max(90) lat?: number;
  @IsOptional() @Type(() => Number) @Min(-180) @Max(180) lng?: number;

  /** Position complète uniquement : une latitude sans longitude est ignorée. */
  position(): { latitude: number; longitude: number } | undefined {
    if (typeof this.lat !== "number" || typeof this.lng !== "number") return undefined;
    if (!Number.isFinite(this.lat) || !Number.isFinite(this.lng)) return undefined;
    return { latitude: this.lat, longitude: this.lng };
  }
}

class RateDto {
  @IsInt() @Min(1) @Max(5) stars: number;
}

class StartRideDto {
  @IsString()
  @Length(4, 4)
  @Matches(/^\d{4}$/)
  pin: string;
}

class SendChatDto {
  @IsString()
  @MaxLength(300)
  text: string;

  @IsOptional()
  @IsString()
  senderRole?: "CLIENT" | "PROVIDER";

  @IsOptional()
  @IsString()
  @MaxLength(40)
  senderName?: string;
}

@Controller("rides")
@UseGuards(JwtAuthGuard, RolesGuard)
export class RidesController {
  constructor(private rides: RidesService) {}

  // POST /rides/estimate  -> prix + durée avant confirmation
  @Post("estimate")
  estimate(@Body() dto: CreateRideDto) {
    return this.rides.estimate(dto);
  }

  // POST /rides  -> le client confirme sa demande
  @Post()
  @Roles(Role.CLIENT)
  create(@CurrentUser() user, @Body() dto: CreateRideDto) {
    return this.rides.create(user.userId, dto);
  }

  // GET /rides/history
  @Get("history")
  history(@CurrentUser() user) {
    return this.rides.history(user.userId);
  }

  // GET /rides/pending?lat=…&lng=…  -> courses à prendre (chauffeurs), filtrées sur leur
  // véhicule puis sur le rayon de recherche autour de la position transmise.
  @Get("pending")
  @Roles(Role.DRIVER)
  pending(@CurrentUser() user, @Query() query: RadarQueryDto) {
    return this.rides.pending(user.userId, query.position());
  }

  @Post(":id/accept")
  @Roles(Role.DRIVER)
  accept(@Param("id") id: string, @CurrentUser() user) {
    return this.rides.accept(id, user.userId);
  }

  @Post(":id/arrive")
  @Roles(Role.DRIVER)
  arrive(@Param("id") id: string, @CurrentUser() user) {
    return this.rides.arrive(id, user.userId);
  }

  @Post(":id/start")
  @Roles(Role.DRIVER)
  start(@Param("id") id: string, @CurrentUser() user, @Body() dto?: StartRideDto) {
    return this.rides.start(id, user.userId, dto?.pin);
  }

  @Post(":id/complete")
  @Roles(Role.DRIVER)
  complete(@Param("id") id: string, @CurrentUser() user) {
    return this.rides.complete(id, user.userId);
  }

  // POST /rides/:id/rate  { "stars": 5 }
  @Post(":id/rate")
  @Roles(Role.CLIENT)
  rate(@Param("id") id: string, @CurrentUser() user, @Body() dto: RateDto) {
    return this.rides.rate(id, user.userId, dto.stars);
  }

  // POST /rides/:id/cancel -> ouvert au client concerné ET au chauffeur assigné
  @Post(":id/cancel")
  cancel(@Param("id") id: string, @CurrentUser() user) {
    return this.rides.cancel(id, user.userId);
  }

  // GET /rides/:id/messages -> Messagerie sécurisée in-app (course ou livraison)
  @Get(":id/messages")
  getMessages(@Param("id") id: string) {
    return this.rides.getMessages(id);
  }

  // POST /rides/:id/messages -> Envoyer un message sécurisé in-app
  @Post(":id/messages")
  sendMessage(@Param("id") id: string, @CurrentUser() user, @Body() dto: SendChatDto) {
    return this.rides.sendMessage(id, user, dto);
  }

  // GET /rides/:id  -> déclaré en DERNIER pour ne pas masquer /history et /pending
  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user) {
    return this.rides.findOne(id, user.userId);
  }
}
