import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.module";
import { buildDisplayName, buildDriverDisplayName } from "./display-name";
import { clientStanding, driverStanding } from "./standing";

export type EarningsPeriod = "day" | "week" | "month";

/** Le Bénin est en UTC+1 toute l'année (pas d'heure d'été) : les « jours » des gains suivent cette heure locale. */
const LOCAL_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Délai pour noter un client après la fin de la course. */
export const RATE_CLIENT_WINDOW_MS = 48 * 60 * 60 * 1000;

const localDayKey = (date: Date) => new Date(date.getTime() + LOCAL_OFFSET_MS).toISOString().slice(0, 10);

/**
 * Fonctions « autour de la course » qui ne touchent pas à l'argent : gains détaillés du chauffeur, reçu d'une course
 * terminée, alerte SOS.
 */
@Injectable()
export class RideExtrasService {
  private readonly logger = new Logger(RideExtrasService.name);

  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  /** Gains du chauffeur sur 1, 7 ou 30 jours (jours locaux, aujourd'hui compris), du plus ancien au plus récent. */
  async driverEarnings(driverId: string, period: EarningsPeriod, now: Date = new Date()) {
    const span = period === "day" ? 1 : period === "week" ? 7 : 30;
    const keys: string[] = [];
    for (let i = span - 1; i >= 0; i--) keys.push(localDayKey(new Date(now.getTime() - i * DAY_MS)));
    const from = new Date(`${keys[0]}T00:00:00+01:00`);

    const rides = await this.prisma.ride.findMany({
      where: { driverId, status: "COMPLETED", completedAt: { gte: from } },
      select: { price: true, finalPrice: true, commission: true, completedAt: true },
    });

    const days = keys.map((date) => ({ date, gross: 0, net: 0, rides: 0 }));
    for (const ride of rides) {
      if (!ride.completedAt) continue;
      const day = days.find((d) => d.date === localDayKey(ride.completedAt as Date));
      if (!day) continue;
      const gross = ride.finalPrice ?? ride.price;
      day.gross += gross;
      day.net += gross - (ride.commission ?? 0);
      day.rides += 1;
    }

    const totals = days.reduce(
      (acc, d) => ({ gross: acc.gross + d.gross, net: acc.net + d.net, rides: acc.rides + d.rides }),
      { gross: 0, net: 0, rides: 0 }
    );
    const activeDays = days.filter((d) => d.rides > 0);
    const best = activeDays.reduce<(typeof days)[number] | null>((b, d) => (!b || d.net > b.net ? d : b), null);

    return {
      period,
      from: from.toISOString(),
      days,
      totals: { ...totals, commission: totals.gross - totals.net },
      averagePerActiveDay: activeDays.length ? Math.round(totals.net / activeDays.length) : 0,
      bestDay: best ? { date: best.date, net: best.net } : null,
    };
  }

