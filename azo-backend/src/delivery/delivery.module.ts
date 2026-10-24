import {
  BadRequestException,
  Query,
  Body,
  Controller,
  ConflictException,
  ForbiddenException,
  Get,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { IsEnum, IsIn, IsInt, IsISO8601, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { Delivery, Payer, Prisma, VehicleType } from "@prisma/client";
import { haversineKm } from "../rides/radar";
import { odometerStep, startAnchor } from "../rides/odometer";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { WalletModule, WalletService } from "../wallet/wallet.module";
import { NotificationsModule, NotificationsService } from "../notifications/notifications.module";
import { PricingModule, PricingService } from "../pricing/pricing.module";
import { RegistrationCompleteGuard } from "../common/guards/registration-complete.guard";
import { beninPhoneVariants, extractLocalBeninDigits, normalizeBeninPhone } from "../common/phone";
import { maskPhone } from "../referrals/referral-logic";
import { RidesGateway } from "../rides/rides.gateway";
import { RidesModule } from "../rides/rides.module";
import { COURIER_PROFILE_SELECT, buildPublicCourierProfile } from "./courier-profile";


class CreateDeliveryDto {
  @IsString() @MaxLength(30) packageType: string; // doc | small | medium | personal
  @IsString() @MaxLength(200) pickupAddress: string;
  /** Obligatoire en livraison express ; facultative pour un coursier personnel (la destination n'est pas toujours connue). */
  @IsOptional() @IsString() @MaxLength(200) dropAddress?: string;
  @IsEnum(Payer) payer: Payer;
  /** Livraison express : prix proposé par le client. Coursier personnel : ignoré, le serveur calcule le prix. */
  @IsOptional() @IsInt() @Min(200) price?: number;

  /** "PERSONAL" = réservation d'un coursier personnel (véhicule + durée) ; par défaut "EXPRESS". */
  @IsOptional() @IsIn(["EXPRESS", "PERSONAL"]) mode?: "EXPRESS" | "PERSONAL";
  @IsOptional() @IsEnum(VehicleType) vehicleType?: VehicleType;
  @IsOptional() @IsInt() @Min(1) @Max(24 * 14) bookingHours?: number;
  /** Coursier personnel : départ programmé (ISO 8601) ; absent = tout de suite. */
  @IsOptional() @IsISO8601() scheduledAt?: string;
  @IsOptional() @IsLatitude() pickupLat?: number;
  @IsOptional() @IsLongitude() pickupLng?: number;
  @IsOptional() @IsLatitude() dropLat?: number;
  @IsOptional() @IsLongitude() dropLng?: number;
  /** Livraison express : numéro du destinataire (obligatoire). Il reçoit le code de remise, pas le coursier. Ignoré pour un coursier personnel. */
  @IsOptional() @IsString() @MaxLength(20) recipientPhone?: string;
}

class CourierLocationDto {
  @IsNumber() @Min(-90) @Max(90) latitude: number;
  @IsNumber() @Min(-180) @Max(180) longitude: number;
  @IsOptional() @IsNumber() @Min(0) accuracy?: number;
  /** Vitesse mesurée par le téléphone (m/s) : permet de compter les petits déplacements réels sans compter le bruit du GPS. */
  @IsOptional() @IsNumber() @Min(0) speed?: number;
}

class AcceptDto {
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number;
}

class ConfirmCodeDto {
  @IsString() @MaxLength(8) code: string;
}

/** Rayon dans lequel un coursier voit les missions autour de lui. */
const PICKUP_RADIUS_KM = 20;

const code4 = () => Math.floor(1000 + Math.random() * 9000).toString();

/** Numéro du destinataire tel que le coursier peut le voir : partiellement masqué (« 01 •• •• •• 42 »). */
const maskedRecipient = (phone?: string | null) => (phone ? maskPhone(phone) : null);

/**
 * Livraison telle que la voit le COURSIER : le code de remise (arrivée) n'est jamais montré — c'est le destinataire qui le lui donne —,
 * le code de ramassage seulement en simulation (SMS pas encore en service), et le numéro du destinataire est masqué.
 */
function forCourier<T extends { pickupCode?: string; deliveryCode?: string; recipientPhone?: string | null }>(d: T): T {
  const isLiveSms = process.env.SMS_PROVIDER === "live";
  return { ...d, pickupCode: isLiveSms ? "••••" : d.pickupCode, deliveryCode: "••••", recipientPhone: maskedRecipient(d.recipientPhone) };
}

@Injectable()
export class DeliveryService {
  constructor(
    private prisma: PrismaService,
    private wallet: WalletService,
    private notifications: NotificationsService,
    private pricing: PricingService,
    private gateway: RidesGateway
  ) {}

  private readonly logger = new Logger(DeliveryService.name);

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
      // Tant que le client n'a pas validé la proposition (OFFERED), il ne voit ni le nom ni le téléphone du coursier
      courier: d.courierId && d.status !== "OFFERED" ? courierMap.get(d.courierId) ?? null : null,
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

  private refusalMessage(vehicle: string, packageType: string): string {
    if (packageType === "large") return "Un gros colis se livre en Speeder tricycle.";
    if (vehicle === "ZEM_TRICYCLE") return "Le Speeder tricycle est réservé aux gros colis : choisis un Speeder moto (essence ou électrique) pour ce colis.";
    return "Choisis un Speeder moto (essence ou électrique) et un type de colis proposé.";
  }

  /** Devis d'un colis : le prix affiché au client est exactement celui que le serveur facturera (distance de l'itinéraire). */
  async quote(vehicleType: string, packageType: string, pickup: { lat: number; lng: number }, drop: { lat: number; lng: number }) {
    if (!this.pricing.deliveryRule(vehicleType, packageType)) {
      throw new BadRequestException(this.refusalMessage(vehicleType, packageType));
    }
    const km = Math.round((await this.routeKm(pickup, drop)) * 10) / 10;
    return { km, price: this.pricing.deliveryPrice(vehicleType, km, packageType) };
  }

  async create(clientId: string, dto: CreateDeliveryDto) {
    const { mode, vehicleType, bookingHours, pickupLat, pickupLng, dropLat, dropLng, scheduledAt: scheduledRaw, price: askedPrice, dropAddress: askedDrop, recipientPhone: askedRecipient, ...base } = dto;
    const personal = mode === "PERSONAL";
    // Livraison express : le numéro du destinataire est obligatoire (c'est lui qui reçoit le code de remise). Il est saisi pour CETTE
    // commande : rien n'est repris d'une livraison précédente.
    let recipientPhone: string | null = null;
    if (!personal) {
      const local = extractLocalBeninDigits(askedRecipient ?? "");
      if (!((local.length === 10 && local.startsWith("01")) || (local.length === 8 && !local.startsWith("01")))) {
        throw new BadRequestException("Indique le numéro du destinataire : 10 chiffres commençant par 01. C'est lui qui reçoit le code de remise.");
      }
      recipientPhone = normalizeBeninPhone(askedRecipient as string);
    }
    let price = askedPrice ?? 0;
    let dropAddress = askedDrop?.trim() ?? "";
    let extra: Record<string, unknown> = {};
    if (personal) {
      if (!vehicleType || !this.pricing.personalCourierRule(vehicleType)) throw new BadRequestException("Choisis un véhicule pour ton coursier personnel.");
      let scheduledAt: Date | null = null;
      if (scheduledRaw) {
        scheduledAt = new Date(scheduledRaw);
        const lead = scheduledAt.getTime() - Date.now();
        if (Number.isNaN(scheduledAt.getTime()) || lead < 10 * 60_000 || lead > 30 * 24 * 3600_000) {
          throw new BadRequestException("Choisis un départ programmé dans au moins 10 minutes et au plus dans 30 jours.");
        }
      }
      const standard = bookingHours !== undefined && this.pricing.personalCourierDurations().some((d) => d.hours === bookingHours);
      // Au-delà de 3 jours, la réservation est programmée : jours entiers (jusqu'à 14), avec une date de départ
      const longBooking = bookingHours !== undefined && bookingHours > 72 && bookingHours % 24 === 0 && bookingHours <= 24 * 14;
      if (!bookingHours || !(standard || longBooking)) {
        throw new BadRequestException("Choisis une durée de réservation proposée (environ 5 heures, 1 jour, 3 jours, ou plus de 3 jours en programmant).");
      }
      if (longBooking && !standard && !scheduledAt) {
        throw new BadRequestException("Au-delà de 3 jours, programme le début de ta réservation.");
      }
      if (pickupLat === undefined || pickupLng === undefined) {
        throw new BadRequestException("Choisis ton point de départ dans la liste de suggestions.");
      }
      // La destination est facultative : sans elle, seule la partie fixe du tarif est facturée à la commande
      let km = 0;
      if (dropLat !== undefined && dropLng !== undefined) {
        km = Math.round((await this.routeKm({ lat: pickupLat, lng: pickupLng }, { lat: dropLat, lng: dropLng })) * 10) / 10;
      }
      price = this.pricing.personalCourierPrice(vehicleType, km);
      if (!dropAddress) dropAddress = "Destination à préciser avec le coursier";
      extra = { mode: "PERSONAL", vehicleType, bookingHours, distanceKm: km, ...(scheduledAt ? { scheduledAt } : {}) };
    } else {
      if (!dropAddress) throw new BadRequestException("L'adresse de livraison est obligatoire.");
      // Speeder demandé pour le colis : seuls les livreurs de ce véhicule voient la mission. Moto ou tricycle uniquement.
      const express = vehicleType ?? "ZEM_ESSENCE";
      if (!this.pricing.deliveryRule(express, base.packageType)) {
        throw new BadRequestException(this.refusalMessage(express, base.packageType));
      }
      if (base.packageType === "large" && express !== "ZEM_TRICYCLE") {
        throw new BadRequestException("Un gros colis se livre en Speeder tricycle.");
      }
      if (pickupLat === undefined || pickupLng === undefined || dropLat === undefined || dropLng === undefined) {
        throw new BadRequestException("Choisis le ramassage et la livraison dans la liste de suggestions (ou sur la carte) pour calculer le prix.");
      }
      // Prix calculé par le serveur sur la distance de l'itinéraire : le prix envoyé par le client est ignoré
      const km = Math.round((await this.routeKm({ lat: pickupLat, lng: pickupLng }, { lat: dropLat, lng: dropLng })) * 10) / 10;
      price = this.pricing.deliveryPrice(express, km, base.packageType);
      extra = { vehicleType: express, distanceKm: km };
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
      data: { ...base, dropAddress, pickupLat, pickupLng, dropLat, dropLng, ...(personal ? { payer: "SENDER" as Payer } : {}), ...extra, price, clientId, recipientPhone, pickupCode: code4(), deliveryCode: code4() } as Prisma.DeliveryUncheckedCreateInput,
      include: { client: { select: { fullName: true, phone: true } } },
    });
    // Accusé de réception pour l'expéditeur (au mieux : ne bloque jamais la commande)
    try {
      await this.notifications.push(clientId, "Commande envoyée", "Nous cherchons un livreur pour ta commande. Tu seras prévenu dès qu'il accepte.", "DELIVERY", {
        titleKey: "NOTIFICATION_DELIVERY_REQUESTED",
        data: { event: "delivery-requested", deliveryId: created.id },
      });
    } catch {
      // l'accusé de réception est facultatif
    }
    // Le destinataire a un compte AZƆ̀ : son code de remise lui arrive dans l'application (notification). Sinon l'expéditeur le lui transmet.
    if (recipientPhone) {
      const recipient = await this.prisma.user
        .findFirst({ where: { phone: { in: beninPhoneVariants(recipientPhone) } }, select: { id: true } })
        .catch(() => null);
      if (recipient && recipient.id !== clientId) {
        const sender = created.client?.fullName?.trim() || "Un client AZƆ̀";
        await this.notifications
          .push(
            recipient.id,
            "Un colis arrive pour toi 📦",
            `${sender} t'envoie un colis. Ton code de remise : ${created.deliveryCode}. Donne-le au livreur seulement quand il te remet le colis.`,
            "DELIVERY",
            { sendPush: true, titleKey: "NOTIFICATION_DELIVERY_RECIPIENT_CODE", params: { sender, code: created.deliveryCode }, data: { event: "delivery-recipient-code", deliveryId: created.id } }
          )
          .catch(() => null);
      }
    }
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
  private async courierScope(courierId?: string): Promise<{ mode: "PERSONAL" | "EXPRESS"; vehicleType: VehicleType | null }> {
    const profile = courierId ? await this.prisma.providerProfile.findUnique({ where: { userId: courierId }, select: { type: true, categoryId: true, vehicleType: true } }) : null;
    const personal = profile?.type === "COURIER" && profile.categoryId === "COURSIER_PERSONNEL";
    return { mode: personal ? "PERSONAL" : "EXPRESS", vehicleType: profile?.vehicleType ?? null };
  }

  /**
   * Missions visibles : réservations du véhicule du coursier personnel ; colis express demandant le Speeder du livreur
   * (ou sans préférence de véhicule).
   */
  private scopeWhere(scope: { mode: "PERSONAL" | "EXPRESS"; vehicleType: VehicleType | null }): Prisma.DeliveryWhereInput {
    if (!scope.vehicleType) return { mode: scope.mode };
    if (scope.mode === "PERSONAL") return { mode: "PERSONAL", vehicleType: scope.vehicleType };
    return { mode: "EXPRESS", OR: [{ vehicleType: null }, { vehicleType: scope.vehicleType }] };
  }

  /** Seul un coursier ou livreur dont le dossier est validé peut prendre des missions (ni un client, ni un Speeder de courses). */
  private async isApprovedCourier(userId: string): Promise<boolean> {
    const profile = await this.prisma.providerProfile.findUnique({ where: { userId }, select: { type: true, status: true } });
    return profile?.type === "COURIER" && profile.status === "APPROVED";
  }

  private async isCourierBusy(courierId: string): Promise<boolean> {
    const now = new Date();
    const busy = await this.prisma.delivery.findFirst({
      where: {
        courierId,
        OR: [
          { status: { in: ["OFFERED", "MATCHED", "IN_PROGRESS"] }, NOT: { mode: "PERSONAL", bookedFrom: { gt: now } } },
          { mode: "PERSONAL", status: { in: ["MATCHED", "IN_PROGRESS", "COMPLETED"] }, bookedFrom: { lte: now }, bookedUntil: { gt: now } },
        ],
      },
      select: { id: true },
    });
    return !!busy;
  }

  async pending(courierId?: string, near?: { lat: number; lng: number }) {
    // Un coursier occupé (mission en cours, ou réservé par un client pour la durée choisie) ne se voit proposer aucune autre mission
    if (courierId && !(await this.isApprovedCourier(courierId))) return [];
    if (courierId && (await this.isCourierBusy(courierId))) return [];
    const scope = await this.courierScope(courierId);
    const items = await this.prisma.delivery.findMany({
      where: { status: "PENDING", courierId: null, ...this.scopeWhere(scope), ...(courierId ? { NOT: { declinedCourierIds: { has: courierId } } } : {}) },
      include: { client: { select: { fullName: true, phone: true } } },
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    const enriched = await this.enrich(items);
    // Rayon de 20 km autour du coursier : les missions dont le départ est connu et plus loin sont masquées
    const withDistance = enriched
      .map((d) => ({
        ...d,
        pickupDistanceKm:
          near && d.pickupLat != null && d.pickupLng != null
            ? Math.round(haversineKm({ latitude: near.lat, longitude: near.lng }, { latitude: d.pickupLat, longitude: d.pickupLng }) * 10) / 10
            : null,
      }))
      .filter((d) => d.pickupDistanceKm === null || d.pickupDistanceKm <= PICKUP_RADIUS_KM);
    // Le coursier ne doit PAS voir les codes OTP : c'est le client/destinataire qui les lui donne.
    return withDistance.map(({ pickupCode: _p, deliveryCode: _d, ...rest }) => ({
      ...rest,
      pickupCode: "••••",
      deliveryCode: "••••",
      recipientPhone: maskedRecipient(rest.recipientPhone),
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
    return enriched.map((d) => forCourier(d));
  }

  // Acceptation atomique d'une mission par un coursier / livreur
  async accept(courierId: string, id: string, pos?: { lat: number; lng: number }) {
    if (!(await this.isApprovedCourier(courierId))) throw new ForbiddenException("Seuls les coursiers et livreurs validés par AZƆ̀ peuvent prendre une mission.");
    const active = await this.prisma.delivery.findFirst({
      // une réservation programmée plus tard n'empêche pas d'accepter une course maintenant
      where: { courierId, status: { in: ["OFFERED", "MATCHED", "IN_PROGRESS"] }, NOT: { mode: "PERSONAL", bookedFrom: { gt: new Date() } } },
    });
    if (active && active.id !== id) {
      throw new BadRequestException("Tu as déjà une livraison en cours. Termine-la avant d'en accepter une autre.");
    }

    const existing = await this.prisma.delivery.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Mission de livraison introuvable");
    const scope = await this.courierScope(courierId);
    if (existing.mode !== scope.mode || (existing.vehicleType && scope.vehicleType && existing.vehicleType !== scope.vehicleType)) {
      throw new BadRequestException("Cette mission ne correspond pas à ton activité ou à ton véhicule.");
    }

    // Coursier personnel : réservé de l'heure de départ à la fin de la durée (même si la course finit plus tôt).
    // Les réservations qui ne se chevauchent pas restent possibles (ex. une course programmée la semaine prochaine).
    let bookedFrom: Date | null = null;
    let bookedUntil: Date | null = null;
    if (existing.mode === "PERSONAL" && existing.bookingHours) {
      const now = new Date();
      bookedFrom = existing.scheduledAt && existing.scheduledAt > now ? existing.scheduledAt : now;
      bookedUntil = new Date(bookedFrom.getTime() + existing.bookingHours * 3600_000);
      const clash = await this.prisma.delivery.findFirst({
        where: {
          courierId,
          mode: "PERSONAL",
          status: { in: ["MATCHED", "IN_PROGRESS", "COMPLETED"] },
          bookedFrom: { lt: bookedUntil },
          bookedUntil: { gt: bookedFrom },
          NOT: { id },
        },
        orderBy: { bookedUntil: "desc" },
      });
      if (clash?.bookedUntil) {
        const until = clash.bookedUntil.toLocaleString("fr-FR", { timeZone: "Africa/Porto-Novo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        throw new BadRequestException(`Tu es déjà réservé par un client jusqu'au ${until}. Tu pourras accepter une autre course ensuite.`);
      }
    }
    if (existing.clientId === courierId) {
      throw new BadRequestException("Tu ne peux pas accepter ta propre demande de livraison");
    }

    if (existing.declinedCourierIds?.includes(courierId)) {
      throw new ForbiddenException("Le client a déjà refusé ta proposition pour cette mission.");
    }

    const settings = this.offerSettings();
    if (settings.approval) {
      // Comme pour une course simple : le coursier se propose, le client regarde son profil et décide (PENDING → OFFERED → MATCHED)
      const offeredAt = new Date();
      const offerExpiresAt = new Date(offeredAt.getTime() + settings.seconds * 1000);
      const claimed = await this.prisma.delivery.updateMany({
        where: { id, status: "PENDING", courierId: null },
        data: {
          courierId,
          status: "OFFERED",
          offeredAt,
          offerExpiresAt,
          offerSeenAt: null,
          ...(pos ? { courierLat: pos.lat, courierLng: pos.lng, courierLocatedAt: offeredAt } : {}),
        },
      });
      if (claimed.count === 0) {
        throw new BadRequestException("Cette mission vient d'être prise par un autre coursier ou a été annulée");
      }
      void this.announceOffer(id).catch((e) => this.logger.warn(`announceOffer ${id} : ${e?.message ?? e}`));
      const offered = await this.prisma.delivery.findUniqueOrThrow({
        where: { id },
        include: { client: { select: { fullName: true, phone: true } } },
      });
      const [enrichedOffer] = await this.enrich([offered]);
      return { ...enrichedOffer, pickupCode: "••••", deliveryCode: "••••", recipientPhone: maskedRecipient(enrichedOffer.recipientPhone) };
    }

    const updated = await this.prisma.delivery.updateMany({
      where: { id, status: "PENDING", courierId: null },
      data: { courierId, status: "MATCHED", ...(bookedFrom && bookedUntil ? { bookedFrom, bookedUntil } : {}) },
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
      fresh.mode === "PERSONAL" ? "Ton coursier arrive 🏍️" : "Coursier en route 📦",
      fresh.mode === "PERSONAL"
        ? "Un coursier personnel AZƆ̀ a accepté ta réservation. Ouvre l'application pour voir le code de départ."
        : `Un coursier AZƆ̀ a accepté ta livraison vers ${fresh.dropAddress}. Ouvre l'application pour voir le code de ramassage.`,
      "DELIVERY",
      { titleKey: fresh.mode === "PERSONAL" ? "NOTIFICATION_PERSONAL_ASSIGNED" : "NOTIFICATION_DELIVERY_ASSIGNED", params: { address: fresh.dropAddress }, data: { event: "delivery", deliveryId: fresh.id } }
    );

    const [enriched] = await this.enrich([fresh]);
    return forCourier(enriched);
  }

  /* ------------------------------------------------------------------------------------------------------------------ */
  /*  Proposition du coursier ou livreur : le client regarde son profil et décide (comme pour une course simple)        */
  /* ------------------------------------------------------------------------------------------------------------------ */

  private offerSettings() {
    const r = this.pricing.rideSettings();
    return { approval: r.requireClientApproval !== false, seconds: r.offerExpirySeconds, graceMs: r.offerApprovalGraceSeconds * 1000 };
  }

  private offerEnded(message: string) {
    return new ConflictException({ code: "DELIVERY_OFFER_ENDED", message });
  }

  /** Contenu de la popup du client : profil public du coursier, délai (heure du serveur) et distance jusqu'au départ. */
  private async loadOfferPayload(id: string) {
    const d = await this.prisma.delivery.findUnique({
      where: { id },
      select: {
        id: true, clientId: true, courierId: true, status: true, mode: true, packageType: true, vehicleType: true, bookingHours: true,
        price: true, pickupAddress: true, dropAddress: true, pickupLat: true, pickupLng: true, offerExpiresAt: true, courierLat: true, courierLng: true,
      },
    });
    if (!d || d.status !== "OFFERED" || !d.courierId || !d.offerExpiresAt) return null;
    const courier = await this.prisma.user.findUnique({ where: { id: d.courierId }, select: COURIER_PROFILE_SELECT });
    if (!courier) return null;
    let distanceKm: number | null = null;
    if (d.courierLat != null && d.courierLng != null && d.pickupLat != null && d.pickupLng != null) {
      distanceKm = Math.round(haversineKm({ latitude: d.courierLat, longitude: d.courierLng }, { latitude: d.pickupLat, longitude: d.pickupLng }) * 10) / 10;
    }
    const now = new Date();
    return {
      clientId: d.clientId,
      payload: {
        deliveryId: d.id,
        mode: d.mode,
        packageType: d.packageType,
        vehicleType: d.vehicleType,
        bookingHours: d.bookingHours,
        price: d.price,
        pickupAddress: d.pickupAddress,
        dropAddress: d.dropAddress,
        expiresAt: d.offerExpiresAt.toISOString(),
        serverNow: now.toISOString(),
        expiresInSeconds: Math.max(0, Math.round((d.offerExpiresAt.getTime() - now.getTime()) / 1000)),
        courier: buildPublicCourierProfile(courier),
        offer: { distanceKm, etaMinutes: distanceKm !== null ? Math.max(1, Math.round((distanceKm / 20) * 60)) : null },
      },
    };
  }

  /** Prévient le client : événement temps réel (popup) + notification poussée. */
  private async announceOffer(id: string) {
    const loaded = await this.loadOfferPayload(id);
    if (!loaded) return;
    const { clientId, payload } = loaded;
    this.gateway.emitToUser(clientId, "delivery:offered", payload);
    await this.notifications.push(
      clientId,
      payload.mode === "PERSONAL" ? "Un coursier a accepté ta réservation" : "Un livreur a accepté ton colis",
      `Touche pour voir son profil — il te reste ${payload.expiresInSeconds} s.`,
      "DELIVERY",
      {
        sendPush: true,
        channelId: "ride-offers",
        ttlSeconds: payload.expiresInSeconds,
        data: { event: "delivery-offered", deliveryId: id, expiresAt: payload.expiresAt, serverNow: payload.serverNow },
        titleKey: payload.mode === "PERSONAL" ? "NOTIFICATION_DELIVERY_OFFERED_PERSONAL" : "NOTIFICATION_DELIVERY_OFFERED",
        bodyKey: "NOTIFICATION_DELIVERY_OFFERED_BODY",
        params: { s: payload.expiresInSeconds },
      }
    );
  }

  /** Propositions en attente de la décision du client (rattrapage de la popup). */
  async pendingOffers(clientId: string) {
    const cutoff = new Date(Date.now() - this.offerSettings().graceMs);
    const rows = await this.prisma.delivery.findMany({ where: { clientId, status: "OFFERED", offerExpiresAt: { gt: cutoff } }, select: { id: true } });
    const loaded = await Promise.all(rows.map((r) => this.loadOfferPayload(r.id)));
    return { offers: loaded.flatMap((entry) => (entry ? [entry.payload] : [])) };
  }

  /** Le client a ouvert la popup : le coursier voit « le client regarde ton profil ». Idempotent. */
  async offerSeen(id: string, clientId: string) {
    const d = await this.prisma.delivery.findUnique({ where: { id }, select: { clientId: true, courierId: true, status: true, offerSeenAt: true } });
    if (!d) throw new NotFoundException("Livraison introuvable");
    if (d.clientId !== clientId) throw new ForbiddenException();
    if (d.status !== "OFFERED") throw this.offerEnded("La proposition est terminée");
    if (d.offerSeenAt) return { seenAt: d.offerSeenAt.toISOString() };
    const seenAt = new Date();
    const { count } = await this.prisma.delivery.updateMany({ where: { id, clientId, status: "OFFERED", offerSeenAt: null }, data: { offerSeenAt: seenAt } });
    if (count === 1 && d.courierId) this.gateway.emitToUser(d.courierId, "delivery:offer-seen", { deliveryId: id, at: seenAt.toISOString() });
    return { seenAt: seenAt.toISOString() };
  }

  /** Profil public du coursier, pour le client de la commande. */
  async courierProfile(id: string, clientId: string) {
    const d = await this.prisma.delivery.findUnique({ where: { id }, select: { clientId: true, courierId: true, status: true } });
    if (!d) throw new NotFoundException("Livraison introuvable");
    if (d.clientId !== clientId) throw new ForbiddenException();
    if (!d.courierId || !["OFFERED", "MATCHED", "IN_PROGRESS", "COMPLETED"].includes(d.status)) {
      throw new BadRequestException("Le profil du coursier n'est pas encore disponible");
    }
    const courier = await this.prisma.user.findUnique({ where: { id: d.courierId }, select: COURIER_PROFILE_SELECT });
    if (!courier) throw new NotFoundException("Coursier introuvable");
    return buildPublicCourierProfile(courier);
  }

  private async expireOfferedIfNeeded(id: string): Promise<boolean> {
    const d = await this.prisma.delivery.findUnique({ where: { id }, select: { id: true, clientId: true, courierId: true, status: true, declinedCourierIds: true, offerExpiresAt: true } });
    if (!d || d.status !== "OFFERED") return false;
    if (!d.offerExpiresAt || d.offerExpiresAt > new Date(Date.now() - this.offerSettings().graceMs)) return false;
    await this.revertOfferToPending(d, d.courierId, "expired");
    return true;
  }

  /** Balayage périodique : les propositions sans réponse du client retournent à la recherche. */
  async expireAllPendingOffers(): Promise<void> {
    const expired = await this.prisma.delivery.findMany({
      where: { status: "OFFERED", offerExpiresAt: { lt: new Date(Date.now() - this.offerSettings().graceMs) } },
      select: { id: true, clientId: true, courierId: true, status: true, declinedCourierIds: true, offerExpiresAt: true },
    });
    await Promise.all(expired.map((d) => this.revertOfferToPending(d, d.courierId, "expired").catch((e) => this.logger.warn(`expire ${d.id} : ${e?.message ?? e}`))));
  }

  /** Fenêtre de réservation d'un coursier personnel, à partir de la validation du client. */
  private async bookingWindow(d: { id: string; courierId: string | null; mode: string; bookingHours: number | null; scheduledAt: Date | null }) {
    if (d.mode !== "PERSONAL" || !d.bookingHours) return {};
    const now = new Date();
    const bookedFrom = d.scheduledAt && d.scheduledAt > now ? d.scheduledAt : now;
    const bookedUntil = new Date(bookedFrom.getTime() + d.bookingHours * 3600_000);
    if (d.courierId) {
      const clash = await this.prisma.delivery.findFirst({
        where: { courierId: d.courierId, mode: "PERSONAL", status: { in: ["MATCHED", "IN_PROGRESS", "COMPLETED"] }, bookedFrom: { lt: bookedUntil }, bookedUntil: { gt: bookedFrom }, NOT: { id: d.id } },
      });
      if (clash) throw new BadRequestException("Ce coursier est déjà réservé sur cette période.");
    }
    return { bookedFrom, bookedUntil };
  }

  /** Le client choisit ce coursier : OFFERED → MATCHED. */
  async approveCourier(id: string, clientId: string) {
    await this.expireOfferedIfNeeded(id);
    const d = await this.prisma.delivery.findUnique({ where: { id }, include: { client: { select: { fullName: true, phone: true } } } });
    if (!d) throw new NotFoundException("Livraison introuvable");
    if (d.clientId !== clientId) throw new ForbiddenException();
    if (d.status === "MATCHED") {
      const [already] = await this.enrich([d]);
      return already;
    }
    if (d.status !== "OFFERED") throw this.offerEnded("Cette proposition n'est plus disponible");
    const cutoff = new Date(Date.now() - this.offerSettings().graceMs);
    if (!d.offerExpiresAt || d.offerExpiresAt < cutoff) throw this.offerEnded("La proposition a expiré");
    const booking = await this.bookingWindow(d);
    const { count } = await this.prisma.delivery.updateMany({
      where: { id, clientId, status: "OFFERED", offerExpiresAt: { gt: cutoff } },
      data: { status: "MATCHED", offeredAt: null, offerExpiresAt: null, offerSeenAt: null, ...booking },
    });
    if (count === 0) throw this.offerEnded("La proposition a expiré ou n'est plus disponible");
    this.gateway.emitToUser(clientId, "delivery:offer-ended", { deliveryId: id, outcome: "approved", at: new Date().toISOString() });
    if (d.courierId) {
      this.gateway.emitToUser(d.courierId, "delivery:offer-approved", { deliveryId: id, at: new Date().toISOString() });
      await this.notifications
        .push(d.courierId, "Le client t'a choisi", "Rends-toi au point de ramassage.", "DELIVERY", {
          sendPush: true,
          titleKey: "NOTIFICATION_DELIVERY_APPROVED",
          bodyKey: "NOTIFICATION_DELIVERY_APPROVED_BODY",
          data: { event: "delivery-approved", deliveryId: id },
        })
        .catch(() => null);
    }
    const fresh = await this.prisma.delivery.findUniqueOrThrow({ where: { id }, include: { client: { select: { fullName: true, phone: true } } } });
    const [enriched] = await this.enrich([fresh]);
    return enriched;
  }

  /** Le client refuse ce coursier : retour à la recherche, ce coursier ne revoit plus la mission. */
  async declineCourier(id: string, clientId: string) {
    const d = await this.prisma.delivery.findUnique({ where: { id }, select: { id: true, clientId: true, courierId: true, status: true, declinedCourierIds: true } });
    if (!d) throw new NotFoundException("Livraison introuvable");
    if (d.clientId !== clientId) throw new ForbiddenException();
    if (d.status !== "OFFERED") throw this.offerEnded("Aucune proposition à refuser");
    return this.revertOfferToPending(d, d.courierId, "declined");
  }

  /** Le coursier retire sa proposition. */
  async withdrawOffer(id: string, courierId: string) {
    const d = await this.prisma.delivery.findUnique({ where: { id }, select: { id: true, clientId: true, courierId: true, status: true, declinedCourierIds: true } });
    if (!d) throw new NotFoundException("Livraison introuvable");
    if (d.courierId !== courierId) throw new ForbiddenException("Cette proposition ne t'est pas attribuée");
    if (d.status !== "OFFERED") throw this.offerEnded("Aucune proposition à retirer");
    return this.revertOfferToPending(d, courierId, "withdrawn");
  }

  private async revertOfferToPending(
    d: { id: string; clientId: string; courierId: string | null; status: string; declinedCourierIds: string[] },
    courierId: string | null,
    reason: "declined" | "withdrawn" | "expired"
  ) {
    const declined = courierId && !d.declinedCourierIds.includes(courierId) ? [...d.declinedCourierIds, courierId] : d.declinedCourierIds;
    const { count } = await this.prisma.delivery.updateMany({
      where: { id: d.id, status: "OFFERED" },
      data: { status: "PENDING", courierId: null, offeredAt: null, offerExpiresAt: null, offerSeenAt: null, declinedCourierIds: declined },
    });
    if (count === 0) return { deliveryId: d.id, status: "PENDING" };
    this.gateway.emitToUser(d.clientId, "delivery:offer-ended", { deliveryId: d.id, outcome: reason, at: new Date().toISOString() });
    if (courierId) {
      this.gateway.emitToUser(courierId, "delivery:offer-ended", { deliveryId: d.id, outcome: reason, at: new Date().toISOString() });
      if (reason === "declined") {
        await this.notifications
          .push(courierId, "Le client a choisi un autre coursier.", "Tu peux accepter une autre mission.", "DELIVERY", {
            sendPush: true,
            titleKey: "NOTIFICATION_DELIVERY_DECLINED",
            data: { event: "delivery-declined", deliveryId: d.id },
          })
          .catch(() => null);
      }
    }
    return { deliveryId: d.id, status: "PENDING" };
  }

  /** Position du client (envoyée pendant la mission) : le coursier peut le suivre sur sa carte. */
  async updateClientLocation(clientId: string, id: string, dto: CourierLocationDto) {
    const d = await this.prisma.delivery.findUnique({ where: { id }, select: { clientId: true, status: true } });
    if (!d) throw new NotFoundException("Livraison introuvable");
    if (d.clientId !== clientId) throw new ForbiddenException("Cette livraison n'est pas la tienne");
    if (!["MATCHED", "IN_PROGRESS"].includes(d.status)) throw new BadRequestException("Le suivi est terminé pour cette livraison");
    await this.prisma.delivery.update({ where: { id }, data: { clientLat: dto.latitude, clientLng: dto.longitude, clientLocatedAt: new Date() } });
    return { ok: true };
  }

  /** Position du coursier (envoyée toutes les quelques secondes pendant la mission). Après le ramassage, les kilomètres s'accumulent (coursier personnel). */
  async updateLocation(courierId: string, id: string, dto: CourierLocationDto) {
    const d = await this.prisma.delivery.findUnique({ where: { id } });
    if (!d) throw new NotFoundException("Livraison introuvable");
    if (d.courierId !== courierId) throw new ForbiddenException("Cette livraison n'est pas la tienne");
    if (!["MATCHED", "IN_PROGRESS"].includes(d.status)) throw new BadRequestException("Le suivi est terminé pour cette livraison");
    const now = Date.now();
    const data: Prisma.DeliveryUpdateInput = { courierLat: dto.latitude, courierLng: dto.longitude, courierLocatedAt: new Date(now) };
    // Distance parcourue depuis le ramassage : coursier personnel (prix final) et livreur express (information), même calcul que la course simple
    if (d.status === "IN_PROGRESS") {
      const previous = d.odoLat !== null && d.odoLng !== null && d.odoAt ? { lat: d.odoLat, lng: d.odoLng, at: d.odoAt.getTime(), cred: d.odoCred ?? 0 } : null;
      const step = odometerStep(previous, { lat: dto.latitude, lng: dto.longitude, at: now }, dto.accuracy, dto.speed, { strict: true });
      if (step?.accepted) {
        data.odoLat = step.point.lat;
        data.odoLng = step.point.lng;
        data.odoAt = new Date(step.point.at);
        data.odoCred = step.point.cred ?? 0;
        if (step.meters > 0) data.traveledMeters = { increment: step.meters };
      }
    }
    const updated = await this.prisma.delivery.update({ where: { id }, data, select: { traveledMeters: true } });
    return { traveledMeters: updated.traveledMeters };
  }

  /** Suivi en direct (client ou coursier de la livraison). */
  async track(userId: string, id: string) {
    const d = await this.prisma.delivery.findUnique({ where: { id } });
    if (!d) throw new NotFoundException("Livraison introuvable");
    if (d.clientId !== userId && d.courierId !== userId) throw new ForbiddenException("Livraison inaccessible");
    return {
      id: d.id,
      status: d.status,
      mode: d.mode,
      courierLat: d.courierLat,
      courierLng: d.courierLng,
      courierLocatedAt: d.courierLocatedAt,
      traveledMeters: d.traveledMeters,
      // Le coursier suit aussi son client ; le client, lui, ne reçoit que la position du coursier
      ...(d.courierId === userId ? { clientLat: d.clientLat, clientLng: d.clientLng, clientLocatedAt: d.clientLocatedAt } : {}),
    };
  }

  /**
   * Coursier personnel : « Je suis arrivé ». Comme un Speeder sur une course simple, le coursier signale son arrivée chez le client,
   * qui est prévenu et lui donne son code de départ. Idempotent (double appui, renvoi après une coupure réseau).
   */
  async arrive(courierId: string, id: string) {
    const d = await this.prisma.delivery.findUnique({ where: { id }, include: { client: { select: { fullName: true, phone: true } } } });
    if (!d) throw new NotFoundException("Réservation introuvable");
    if (d.courierId !== courierId) throw new ForbiddenException("Cette course n'est pas la tienne");
    if (d.mode !== "PERSONAL") throw new BadRequestException("Seule une course de coursier personnel se signale arrivée.");
    if (d.status !== "MATCHED") {
      throw new BadRequestException("Seul un coursier en route vers son client peut signaler son arrivée.");
    }
    if (d.courierArrivedAt) {
      const [enrichedAgain] = await this.enrich([d]);
      return enrichedAgain;
    }
    const { count } = await this.prisma.delivery.updateMany({ where: { id, courierId, status: "MATCHED", courierArrivedAt: null }, data: { courierArrivedAt: new Date() } });
    const fresh = await this.prisma.delivery.findUniqueOrThrow({ where: { id }, include: { client: { select: { fullName: true, phone: true } } } });
    if (count === 1) {
      await this.notifications
        .push(
          d.clientId,
          "Ton coursier est arrivé 🏍️",
          "Ton coursier personnel est au point de rendez-vous. Donne-lui ton code de départ affiché dans l'application.",
          "DELIVERY",
          { sendPush: true, titleKey: "NOTIFICATION_PERSONAL_ARRIVED", data: { event: "delivery", deliveryId: d.id } }
        )
        .catch(() => null);
    }
    const [enriched] = await this.enrich([fresh]);
    return enriched;
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
    // Coursier personnel : comme sur une course simple, on signale d'abord son arrivée avant de démarrer avec le code
    if (d.mode === "PERSONAL" && !d.courierArrivedAt) {
      throw new BadRequestException("Signale d'abord ton arrivée avec « Je suis arrivé » : ton client te donnera ensuite son code de départ.");
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
      // Le compteur de kilomètres part tout de suite de la position du coursier au départ (au lieu d'attendre un premier relevé valide)
      data: { status: "IN_PROGRESS", courierId: d.courierId ?? userId, odoCred: 0, ...(startAnchor({ lat: d.courierLat, lng: d.courierLng, at: d.courierLocatedAt }) ?? {}) },
      include: { client: { select: { fullName: true, phone: true } } },
    });

    await this.notifications.push(
      d.clientId,
      d.mode === "PERSONAL" ? "Course démarrée ✅" : "Colis pris en charge ✅",
      d.mode === "PERSONAL"
        ? "Ton coursier a validé le code de départ : la course est en cours et les kilomètres comptent à partir de maintenant. Le code de fin est dans l'application."
        : `Le coursier a validé le code de ramassage et se dirige vers ${d.dropAddress}. Ouvre l'application pour voir le code de remise.`,
      "DELIVERY",
      { titleKey: d.mode === "PERSONAL" ? "NOTIFICATION_PERSONAL_STARTED" : "NOTIFICATION_DELIVERY_PICKED_UP", params: { address: d.dropAddress }, data: { event: "delivery", deliveryId: d.id } }
    );

    const [enriched] = await this.enrich([updated]);
    return userId === d.clientId ? enriched : forCourier(enriched);
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

    // Coursier personnel : on fait le point à la fin — base + kilomètres réellement parcourus (GPS) × tarif au km.
    // Sans trace GPS exploitable, on retombe sur la distance estimée à la commande.
    let finalPrice = d.price;
    let finalKm: number | null = null;
    if (d.mode === "PERSONAL" && d.vehicleType) {
      const measuredKm = d.traveledMeters >= 50 ? d.traveledMeters / 1000 : (d.distanceKm ?? 0);
      finalKm = Math.round(measuredKm * 10) / 10;
      finalPrice = this.pricing.personalCourierPrice(d.vehicleType, finalKm);
      // Le client ne peut pas être débité au-delà de son solde : on prélève ce qui est disponible
      const balance = (await this.wallet.getWallet(d.clientId)).balance;
      finalPrice = Math.min(finalPrice, balance);
    }
    const commission = this.pricing.deliveryCommission(finalPrice);
    // Coursier ou livreur dont le téléphone a été fourni par une boutique partenaire : commission téléphone en plus (4 mois, week-ends)
    const courierProfile = await this.prisma.providerProfile.findUnique({ where: { userId: courierId }, select: { phoneSupportedAt: true } });
    const phoneCommission = this.pricing.phoneCommissionFor?.(courierProfile?.phoneSupportedAt, new Date(), finalPrice) ?? 0;
    const net = finalPrice - commission - phoneCommission;

    if (courierId !== d.clientId && finalPrice > 0) {
      await this.wallet.settleDelivery({
        clientId: d.payer === "SENDER" ? d.clientId : null,
        courierId,
        price: finalPrice,
        net,
        commission,
        phoneCommission,
        dropAddress: d.dropAddress,
        ref: id,
      });
    }

    // Le livreur est informé : montant de la mission, pourcentage de commission débité, ce qu'il reçoit
    if (courierId !== d.clientId && finalPrice > 0) {
      const pct = Math.round((commission / finalPrice) * 1000) / 10;
      await this.notifications
        .push(
          courierId,
          "Paiement reçu",
          phoneCommission > 0
            ? `${d.mode === "PERSONAL" ? "Course personnelle" : "Livraison"} ${finalPrice} FCFA · ${pct} % (−${commission} F) pour l'entreprise AZƆ̀ + commission téléphone (−${phoneCommission} F) · tu reçois +${net} FCFA.`
            : d.mode === "PERSONAL"
              ? `Course personnelle ${finalPrice} FCFA · ${pct} % de la course (−${commission} F) est versé à l'entreprise AZƆ̀ · tu reçois +${net} FCFA.`
              : `Livraison ${finalPrice} FCFA · ${pct} % de la livraison (−${commission} F) est versé à l'entreprise AZƆ̀ · tu reçois +${net} FCFA.`,
          "payment",
          {
          titleKey: phoneCommission > 0 ? "NOTIFICATION_DELIVERY_PAID_COURIER_PHONE" : d.mode === "PERSONAL" ? "NOTIFICATION_PERSONAL_PAID_COURIER" : "NOTIFICATION_DELIVERY_PAID_COURIER",
          bodyKey: phoneCommission > 0 ? "NOTIFICATION_DELIVERY_PAID_COURIER_PHONE" : d.mode === "PERSONAL" ? "NOTIFICATION_PERSONAL_PAID_COURIER" : "NOTIFICATION_DELIVERY_PAID_COURIER",
          params: { amount: finalPrice, pct, commission, net, phoneCommission },
          data: { event: "delivery-paid", deliveryId: d.id },
        }
        )
        .catch(() => null);
    }

    const updated = await this.prisma.delivery.update({
      where: { id },
      data: { status: "COMPLETED", courierId, phoneCommission, ...(finalKm !== null ? { price: finalPrice, distanceKm: finalKm } : {}) },
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
      d.mode === "PERSONAL" ? "Course terminée 🎉" : "Livraison terminée 🎉",
      d.mode === "PERSONAL" ? "Ta course avec ton coursier personnel est terminée." : `Ton colis à destination de ${d.dropAddress} a bien été remis avec le code OTP.`,
      "DELIVERY",
      { titleKey: d.mode === "PERSONAL" ? "NOTIFICATION_PERSONAL_DONE" : "NOTIFICATION_DELIVERY_DONE", params: { address: d.dropAddress }, data: { event: "delivery", deliveryId: d.id } }
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
      if (!["PENDING", "OFFERED", "MATCHED"].includes(d.status)) {
        throw new BadRequestException("Impossible d'annuler : le colis est déjà en cours d'acheminement");
      }
      const updated = await this.prisma.delivery.update({
        where: { id },
        data: { status: "CANCELLED" },
        include: { client: { select: { fullName: true, phone: true } } },
      });
      if (d.status === "OFFERED") {
        this.gateway.emitToUser(d.clientId, "delivery:offer-ended", { deliveryId: id, outcome: "cancelled", at: new Date().toISOString() });
      }
      if (d.courierId) {
        await this.notifications.push(
          d.courierId,
          d.mode === "PERSONAL" ? "Course annulée" : "Livraison annulée",
          d.mode === "PERSONAL" ? "Le client a annulé la réservation." : `Le client a annulé la livraison vers ${d.dropAddress}.`,
          "DELIVERY",
          { titleKey: d.mode === "PERSONAL" ? "NOTIFICATION_PERSONAL_CANCELLED" : "NOTIFICATION_DELIVERY_CANCELLED", params: { address: d.dropAddress }, data: { event: "delivery", deliveryId: d.id } }
        );
      }
      const [enriched] = await this.enrich([updated]);
      return enriched;
    }

    if (d.courierId === userId && d.status === "OFFERED") {
      await this.withdrawOffer(id, userId);
      const back = await this.prisma.delivery.findUniqueOrThrow({ where: { id }, include: { client: { select: { fullName: true, phone: true } } } });
      const [enrichedBack] = await this.enrich([back]);
      return { ...enrichedBack, pickupCode: "••••", deliveryCode: "••••", recipientPhone: maskedRecipient(enrichedBack.recipientPhone) };
    }

    if (d.courierId === userId) {
      if (d.status !== "MATCHED") {
        throw new BadRequestException("Impossible d'annuler après avoir pris le colis en charge");
      }
      const updated = await this.prisma.delivery.update({
        where: { id },
        data: { status: "PENDING", courierId: null, bookedFrom: null, bookedUntil: null, courierArrivedAt: null },
        include: { client: { select: { fullName: true, phone: true } } },
      });
      await this.notifications.push(
        d.clientId,
        "Recherche d'un nouveau coursier",
        d.mode === "PERSONAL" ? "Le coursier a dû se désister. Ta réservation est reproposée aux coursiers disponibles." : "Le coursier a dû se désister. Ta livraison est reproposée aux coursiers disponibles.",
        "DELIVERY",
        { titleKey: d.mode === "PERSONAL" ? "NOTIFICATION_PERSONAL_REASSIGN" : "NOTIFICATION_DELIVERY_REASSIGN", data: { event: "delivery", deliveryId: d.id } }
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

  @Get("quote")
  quote(@Query("vehicleType") vehicleType: string, @Query("packageType") packageType: string, @Query("pickupLat") pLat: string, @Query("pickupLng") pLng: string, @Query("dropLat") dLat: string, @Query("dropLng") dLng: string) {
    const [a, b, c, d] = [pLat, pLng, dLat, dLng].map(Number);
    if (![a, b, c, d].every(Number.isFinite)) throw new BadRequestException("Coordonnées invalides.");
    return this.svc.quote(String(vehicleType ?? ""), String(packageType ?? "small"), { lat: a, lng: b }, { lat: c, lng: d });
  }

  @Get("pending")
  pending(@CurrentUser() u, @Query("lat") lat?: string, @Query("lng") lng?: string) {
    const la = lat !== undefined ? Number(lat) : NaN;
    const ln = lng !== undefined ? Number(lng) : NaN;
    return this.svc.pending(u.userId, Number.isFinite(la) && Number.isFinite(ln) ? { lat: la, lng: ln } : undefined);
  }

  @Get("courier")
  courier(@CurrentUser() u) {
    return this.svc.courierDeliveries(u.userId);
  }

  // Propositions de coursiers en attente de la décision du client (déclaré AVANT les routes en :id)
  @Get("offers/pending")
  offersPending(@CurrentUser() u) {
    return this.svc.pendingOffers(u.userId);
  }

  @Post(":id/accept")
  accept(@CurrentUser() u, @Param("id") id: string, @Body() body?: AcceptDto) {
    const pos = typeof body?.lat === "number" && typeof body?.lng === "number" ? { lat: body.lat, lng: body.lng } : undefined;
    return this.svc.accept(u.userId, id, pos);
  }

  @Post(":id/approve-courier")
  approveCourier(@CurrentUser() u, @Param("id") id: string) {
    return this.svc.approveCourier(id, u.userId);
  }

  @Post(":id/decline-courier")
  declineCourier(@CurrentUser() u, @Param("id") id: string) {
    return this.svc.declineCourier(id, u.userId);
  }

  @Post(":id/withdraw-offer")
  withdrawOffer(@CurrentUser() u, @Param("id") id: string) {
    return this.svc.withdrawOffer(id, u.userId);
  }

  @Post(":id/offer-seen")
  offerSeen(@CurrentUser() u, @Param("id") id: string) {
    return this.svc.offerSeen(id, u.userId);
  }

  @Get(":id/courier-profile")
  courierProfile(@CurrentUser() u, @Param("id") id: string) {
    return this.svc.courierProfile(id, u.userId);
  }

  @Post(":id/client-location")
  clientLocation(@CurrentUser() u, @Param("id") id: string, @Body() dto: CourierLocationDto) {
    return this.svc.updateClientLocation(u.userId, id, dto);
  }

  @Post(":id/location")
  location(@CurrentUser() u, @Param("id") id: string, @Body() dto: CourierLocationDto) {
    return this.svc.updateLocation(u.userId, id, dto);
  }

  @Get(":id/track")
  track(@CurrentUser() u, @Param("id") id: string) {
    return this.svc.track(u.userId, id);
  }

  @Post(":id/arrive")
  arrive(@CurrentUser() u, @Param("id") id: string) {
    return this.svc.arrive(u.userId, id);
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

/** Toutes les 5 s : une proposition de coursier sans réponse du client retourne à la recherche. */
@Injectable()
export class DeliveryOfferExpiryTask implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryOfferExpiryTask.name);
  private handle: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deliveries: DeliveryService) {}

  onModuleInit() {
    this.handle = setInterval(() => {
      this.deliveries.expireAllPendingOffers().catch((e) => this.logger.warn(`Balayage des propositions : ${e?.message ?? e}`));
    }, 5_000);
  }

  onModuleDestroy() {
    if (this.handle !== null) clearInterval(this.handle);
    this.handle = null;
  }
}

@Module({
  imports: [WalletModule, NotificationsModule, PricingModule, RidesModule],
  controllers: [DeliveryController],
  providers: [DeliveryService, DeliveryOfferExpiryTask],
})
export class DeliveryModule {}
