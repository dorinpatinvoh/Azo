import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from "@nestjs/common";
import { IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, ValidateIf } from "class-validator";
import { Type } from "class-transformer";
import { Role } from "@prisma/client";
import { RidesService } from "./rides.service";
import { TipsService } from "./tips.service";
import { MessagesService } from "./messages.service";
import { CreateRideDto } from "./dto/create-ride.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RegistrationCompleteGuard } from "../common/guards/registration-complete.guard";

/**
 * Position optionnelle du chauffeur, transmise quand il ouvre son radar
 * (`GET /rides/pending?lat=…&lng=…`). Sans elle, le radar reste utilisable : aucune
 * demande n'est écartée et le classement se fait du plus ancien au plus récent.
 */
class RadarQueryDto {
  @IsOptional() @Type(() => Number) @Min(-90) @Max(90) lat?: number;
  @IsOptional() @Type(() => Number) @Min(-180) @Max(180) lng?: number;
  /** Rayon de recherche explicite en km. Défaut : radar.nearbyRadiusKm (10 km). */
  @IsOptional() @Type(() => Number) @Min(1) @Max(50) radiusKm?: number;

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

// Code d'arrivée : l'app l'envoie sous le nom `pin` (comme pour /start) ; `code` est accepté
// aussi. L'un des deux est obligatoire, au format 4 chiffres.
class CompleteRideDto {
  @ValidateIf((o) => o.code !== undefined || o.pin === undefined)
  @IsString()
  @Length(4, 4)
  @Matches(/^\d{4}$/)
  code?: string;

  @ValidateIf((o) => o.pin !== undefined)
  @IsString()
  @Length(4, 4)
  @Matches(/^\d{4}$/)
  pin?: string;
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

class SendTipDto {
  @IsInt()
  @Min(1)
  amount: number;
}

class GetMessagesQueryDto {
  @IsOptional()
  @IsString()
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsString()
  scope?: "ride" | "peer";
}

@Controller("rides")
@UseGuards(JwtAuthGuard, RolesGuard)
export class RidesController {
  constructor(
    private rides: RidesService,
    private tips: TipsService,
    private messages: MessagesService,
  ) {}

  // POST /rides/estimate  -> prix + durée avant confirmation
  @Post("estimate")
  estimate(@Body() dto: CreateRideDto) {
    return this.rides.estimate(dto);
  }

  // POST /rides  -> le client confirme sa demande
  @Post()
  @UseGuards(RegistrationCompleteGuard)
  @Roles(Role.CLIENT)
  create(@CurrentUser() user, @Body() dto: CreateRideDto) {
    return this.rides.create(user.userId, dto);
  }

  // GET /rides/history
  @Get("history")
  history(@CurrentUser() user) {
    return this.rides.history(user.userId);
  }

  // GET /rides/pending/summary?lat=…&lng=…&radiusKm=10  — compteur radar (DOIT être avant /pending)
  @Get("pending/summary")
  @Roles(Role.DRIVER)
  async pendingSummary(@CurrentUser() user, @Query() query: RadarQueryDto) {
    const position = query.position();
    if (!position) throw new BadRequestException("Position requise (lat et lng)");
    return this.rides.pendingSummary(user.userId, position);
  }

  // GET /rides/pending?lat=…&lng=…&radiusKm=10  -> courses à prendre (chauffeurs)
  @Get("pending")
  @Roles(Role.DRIVER)
  pending(@CurrentUser() user, @Query() query: RadarQueryDto) {
    return this.rides.pending(user.userId, query.position(), query.radiusKm);
  }

  @Get(":id/route")
  route(@Param("id") id: string, @CurrentUser() user, @Query("stage") stage?: string) {
    return this.rides.route(id, user.userId, stage);
  }

  @Post(":id/stop-request")
  requestStop(@Param("id") id: string, @CurrentUser() user) {
    return this.rides.requestStop(id, user.userId);
  }

