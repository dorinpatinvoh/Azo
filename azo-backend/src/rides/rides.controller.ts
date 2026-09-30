import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { IsInt, Max, Min } from "class-validator";
import { Role } from "@prisma/client";
import { RidesService } from "./rides.service";
import { CreateRideDto } from "./dto/create-ride.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";

class RateDto {
  @IsInt() @Min(1) @Max(5) stars: number;
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

  // GET /rides/pending  -> courses à prendre (chauffeurs)
  @Get("pending")
  @Roles(Role.DRIVER)
  pending() {
    return this.rides.pending();
  }

  @Post(":id/accept")
  @Roles(Role.DRIVER)
  accept(@Param("id") id: string, @CurrentUser() user) {
    return this.rides.accept(id, user.userId);
  }

  @Post(":id/start")
  @Roles(Role.DRIVER)
  start(@Param("id") id: string, @CurrentUser() user) {
    return this.rides.start(id, user.userId);
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

  // GET /rides/:id  -> déclaré en DERNIER pour ne pas masquer /history et /pending
  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user) {
    return this.rides.findOne(id, user.userId);
  }
}
