import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { IsEnum, IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { Delivery, Payer, Prisma, VehicleType } from "@prisma/client";
import { haversineKm } from "../rides/radar";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { WalletModule, WalletService } from "../wallet/wallet.module";
import { NotificationsModule, NotificationsService } from "../notifications/notifications.module";
import { PricingModule, PricingService } from "../pricing/pricing.module";
import { RegistrationCompleteGuard } from "../common/guards/registration-complete.guard";


class CreateDeliveryDto {
  @IsString() @MaxLength(30) packageType: string; // doc | small | medium | personal
  @IsString() @MaxLength(200) pickupAddress: string;
  @IsString() @MaxLength(200) dropAddress: string;
  @IsEnum(Payer) payer: Payer;
  /** Livraison express : prix proposé par le client. Coursier personnel : ignoré, le serveur calcule le prix. */
  @IsOptional() @IsInt() @Min(200) price?: number;

  /** "PERSONAL" = réservation d'un coursier personnel (véhicule + durée) ; par défaut "EXPRESS". */
  @IsOptional() @IsIn(["EXPRESS", "PERSONAL"]) mode?: "EXPRESS" | "PERSONAL";
  @IsOptional() @IsEnum(VehicleType) vehicleType?: VehicleType;
  @IsOptional() @IsInt() @Min(1) @Max(24 * 14) bookingHours?: number;
  @IsOptional() @IsLatitude() pickupLat?: number;
  @IsOptional() @IsLongitude() pickupLng?: number;
  @IsOptional() @IsLatitude() dropLat?: number;
  @IsOptional() @IsLongitude() dropLng?: number;
}

class ConfirmCodeDto {
  @IsString() @MaxLength(8) code: string;
}

const code4 = () => Math.floor(1000 + Math.random() * 9000).toString();

@Injectable()
export class DeliveryService {
  constructor(
    private prisma: PrismaService,
    private wallet: WalletService,
    private notifications: NotificationsService,
    private pricing: PricingService
  ) {}

  private async enrich(items: (Delivery & { client?: { fullName: string | null; phone: string } })[]) {
    const courierIds = Array.from(new Set(items.map((d) => d.courierId).filter((id): id is string => !!id)));
    const couriers = courierIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: courierIds } },
          select: { id: true, fullName: true, phone: true },
        })
      : [];
    const courierMap = new Map(couriers.map((c) => [c.id, { fullName: c.fullName, phone: c.phone }]));
    return items.map((d) => ({
      ...d,
      commission: this.pricing.deliveryCommission(d.price),
      courier: d.courierId ? courierMap.get(d.courierId) ?? null : null,
    }));
  }

  // Double sécurité OTP : un code au ramassage, un code à la remise
  /** Distance de route (OSRM) entre deux points ; à défaut, vol d'oiseau × 1,3. */
  private async routeKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): Promise<number> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false&steps=false`, { signal: controller.signal });
      if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
      const body = (await res.json()) as { routes?: { distance?: number }[] };
      const meters = body.routes?.[0]?.distance;
      if (typeof meters === "number" && Number.isFinite(meters) && meters > 0) return meters / 1000;
      throw new Error("OSRM sans itinéraire");
    } catch {
      return haversineKm({ latitude: a.lat, longitude: a.lng }, { latitude: b.lat, longitude: b.lng }) * 1.3;
    } finally {
      clearTimeout(timeout);
    }
  }

  async create(clientId: string, dto: CreateDeliveryDto) {
    const { mode, vehicleType, bookingHours, pickupLat, pickupLng, dropLat, dropLng, price: askedPrice, ...base } = dto;
    const personal = mode === "PERSONAL";
    let price = askedPrice ?? 0;
    let extra: Prisma.DeliveryUncheckedCreateInput | Record<string, never> = {};
    if (personal) {
      if (!vehicleType || !this.pricing.personalCourierRule(vehicleType)) throw new BadRequestException("Choisis un véhicule pour ton coursier personnel.");
      if (!bookingHours || !this.pricing.personalCourierDurations().some((d) => d.hours === bookingHours)) {
        throw new BadRequestException("Choisis une durée de réservation proposée (environ 5 heures, 1 jour, 3 jours).");
      }
      if (pickupLat === undefined || pickupLng === undefined || dropLat === undefined || dropLng === undefined) {
        throw new BadRequestException("Choisis le départ et la destination dans la liste de suggestions pour que la distance soit calculée.");
      }
      const km = Math.round((await this.routeKm({ lat: pickupLat, lng: pickupLng }, { lat: dropLat, lng: dropLng })) * 10) / 10;
      price = this.pricing.personalCourierPrice(vehicleType, km);
      extra = { mode: "PERSONAL", vehicleType, bookingHours, distanceKm: km } as Prisma.DeliveryUncheckedCreateInput;
    } else if (!askedPrice) {
      throw new BadRequestException("Le prix de la livraison est obligatoire.");
    }
    if (dto.payer === "SENDER" || personal) {
      const w = await this.wallet.getWallet(clientId);
      if (w.balance < price) {
        throw new BadRequestException(
          `Solde AZƆ̀ Pay insuffisant (${w.balance.toLocaleString("fr-FR")} F pour ${price.toLocaleString("fr-FR")} F). Recharge ton portefeuille${personal ? "" : " ou choisis « Par destinataire »"}.`
        );
      }
    }
    const created = await this.prisma.delivery.create({
      data: { ...base, ...(personal ? { payer: "SENDER" as Payer } : {}), ...extra, price, clientId, pickupCode: code4(), deliveryCode: code4() },
      include: { client: { select: { fullName: true, phone: true } } },
    });
    const [enriched] = await this.enrich([created]);
    return enriched;
  }

  // Livraisons du client connecté
  async list(clientId: string) {
    const items = await this.prisma.delivery.findMany({
      where: { clientId },
      include: { client: { select: { fullName: true, phone: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return this.enrich(items);
  }

  // Missions disponibles pour les coursiers / livreurs (sans code secret exposé !)
  /** Spécialité du coursier : un coursier personnel ne voit que les réservations de son véhicule, les autres que les colis express. */
  private async courierScope(courierId?: string): Promise<Prisma.DeliveryWhereInput> {
    const profile = courierId ? await this.prisma.providerProfile.findUnique({ where: { userId: courierId }, select: { type: true, categoryId: true, vehicleType: true } }) : null;
    if (profile?.type === "COURIER" && profile.categoryId === "COURSIER_PERSONNEL") {
      return { mode: "PERSONAL", ...(profile.vehicleType ? { vehicleType: profile.vehicleType } : {}) };
    }
    return { mode: "EXPRESS" };
  }

  async pending(courierId?: string) {
    const scope = await this.courierScope(courierId);
    const items = await this.prisma.delivery.findMany({
      where: { status: "PENDING", courierId: null, ...scope },
      include: { client: { select: { fullName: true, phone: true } } },
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    const enriched = await this.enrich(items);
    // Le coursier ne doit PAS voir les codes OTP : c'est le client/destinataire qui les lui donne.
    return enriched.map(({ pickupCode: _p, deliveryCode: _d, ...rest }) => ({
      ...rest,
      pickupCode: "••••",
      deliveryCode: "••••",
    }));
  }

  // Historique et mission active du coursier connecté
  async courierDeliveries(courierId: string) {
    const items = await this.prisma.delivery.findMany({
      where: { courierId },
      include: { client: { select: { fullName: true, phone: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const enriched = await this.enrich(items);
    const isLiveSms = process.env.SMS_PROVIDER === "live";
    return enriched.map(({ pickupCode, deliveryCode, ...rest }) => ({
      ...rest,
      pickupCode: isLiveSms ? "••••" : pickupCode,
      deliveryCode: isLiveSms ? "••••" : deliveryCode,
    }));
  }

  // Acceptation atomique d'une mission par un coursier / livreur
  async accept(courierId: string, id: string) {
    const active = await this.prisma.delivery.findFirst({
      where: { courierId, status: { in: ["MATCHED", "IN_PROGRESS"] } },
    });
    if (active && active.id !== id) {
      throw new BadRequestException("Tu as déjà une livraison en cours. Termine-la avant d'en accepter une autre.");
    }

    // Coursier personnel : réservé jusqu'à la fin de sa dernière réservation (même terminée plus tôt)
    const reserved = await this.prisma.delivery.findFirst({
      where: { courierId, mode: "PERSONAL", bookedUntil: { gt: new Date() }, status: { in: ["MATCHED", "IN_PROGRESS", "COMPLETED"] }, NOT: { id } },
      orderBy: { bookedUntil: "desc" },
    });
    if (reserved?.bookedUntil) {
      const until = reserved.bookedUntil.toLocaleString("fr-FR", { timeZone: "Africa/Porto-Novo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      throw new BadRequestException(`Tu es réservé par un client jusqu'au ${until}. Tu pourras accepter une autre course ensuite.`);
    }

    const existing = await this.prisma.delivery.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Mission de livraison introuvable");
    const scope = await this.courierScope(courierId);
    if (existing.mode !== (scope.mode as string) || (existing.vehicleType && scope.vehicleType && existing.vehicleType !== scope.vehicleType)) {
      throw new BadRequestException("Cette mission ne correspond pas à ton activité ou à ton véhicule.");
    }
    if (existing.clientId === courierId) {
      throw new BadRequestException("Tu ne peux pas accepter ta propre demande de livraison");
    }

    const updated = await this.prisma.delivery.updateMany({
      where: { id, status: "PENDING", courierId: null },
      data: { courierId, status: "MATCHED", ...(existing.mode === "PERSONAL" && existing.bookingHours ? { bookedUntil: new Date(Date.now() + existing.bookingHours * 3600_000) } : {}) },
    });
    if (updated.count === 0) {
      throw new BadRequestException("Cette mission vient d'être prise par un autre coursier ou a été annulée");
    }

    const fresh = await this.prisma.delivery.findUniqueOrThrow({
      where: { id },
      include: { client: { select: { fullName: true, phone: true } } },
    });

    await this.notifications.push(
      fresh.clientId,
      "Coursier en route 📦",
      `Un coursier AZƆ̀ a accepté ta livraison vers ${fresh.dropAddress}. Ouvre l'application pour voir le code de ramassage.`,
      "DELIVERY",
      { titleKey: "NOTIFICATION_DELIVERY_ASSIGNED", params: { address: fresh.dropAddress }, data: { event: "delivery", deliveryId: fresh.id } }
    );

    const [enriched] = await this.enrich([fresh]);
    const isLiveSms = process.env.SMS_PROVIDER === "live";
    return isLiveSms
      ? { ...enriched, pickupCode: "••••", deliveryCode: "••••" }
      : enriched;
  }

  // Étape 1 : le coursier saisit le code de ramassage à 4 chiffres donné par l'expéditeur
  async confirmPickup(userId: string, id: string, code: string) {
    const d = await this.prisma.delivery.findUnique({
      where: { id },
      include: { client: { select: { fullName: true, phone: true } } },
    });
    if (!d) throw new NotFoundException("Livraison introuvable");
    if (d.courierId && d.courierId !== userId && d.clientId !== userId) {
      throw new ForbiddenException("Cette livraison est assignée à un autre coursier");
    }
    if (!["PENDING", "MATCHED"].includes(d.status)) {
      throw new BadRequestException("Cette livraison a déjà démarré ou est terminée");
    }
    if (d.pickupCode !== code.trim()) {
      throw new BadRequestException("Code de ramassage invalide : demande les 4 chiffres à l'expéditeur");
    }

    if (d.payer === "SENDER") {
      const clientWallet = await this.wallet.getWallet(d.clientId);
      if (clientWallet.balance < d.price) {
        throw new BadRequestException(
          "Le solde AZƆ̀ Pay de l'expéditeur est insuffisant pour couvrir la livraison"
        );
      }
    }

    const updated = await this.prisma.delivery.update({
      where: { id },
      data: { status: "IN_PROGRESS", courierId: d.courierId ?? userId },
      include: { client: { select: { fullName: true, phone: true } } },
    });

    await this.notifications.push(
      d.clientId,
      "Colis pris en charge ✅",
      `Le coursier a validé le code de ramassage et se dirige vers ${d.dropAddress}. Ouvre l'application pour voir le code de remise.`,
      "DELIVERY",
      { titleKey: "NOTIFICATION_DELIVERY_PICKED_UP", params: { address: d.dropAddress }, data: { event: "delivery", deliveryId: d.id } }
    );

    const [enriched] = await this.enrich([updated]);
    const isLiveSms = process.env.SMS_PROVIDER === "live";
    return userId === d.clientId || !isLiveSms
      ? enriched
      : { ...enriched, pickupCode: "••••", deliveryCode: "••••" };
  }

  // Étape 2 : le coursier saisit le code de remise à 4 chiffres du destinataire -> paiement
  async confirmDelivery(userId: string, id: string, code: string) {
    const d = await this.prisma.delivery.findUnique({
      where: { id },
      include: { client: { select: { fullName: true, phone: true } } },
    });
    if (!d) throw new NotFoundException("Livraison introuvable");
    if (d.courierId && d.courierId !== userId && d.clientId !== userId) {
      throw new ForbiddenException("Cette livraison est assignée à un autre coursier");
    }
    if (d.status !== "IN_PROGRESS") {
      throw new BadRequestException("Valide d'abord le ramassage avant de confirmer la remise finale");
    }
    if (d.deliveryCode !== code.trim()) {
      throw new BadRequestException("Code de remise invalide : demande les 4 chiffres au destinataire");
    }

    const courierId = d.courierId ?? userId;
    const commission = this.pricing.deliveryCommission(d.price);
    const net = d.price - commission;

    if (courierId !== d.clientId) {
      await this.wallet.settleDelivery({
        clientId: d.payer === "SENDER" ? d.clientId : null,
        courierId,
        price: d.price,
        net,
        commission,
        dropAddress: d.dropAddress,
        ref: id,
      });
    }

    const updated = await this.prisma.delivery.update({
      where: { id },
      data: { status: "COMPLETED", courierId },
      include: { client: { select: { fullName: true, phone: true } } },
    });

    // Incrémente le compteur de missions du dossier prestataire du coursier
    await this.prisma.providerProfile
      .updateMany({
        where: { userId: courierId },
        data: { jobsCompleted: { increment: 1 } },
      })
      .catch(() => undefined);

    await this.notifications.push(
      d.clientId,
      "Livraison terminée 🎉",
      `Ton colis à destination de ${d.dropAddress} a bien été remis avec le code OTP.`,
      "DELIVERY",
      { titleKey: "NOTIFICATION_DELIVERY_DONE", params: { address: d.dropAddress }, data: { event: "delivery", deliveryId: d.id } }
    );

    const [enriched] = await this.enrich([updated]);
    return userId === d.clientId
      ? enriched
      : { ...enriched, pickupCode: "••••", deliveryCode: "••••" };
  }

  // Annulation par le client (PENDING / MATCHED) ou par le coursier (MATCHED -> retour en PENDING)
  async cancel(userId: string, id: string) {
    const d = await this.prisma.delivery.findUnique({ where: { id } });
    if (!d) throw new NotFoundException("Livraison introuvable");

    if (d.clientId === userId) {
      if (!["PENDING", "MATCHED"].includes(d.status)) {
        throw new BadRequestException("Impossible d'annuler : le colis est déjà en cours d'acheminement");
      }
      const updated = await this.prisma.delivery.update({
        where: { id },
        data: { status: "CANCELLED" },
        include: { client: { select: { fullName: true, phone: true } } },
      });
      if (d.courierId) {
        await this.notifications.push(
          d.courierId,
          "Livraison annulée",
          `Le client a annulé la livraison vers ${d.dropAddress}.`,
          "DELIVERY",
          { titleKey: "NOTIFICATION_DELIVERY_CANCELLED", params: { address: d.dropAddress }, data: { event: "delivery", deliveryId: d.id } }
        );
      }
      const [enriched] = await this.enrich([updated]);
      return enriched;
    }

    if (d.courierId === userId) {
      if (d.status !== "MATCHED") {
        throw new BadRequestException("Impossible d'annuler après avoir pris le colis en charge");
      }
      const updated = await this.prisma.delivery.update({
        where: { id },
        data: { status: "PENDING", courierId: null, bookedUntil: null },
        include: { client: { select: { fullName: true, phone: true } } },
      });
      await this.notifications.push(
        d.clientId,
        "Recherche d'un nouveau coursier",
        "Le coursier a dû se désister. Ta livraison est reproposée aux coursiers disponibles.",
        "DELIVERY",
        { titleKey: "NOTIFICATION_DELIVERY_REASSIGN", data: { event: "delivery", deliveryId: d.id } }
      );
      const [enriched] = await this.enrich([updated]);
      return { ...enriched, pickupCode: "••••", deliveryCode: "••••" };
    }

    throw new ForbiddenException("Tu ne peux pas annuler cette livraison");
  }
}