  /**
   * Le chauffeur note le client (1 à 5) après une course terminée, une seule fois et dans les 48 h. La note moyenne et le
   * nombre de courses du client sont montrés aux autres chauffeurs sur le radar.
   */
  async rateClient(rideId: string, driverId: string, stars: number, now: Date = new Date()) {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      select: { id: true, driverId: true, status: true, clientRating: true, completedAt: true },
    });
    if (!ride || ride.driverId !== driverId) throw new ForbiddenException();
    if (ride.status !== "COMPLETED") throw new BadRequestException("La course doit être terminée pour noter le client.");
    if (ride.clientRating !== null) throw new BadRequestException("Tu as déjà noté ce client pour cette course.");
    if (ride.completedAt && now.getTime() - ride.completedAt.getTime() > RATE_CLIENT_WINDOW_MS) {
      throw new BadRequestException("Le délai pour noter ce client (48 h) est dépassé.");
    }
    await this.prisma.ride.update({ where: { id: rideId }, data: { clientRating: stars, clientRatedAt: now } });
    return { rated: true, stars };
  }

  /** Situation de l'utilisateur au regard de la règle de notation (note récente, avertissement, restriction). */
  standing(userId: string, role: string) {
    return role === "DRIVER" ? driverStanding(this.prisma, userId) : clientStanding(this.prisma, userId);
  }

  /** Reçu d'une course terminée, pour le client ou le chauffeur de cette course. */
  async receipt(rideId: string, userId: string) {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      include: {
        client: { select: { firstName: true, lastName: true, fullName: true } },
        driver: {
          select: {
            firstName: true, lastName: true, fullName: true,
            provider: { select: { fullName: true, vehicleModel: true, plateNumber: true } },
          },
        },
      },
    });
    if (!ride) throw new NotFoundException("Course introuvable");
    const isClient = ride.clientId === userId;
    const isDriver = ride.driverId === userId;
    if (!isClient && !isDriver) throw new ForbiddenException();
    if (ride.status !== "COMPLETED") throw new BadRequestException("Le reçu n'est disponible que pour une course terminée.");

    const amount = ride.finalPrice ?? ride.price;
    const meters = ride.settledDistanceMeters ?? ride.traveledMeters ?? 0;
    const driverName = ride.driver
      ? buildDriverDisplayName({
          providerFullName: ride.driver.provider?.fullName,
          userFullName: ride.driver.fullName,
          firstName: ride.driver.firstName,
          lastName: ride.driver.lastName,
        }).displayName
      : null;

    return {
      reference: `AZO-${ride.id.slice(0, 8).toUpperCase()}`,
      date: (ride.completedAt ?? ride.createdAt).toISOString(),
      currency: "FCFA",
      amount,
      vehicleType: ride.vehicleType,
      originLabel: ride.originLabel ?? null,
      destLabel: ride.destLabel ?? null,
      distanceKm: Math.round((meters / 1000) * 10) / 10,
      priceMode: ride.priceMode ?? "FULL",
      paymentMethod: "WALLET",
      client: buildDisplayName(ride.client ?? {}).displayName,
      driver: driverName,
      vehicle: ride.driver?.provider ? { model: ride.driver.provider.vehicleModel ?? null, plate: ride.driver.provider.plateNumber ?? null } : null,
      // La commission et le gain net ne concernent que le chauffeur
      ...(isDriver ? { commission: ride.commission ?? 0, net: amount - (ride.commission ?? 0) } : {}),
    };
  }

  /**
   * Alerte SOS pendant une course active : prévient les administrateurs (notification poussée enregistrée) et l'autre
   * participant, avec la position si elle est fournie. Les appels aux secours et le SMS au contact d'urgence se
   * font depuis le téléphone ; ici on s'assure qu'AZƆ̀ est au courant.
   */
  async sos(rideId: string, userId: string, position?: { lat?: number; lng?: number }) {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      select: { id: true, clientId: true, driverId: true, status: true },
    });
    if (!ride) throw new NotFoundException("Course introuvable");
    const isClient = ride.clientId === userId;
    const isDriver = ride.driverId === userId;
    if (!isClient && !isDriver) throw new ForbiddenException();
    if (!["MATCHED", "ARRIVED", "IN_PROGRESS"].includes(ride.status)) {
      throw new BadRequestException("L'alerte SOS n'est disponible que pendant une course en cours.");
    }

    const hasPosition = typeof position?.lat === "number" && typeof position?.lng === "number";
    const mapLink = hasPosition ? ` Position : https://maps.google.com/?q=${position!.lat},${position!.lng}` : "";
    const who = isClient ? "Le client" : "Le chauffeur";
    const ref = `#${ride.id.slice(0, 6)}`;
    const data = {
      event: "sos",
      rideId: ride.id,
      by: isClient ? "CLIENT" : "DRIVER",
      ...(hasPosition ? { lat: position!.lat, lng: position!.lng } : {}),
    };

    const admins = await this.prisma.user.findMany({ where: { role: "ADMIN", status: "ACTIVE" }, select: { id: true } });
    await Promise.all(
      admins.map((admin) =>
        this.notifications
          .push(admin.id, "🚨 Alerte SOS", `${who} a déclenché l'alerte SOS pendant la course ${ref}.${mapLink}`, "security", {
            sendPush: true,
            data,
            titleKey: `NOTIFICATION_SOS_ADMIN_${data.by}`,
            params: { ref, link: hasPosition ? `https://maps.google.com/?q=${position!.lat},${position!.lng}` : "" },
          })
          .catch(() => null)
      )
    );

    const otherId = isClient ? ride.driverId : ride.clientId;
    if (otherId) {
      await this.notifications
        .push(otherId, "Alerte de sécurité", `${who} a déclenché une alerte SOS. AZƆ̀ a été prévenu.`, "security", {
          sendPush: true,
          data,
          titleKey: `NOTIFICATION_SOS_PEER_${data.by}`,
        })
        .catch(() => null);
    }

    this.logger.warn(`SOS course ${ride.id} déclenché par ${data.by} (${admins.length} admin(s) prévenu(s))`);
    return { sent: true, notifiedAdmins: admins.length };
  }
}