  @Post(":id/stop-accept")
  acceptStop(@Param("id") id: string, @CurrentUser() user) {
    return this.rides.acceptStop(id, user.userId);
  }

  @Post(":id/stop-decline")
  declineStop(@Param("id") id: string, @CurrentUser() user) {
    return this.rides.declineStop(id, user.userId);
  }

  @Post(":id/stop-cancel")
  cancelStop(@Param("id") id: string, @CurrentUser() user) {
    return this.rides.cancelStop(id, user.userId);
  }

  @Post(":id/accept")
  @Roles(Role.DRIVER)
  accept(@Param("id") id: string, @CurrentUser() user) {
    return this.rides.accept(id, user.userId);
  }

  /** Client confirme la proposition du Zem → MATCHED */
  @Post(":id/approve-driver")
  @Roles(Role.CLIENT)
  approveDriver(@Param("id") id: string, @CurrentUser() user) {
    return this.rides.approveDriver(id, user.userId);
  }

  /** Client refuse la proposition du Zem → PENDING */
  @Post(":id/decline-driver")
  @Roles(Role.CLIENT)
  declineDriver(@Param("id") id: string, @CurrentUser() user) {
    return this.rides.declineDriver(id, user.userId);
  }

  /** Zem retire sa proposition → PENDING */
  @Post(":id/withdraw-offer")
  @Roles(Role.DRIVER)
  withdrawOffer(@Param("id") id: string, @CurrentUser() user) {
    return this.rides.withdrawOffer(id, user.userId);
  }

  /** Profil public du Zem, accessible au client de la course */
  @Get(":id/driver-profile")
  @Roles(Role.CLIENT)
  driverProfile(@Param("id") id: string, @CurrentUser() user) {
    return this.rides.driverProfile(id, user.userId);
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

  // POST /rides/:id/drop-code -> le Zem déclenche le code d'arrivée, visible du client
  @Post(":id/drop-code")
  @Roles(Role.DRIVER)
  requestDropCode(@Param("id") id: string, @CurrentUser() user) {
    return this.rides.requestDropCode(id, user.userId);
  }

  // POST /rides/:id/complete  { "pin": "1234" } (ou "code") -> le Zem saisit le code donné par le client
  @Post(":id/complete")
  @Roles(Role.DRIVER)
  complete(@Param("id") id: string, @CurrentUser() user, @Body() dto: CompleteRideDto) {
    return this.rides.complete(id, user.userId, dto.code ?? dto.pin);
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
  getMessages(@Param("id") id: string, @CurrentUser() user, @Query() query: GetMessagesQueryDto) {
    return this.messages.getMessages(id, user.userId, {
      before: query.before,
      limit: query.limit,
      scope: query.scope,
    });
  }

  // POST /rides/:id/messages -> Envoyer un message sécurisé in-app
  @Post(":id/messages")
  sendMessage(@Param("id") id: string, @CurrentUser() user, @Body() dto: SendChatDto) {
    return this.messages.sendMessage(id, user.userId, dto.text, dto.senderRole);
  }

  // POST /rides/:id/messages/read -> Marquer les messages comme lus
  @Post(":id/messages/read")
  markMessagesAsRead(@Param("id") id: string, @CurrentUser() user) {
    return this.messages.markAsRead(id, user.userId);
  }

  // POST /rides/:id/tip -> Envoyer un pourboire au Zem
  @Post(":id/tip")
  @Roles(Role.CLIENT)
  @UseGuards(RegistrationCompleteGuard)
  sendTip(
    @Param("id") id: string,
    @CurrentUser() user,
    @Body() dto: SendTipDto,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.tips.sendTip(id, user.userId, dto.amount, idempotencyKey);
  }

  // GET /rides/:id  -> déclaré en DERNIER pour ne pas masquer /history, /pending et /pending/summary
  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user) {
    return this.rides.findOne(id, user.userId);
  }
}