@Controller("deliveries")
@UseGuards(JwtAuthGuard)
export class DeliveryController {
  constructor(private svc: DeliveryService) {}

  @Post()
  @UseGuards(RegistrationCompleteGuard)
  create(@CurrentUser() u, @Body() dto: CreateDeliveryDto) {
    return this.svc.create(u.userId, dto);
  }

  @Get()
  list(@CurrentUser() u) {
    return this.svc.list(u.userId);
  }

  @Get("pending")
  pending(@CurrentUser() u) {
    return this.svc.pending(u.userId);
  }

  @Get("courier")
  courier(@CurrentUser() u) {
    return this.svc.courierDeliveries(u.userId);
  }

  @Post(":id/accept")
  accept(@CurrentUser() u, @Param("id") id: string) {
    return this.svc.accept(u.userId, id);
  }

  @Post(":id/confirm-pickup")
  pickup(@CurrentUser() u, @Param("id") id: string, @Body() b: ConfirmCodeDto) {
    return this.svc.confirmPickup(u.userId, id, b.code);
  }

  @Post(":id/confirm-delivery")
  drop(@CurrentUser() u, @Param("id") id: string, @Body() b: ConfirmCodeDto) {
    return this.svc.confirmDelivery(u.userId, id, b.code);
  }

  @Post(":id/cancel")
  cancel(@CurrentUser() u, @Param("id") id: string) {
    return this.svc.cancel(u.userId, id);
  }
}

@Module({
  imports: [WalletModule, NotificationsModule, PricingModule],
  controllers: [DeliveryController],
  providers: [DeliveryService],
})
export class DeliveryModule {}
