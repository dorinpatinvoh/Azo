import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomInt } from "crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { WalletService } from "../wallet/wallet.module";
import { NotificationsService } from "../notifications/notifications.module";
import { PricingService } from "../pricing/pricing.module";
import { RidesGateway } from "./rides.gateway";
import { CreateRideDto } from "./dto/create-ride.dto";
import { LatLng, buildRadar, haversineKm, isRideExpired, rideAgeMinutes } from "./radar";
import { haversineMeters } from "./odometer";
import { buildDisplayName, buildDriverDisplayName } from "./display-name";
import { assertClientAllowed, assertDriverAllowed } from "./standing";
import { clientStatsFor } from "./client-stats";
import { SCHEDULE_RELEASE_LEAD_MIN, isWaitingForRelease, parseSchedule, withReleaseAsCreation } from "./schedule";
import { offerPushText } from "./offer-texts";

// Le client attaché à la course, tel que le chauffeur le reçoit.
// On envoie firstName, lastName, fullName, phone pour pouvoir calculer displayName.
const WITH_CLIENT = {
  client: { select: { fullName: true, phone: true, firstName: true, lastName: true } },
} as const;

// Le Zem avec son dossier prestataire (pour le profil public)
const WITH_DRIVER_PROFILE = {
  driver: {
    select: {
      fullName: true,
      phone: true,
      firstName: true,
      lastName: true,
      createdAt: true,
      provider: {
        select: {
          fullName: true,
          city: true,
          zones: true,
          bio: true,
          experienceYears: true,
          vehicleType: true,
          vehicleModel: true,
          plateNumber: true,
          status: true,
          kycScore: true,
          rating: true,
          ratingCount: true,
          jobsCompleted: true,
          agencyName: true,
        },
      },
    },
  },
} as const;

function createPickupCode(): string {
  return String(randomInt(0, 10_000)).padStart(4, "0");
}

/** Masque la plaque : « AB-1234-CD » → « ••-••34-CD » (2 derniers chiffres + suffixe) */
function maskPlate(plate: string | null | undefined): string | null {
  if (!plate) return null;
  const parts = plate.replace(/\s/g, "").split("-");
  if (parts.length < 2) {
    // Format non standard : masquer tout sauf les 2 derniers caractères
    return "••" + plate.slice(-2);
  }
  const masked = parts.map((part, i) => {
    if (i === parts.length - 1) return part; // dernier segment conservé
    return "••"; // segments intermédiaires masqués
  });
  return masked.join("-");
}

@Injectable()
export class RidesService {
  private readonly routeCache = new Map<string, { expiresAt: number; route: Record<string, unknown> }>();
  private readonly lastValidRoutes = new Map<string, Record<string, unknown>>();
  private readonly logger = new Logger(RidesService.name);

  constructor(
    private prisma: PrismaService,
    private wallet: WalletService,
    private notifications: NotificationsService,
    private pricing: PricingService,
    private gateway: RidesGateway
  ) {}

  private async drivingRoute(dto: CreateRideDto): Promise<{ distanceKm: number; durationMinutes: number }> {
    const coordinates = `${dto.originLng},${dto.originLat};${dto.destLng},${dto.destLat}`;
    const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=false&steps=false`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`OSRM HTTP ${response.status}`);

      const result: unknown = await response.json();
      const route =
        typeof result === "object" && result !== null && "routes" in result && Array.isArray(result.routes)
          ? result.routes[0]
          : null;
      if (
        typeof route !== "object" ||
        route === null ||
        !("distance" in route) ||
        typeof route.distance !== "number" ||
        !Number.isFinite(route.distance) ||
        route.distance <= 0 ||
        !("duration" in route) ||
        typeof route.duration !== "number" ||
        !Number.isFinite(route.duration) ||
        route.duration <= 0
      ) {
        throw new Error("OSRM returned no valid route");
      }

      return {
        distanceKm: route.distance / 1000,
        durationMinutes: Math.max(1, Math.ceil(route.duration / 60)),
      };
    } catch (error) {
      throw new ServiceUnavailableException(
        "Impossible de calculer l’itinéraire routier pour le moment. Réessaie dans quelques instants.",
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  // Estimation affichée avant confirmation (écran "Sélection trajet").
  // La distance, l'ETA et le prix sont basés sur le même itinéraire routier.
  async estimate(dto: CreateRideDto) {
    const route = await this.drivingRoute(dto);
    const km = route.distanceKm;
    const breakdown = this.pricing.breakdown(km, dto.vehicleType);
    return {
      distanceKm: Number(km.toFixed(1)),
      etaMinutes: route.durationMinutes,
      durationMin: route.durationMinutes,
      price: breakdown.price,
      gamme: breakdown.gamme,
      breakdown,
    };
  }

  async route(rideId: string, userId: string, stage?: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundException("Course introuvable");
    if (ride.clientId !== userId && ride.driverId !== userId) throw new ForbiddenException();

    if (stage === "trip") {
      // Trajet départ → destination (fixe pendant toute la course)
      const allowedForTrip = ["MATCHED", "ARRIVED", "IN_PROGRESS"];
      if (!allowedForTrip.includes(ride.status)) {
        throw new BadRequestException("L'itinéraire du trajet n'est disponible que pendant une course active.");
      }
      return this.tripRoute(rideId, ride);
    }

    if (stage !== undefined && stage !== "current") {
      throw new BadRequestException("Valeur de stage inconnue. Valeurs acceptées : current (défaut), trip");
    }

    if (!["MATCHED", "ARRIVED", "IN_PROGRESS"].includes(ride.status)) {
      throw new BadRequestException("L'itinéraire n'est plus disponible pour cette course.");
    }

    const inProgress = ride.status === "IN_PROGRESS";
    const from = {
      lat: ride.driverLat ?? ride.odoLat ?? ride.originLat,
      lng: ride.driverLng ?? ride.odoLng ?? ride.originLng,
    };
    const to = inProgress
      ? { lat: ride.destLat, lng: ride.destLng }
      : { lat: ride.originLat, lng: ride.originLng };
    const stageKey = inProgress ? "destination" : "pickup";
    const latitudeGrid = Math.round(from.lat / (50 / 111_195));
    const longitudeMetersPerDegree = 111_195 * Math.max(0.1, Math.cos((from.lat * Math.PI) / 180));
    const longitudeGrid = Math.round(from.lng / (50 / longitudeMetersPerDegree));
    const cacheKey = `${rideId}:${stageKey}:${latitudeGrid}:${longitudeGrid}`;
    const cached = this.routeCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.route;

    const routeKey = `${rideId}:${stageKey}`;
    return this.fetchOsrmRoute(rideId, routeKey, stageKey, from, to, cacheKey);
  }

  /** Trajet fixe départ → destination, mis en cache 10 minutes par rideId. */
  private async tripRoute(rideId: string, ride: { originLat: number; originLng: number; destLat: number; destLng: number }) {
    const cacheKey = `${rideId}:trip`;
    const cached = this.routeCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.route;

    const from = { lat: ride.originLat, lng: ride.originLng };
    const to = { lat: ride.destLat, lng: ride.destLng };
    return this.fetchOsrmRoute(rideId, `${rideId}:trip`, "trip", from, to, cacheKey, 10 * 60 * 1000);
  }

  private async fetchOsrmRoute(
    rideId: string,
    routeKey: string,
    stage: string,
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    cacheKey: string,
    cacheTtlMs?: number
  ): Promise<Record<string, unknown>> {
    const routeCoordinates = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${routeCoordinates}?overview=full&geometries=geojson&steps=false`,
        { signal: controller.signal }
      );
      if (!response.ok) throw new Error(`OSRM HTTP ${response.status}`);
      const result: unknown = await response.json();
      const candidate =
        typeof result === "object" && result !== null && "routes" in result && Array.isArray(result.routes)
          ? result.routes[0]
          : null;
      if (
        typeof candidate !== "object" || candidate === null ||
        !("distance" in candidate) || typeof candidate.distance !== "number" ||
        !("duration" in candidate) || typeof candidate.duration !== "number" ||
        !("geometry" in candidate) || typeof candidate.geometry !== "object" ||
        candidate.geometry === null || !("coordinates" in candidate.geometry) ||
        !Array.isArray(candidate.geometry.coordinates)
      ) {
        throw new Error("OSRM returned no valid route geometry");
      }
      const simplifiedCoordinates = this.simplifyRouteCoordinates(candidate.geometry.coordinates);
      if (simplifiedCoordinates.length < 2) throw new Error("OSRM route geometry is empty");
      const computedAt = new Date().toISOString();
      const route = {
        rideId, stage, coordinates: simplifiedCoordinates,
        distanceKm: candidate.distance / 1000,
        durationMinutes: Math.max(1, Math.ceil(candidate.duration / 60)),
        computedAt, fallback: false,
      };
      if (this.lastValidRoutes.size >= 500 && !this.lastValidRoutes.has(routeKey)) {
        const oldestRouteKey = this.lastValidRoutes.keys().next().value;
        if (oldestRouteKey) this.lastValidRoutes.delete(oldestRouteKey);
      }
      this.lastValidRoutes.set(routeKey, route);
      for (const [key, entry] of this.routeCache) {
        if (entry.expiresAt <= Date.now()) this.routeCache.delete(key);
      }
      if (this.routeCache.size >= 500) {
        const oldestKey = this.routeCache.keys().next().value;
        if (oldestKey) this.routeCache.delete(oldestKey);
      }
      const ttl = cacheTtlMs ?? (this.pricing.rideSettings().routeCacheSeconds * 1000);
      this.routeCache.set(cacheKey, { expiresAt: Date.now() + ttl, route });
      return route;
    } catch {
      const lastValid = this.lastValidRoutes.get(routeKey);
      if (lastValid) return { ...lastValid, fallback: true };
      throw new ServiceUnavailableException("L'itinéraire routier est temporairement indisponible.");
    } finally {
      clearTimeout(timeout);
    }
  }

  private simplifyRouteCoordinates(raw: unknown[]): Array<{ latitude: number; longitude: number }> {
    const valid = raw
      .filter(
        (point): point is number[] =>
          Array.isArray(point) &&
          point.length >= 2 &&
          typeof point[0] === "number" &&
          Number.isFinite(point[0]) &&
          typeof point[1] === "number" &&
          Number.isFinite(point[1])
      )
      .map(([longitude, latitude]) => ({ latitude, longitude }));
    if (valid.length <= 250) return valid;
    const simplified: Array<{ latitude: number; longitude: number }> = [];
    const stride = (valid.length - 1) / 249;
    for (let i = 0; i < 249; i++) simplified.push(valid[Math.floor(i * stride)]);
    simplified.push(valid[valid.length - 1]);
    return simplified;
  }

  async create(clientId: string, dto: CreateRideDto) {
    // Note récente trop basse : plus de nouvelle demande de course (voir standing.ts)
    await assertClientAllowed(this.prisma, clientId);
    const { scheduledAt: scheduledRaw, ...rideDto } = dto;
    // Course programmée : l'heure est vérifiée (30 min à 7 jours d'avance) avant tout calcul
    const scheduledAt = scheduledRaw ? parseSchedule(scheduledRaw) : null;
    const { price } = await this.estimate(rideDto as CreateRideDto);
    const ride = await this.prisma.ride.create({
      data: {
        ...rideDto,
        clientId,
        price,
        commission: 0,
        status: "PENDING",
        pickupCode: createPickupCode(),
        originLabel: dto.originLabel ?? null,
        destLabel: dto.destLabel ?? null,
        scheduledAt,
      },
    });

    // Course programmée : aucune diffusion maintenant, la demande sera ouverte aux chauffeurs peu avant l'heure
    // (releaseDueScheduledRides, tâche périodique).
    if (!scheduledAt) await this.publishRequest(ride, clientId);

    // Le code reste côté serveur jusqu'à l'arrivée du chauffeur.
    return this.withoutPickupCode(ride);
  }

  /** Diffuse une demande aux chauffeurs : notifications in-app + événement temps réel pour les radars ouverts. */
  private async publishRequest(
    ride: { id: string; vehicleType: any; price: number; originLat: number; originLng: number },
    clientId: string
  ) {
    const clientRaw = await this.prisma.user.findUnique({
      where: { id: clientId },
      select: { firstName: true, lastName: true, fullName: true },
    });
    const { displayName: clientDisplayName } = buildDisplayName(clientRaw ?? {});
    await this.notifyMatchingDrivers(ride.vehicleType, ride.price, ride.originLat, ride.originLng, clientDisplayName).catch(() => 0);
    this.gateway.emitNewRequest({
      rideId: ride.id,
      vehicleType: ride.vehicleType,
      price: ride.price,
      originLat: ride.originLat,
      originLng: ride.originLng,
      clientDisplayName,
    });
  }

  private lastScheduledSweep = 0;

  /**
   * Filet de sécurité : la tâche périodique ne tourne pas quand le serveur dort (offre gratuite de Render, qui s'endort après
   * ~15 min sans appel). Dès qu'une requête le réveille (un chauffeur ouvre son radar, un client suit sa course), les
   * courses programmées dont l'heure d'ouverture est passée sont publiées. Au plus une fois toutes les 15 s, sans attendre.
   */
  private sweepScheduledRides() {
    const now = Date.now();
    if (now - this.lastScheduledSweep < 15_000) return;
    this.lastScheduledSweep = now;
    void this.releaseDueScheduledRides().catch(() => undefined);
  }

  /**
   * Ouvre aux chauffeurs les courses programmées dont l'heure approche (SCHEDULE_RELEASE_LEAD_MIN avant). Appelée
   * toutes les 30 s ; l'écriture est conditionnée à `scheduledReleasedAt: null` : une demande n'est jamais publiée deux fois.
   */
  async releaseDueScheduledRides(now: Date = new Date()): Promise<number> {
    const horizon = new Date(now.getTime() + SCHEDULE_RELEASE_LEAD_MIN * 60_000);
    const due = await this.prisma.ride.findMany({
      where: { status: "PENDING", scheduledReleasedAt: null, scheduledAt: { not: null, lte: horizon } },
      take: 50,
    });
    let released = 0;
    for (const ride of due) {
      const { count } = await this.prisma.ride.updateMany({
        where: { id: ride.id, status: "PENDING", scheduledReleasedAt: null },
        data: { scheduledReleasedAt: now },
      });
      if (count === 0) continue;
      released += 1;
      await this.publishRequest(ride, ride.clientId).catch((e) => this.logger.warn(`publishRequest ${ride.id} : ${e?.message ?? e}`));
      await this.notifications
        .push(ride.clientId, "Ta course programmée est ouverte", "Nous cherchons un chauffeur pour l'heure prévue.", "ride", {
          data: { event: "ride-scheduled-open", rideId: ride.id },
          titleKey: "NOTIFICATION_RIDE_SCHEDULED_OPEN",
        })
        .catch(() => null);
    }
    return released;
  }

  /**
   * Prévient les chauffeurs disponibles qu'une demande vient d'être publiée.
   *
   * Seuls les chauffeurs dont le dossier est **validé** (`APPROVED`) et dont le véhicule
   * correspond à la demande sont prévenus — la même règle que le radar
   * (`pricing.rideVisibleFor`), dans la limite de `radar.driverNotificationMax` pour ne
   * pas inonder la base sur une place très fréquentée.
   */
  private async notifyMatchingDrivers(vehicleType: string, price: number, originLat: number, originLng: number, clientDisplayName: string | null): Promise<number> {
    const settings = this.pricing.radarSettings();
    const candidates = await this.prisma.user.findMany({
      where: { role: "DRIVER", provider: { is: { status: "APPROVED" } } },
      select: { id: true, provider: { select: { vehicleType: true } } },
      take: 500,
    });
    const targets = candidates
      .filter((candidate) => this.pricing.rideVisibleFor(candidate.provider?.vehicleType ?? null, vehicleType))
      .slice(0, settings.driverNotificationMax);

    await Promise.all(
      targets.map((target) =>
        this.notifications.push(
          target.id,
          "Nouvelle demande de course",
          `${this.pricing.vehicleLabel(vehicleType)} · ${price} FCFA — ouvre ton radar pour la prendre.`,
          "ride",
          {
            titleKey: "NOTIFICATION_RIDE_NEW_REQUEST",
            bodyKey: "NOTIFICATION_RIDE_NEW_REQUEST_BODY",
            params: { vehicleLabel: this.pricing.vehicleLabel(vehicleType), price },
          }
        )
      )
    );
    return targets.length;
  }

  /**
   * Annule les demandes restées trop longtemps sans chauffeur.
   *
   * Le balayage est « paresseux » : il a lieu quand un chauffeur ouvre son radar ou quand
   * le client recharge le suivi de sa course — inutile d'ajouter une tâche planifiée pour
   * un besoin qui n'a de sens que devant un écran. L'écriture est conditionnée au statut
   * `PENDING` (`updateMany`) : une course acceptée entre-temps n'est jamais annulée.
   * Aucun débit : le client n'est facturé qu'à la fin de la course.
   */
  private async expireRide(ride: { id: string; clientId: string }): Promise<boolean> {
    const { count } = await this.prisma.ride.updateMany({
      where: { id: ride.id, status: "PENDING" },
      data: {
        status: "CANCELLED",
        driverLat: null,
        driverLng: null,
        driverHeading: null,
        driverSpeed: null,
        driverLocatedAt: null,
        clientLat: null,
        clientLng: null,
        clientLocatedAt: null,
      },
    });
    if (count === 0) return false;

    this.gateway.clearRideLocations(ride.id);
    const minutes = this.pricing.radarSettings().pendingExpiryMinutes;
    await this.notifications.push(ride.clientId, "Aucun chauffeur trouvé",
      `Ta demande est restée ${minutes} min sans chauffeur disponible : elle a été annulée. Aucun montant n'a été débité — relance une recherche.`,
      "ride",
      {
        titleKey: "NOTIFICATION_RIDE_NO_DRIVER",
        bodyKey: "NOTIFICATION_RIDE_NO_DRIVER_BODY",
        params: { minutes },
      }
    );
    this.gateway.emitStatus(ride.id, "CANCELLED");
    this.gateway.emitRideRemoved(ride.id, "expired");
    return true;
  }

  /**
   * Courses en attente visibles par un chauffeur (écran « Radar »).
   *
   * Le radar applique la règle de visibilité de la configuration tarifaire
   * (`pricing.rideVisibleFor`) : par défaut un prestataire ne voit que les demandes du
   * véhicule EXACT qu'il a déclaré — un Zem à essence ne voit donc pas les demandes de
   * Zem électrique, et Gazelle ≠ Koala ≠ Léopard. Le mode souple (deux Zem qui
   * partagent leurs demandes) s'active dans `tarification.json` (`radar.strictVehicleMatch`).
   *
   * Les coursiers (livraison) ne reçoivent pas les demandes de transport : leur espace
   * de missions est `GET /delivery/available`.
   */
  async pending(driverId: string, position?: LatLng, radiusKm?: number) {
    const driver = await this.prisma.user.findUnique({
      where: { id: driverId },
      include: { provider: true },
    });
    if (driver?.provider?.type === "COURIER") return [];

    const driverVehicle = driver?.provider?.vehicleType ?? null;
    const settings = this.pricing.radarSettings();
    // Rayon : paramètre explicite → nearbyRadiusKm (10) comme défaut pour le radar avec position
    const effectiveRadius =
      typeof radiusKm === "number"
        ? Math.min(Math.max(1, radiusKm), settings.maxRadiusKm)
        : settings.nearbyRadiusKm;

    const rides = await this.prisma.ride.findMany({
      where: {
        status: "PENDING",
        // Exclure les demandes où ce Zem a déjà été refusé / retiré
        NOT: { declinedDriverIds: { has: driverId } },
        // Une course programmée n'apparaît qu'une fois ouverte aux chauffeurs
        OR: [{ scheduledAt: null }, { scheduledReleasedAt: { not: null } }],
      },
      include: {
        client: { select: { fullName: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const { rides: radar, expired } = buildRadar(rides.map(withReleaseAsCreation), {
      expiryMinutes: settings.pendingExpiryMinutes,
      radiusKm: effectiveRadius,
      driver: position ?? null,
    });

    if (expired.length > 0) {
      await Promise.all(expired.map((ride) => this.expireRide(ride).catch(() => false)));
    }

    this.sweepScheduledRides();
    const visible = radar.filter((ride) => this.pricing.rideVisibleFor(driverVehicle, ride.vehicleType));
    // Note moyenne et nombre de courses de chaque client, pour que le Zem décide en connaissance de cause
    const stats = await clientStatsFor(this.prisma, visible.map((ride) => ride.clientId));

    return visible.map((ride) => {
      const { client, ...rest } = ride as typeof ride & { client: { fullName: string | null; firstName: string | null; lastName: string | null } };
      const { displayName, firstName } = buildDisplayName(client ?? {});
      // Ne pas envoyer fullName ni le téléphone dans le radar
      return {
        ...this.withoutPickupCode(rest),
        client: { displayName, firstName, ...(stats ? stats.get(ride.clientId) : {}) },
      };
    });
  }

  /** Résumé rapide pour le compteur du radar (GET /rides/pending/summary). */
  async pendingSummary(driverId: string, position: LatLng) {
    const driver = await this.prisma.user.findUnique({
      where: { id: driverId },
      include: { provider: true },
    });
    if (driver?.provider?.type === "COURIER") return { radiusKm: 0, count: 0, nearestKm: null };

    const driverVehicle = driver?.provider?.vehicleType ?? null;
    const settings = this.pricing.radarSettings();
    const radiusKm = settings.nearbyRadiusKm;

    const rides = await this.prisma.ride.findMany({
      where: {
        status: "PENDING",
        NOT: { declinedDriverIds: { has: driverId } },
        OR: [{ scheduledAt: null }, { scheduledReleasedAt: { not: null } }],
      },
      select: { id: true, clientId: true, vehicleType: true, createdAt: true, originLat: true, originLng: true, scheduledAt: true, scheduledReleasedAt: true },
      orderBy: { createdAt: "asc" },
    });

    this.sweepScheduledRides();
    const { rides: radar, expired } = buildRadar(rides.map(withReleaseAsCreation), {
      expiryMinutes: settings.pendingExpiryMinutes,
      radiusKm,
      driver: position,
    });

    if (expired.length > 0) {
      await Promise.all(expired.map((ride) => this.expireRide(ride).catch(() => false)));
    }

    const filtered = radar.filter((ride) =>
      this.pricing.rideVisibleFor(driverVehicle, ride.vehicleType)
    );

    const nearestKm =
      filtered.length === 0
        ? null
        : Math.round(Math.min(...filtered.map((r) => r.distanceKm ?? Infinity)) * 10) / 10;

    return { radiusKm, count: filtered.length, nearestKm };
  }

  // Un chauffeur ne peut conduire qu'une course à la fois (ni en OFFERED, ni en course active)
  private async assertDriverIsFree(driverId: string) {
    const current = await this.prisma.ride.findFirst({
      where: { driverId, status: { in: ["OFFERED", "MATCHED", "ARRIVED", "IN_PROGRESS"] } },
      select: { id: true, status: true },
    });
    if (current) throw new BadRequestException("Tu as déjà une proposition ou une course en cours");
  }

  // Acceptation atomique : `updateMany` avec le statut dans le WHERE évite que deux
  // chauffeurs prennent la même course en même temps (avant : lecture puis écriture).
  async accept(rideId: string, driverId: string) {
    // Note récente trop basse : plus de nouvelle course à accepter (voir standing.ts)
    await assertDriverAllowed(this.prisma, driverId);
    await this.assertDriverIsFree(driverId);

    const settings = this.pricing.rideSettings();
    const requireApproval = settings.requireClientApproval;

    // Vérifier que le Zem n'a pas déjà été exclu de cette demande
    const rideCheck = await this.prisma.ride.findUnique({
      where: { id: rideId },
      select: { id: true, declinedDriverIds: true, status: true, createdAt: true, scheduledAt: true, scheduledReleasedAt: true },
    });
    if (!rideCheck) throw new NotFoundException("Course introuvable");
    if (rideCheck.status !== "PENDING") throw new BadRequestException("Course déjà prise");
    if (isWaitingForRelease(rideCheck)) {
      throw new BadRequestException("Cette course est programmée : elle sera ouverte aux chauffeurs peu avant l'heure prévue.");
    }
    if (rideCheck.declinedDriverIds.includes(driverId)) {
      throw new ForbiddenException("Le client a déjà refusé cette proposition");
    }

    if (requireApproval) {
      // Mode confirmation : PENDING → OFFERED
      const offeredAt = new Date();
      const offerExpiresAt = new Date(offeredAt.getTime() + settings.offerExpirySeconds * 1000);
      const { count } = await this.prisma.ride.updateMany({
        where: { id: rideId, status: "PENDING", driverId: null },
        data: { driverId, status: "OFFERED", offeredAt, offerExpiresAt },
      });
      if (count === 0) throw new BadRequestException("Course déjà prise");

      const ride = await this.prisma.ride.findUniqueOrThrow({ where: { id: rideId }, include: WITH_CLIENT });
      this.gateway.invalidateRideLocationContext(rideId);
      await this.openOffer(rideId, driverId, offerExpiresAt);
      // Popup du client : événement temps réel + notification poussée. NON bloquant : la réponse au Zem ne
      // doit jamais attendre la livraison d'une notification (l'API Expo peut mettre 6 s à répondre).
      void this.announceOffer(rideId).catch((e) => this.logger.warn(`announceOffer ${rideId} : ${e?.message ?? e}`));
      this.gateway.emitStatus(rideId, "OFFERED");
      this.gateway.emitRideRemoved(rideId, "offered");
      return this.withoutPickupCode(ride);
    } else {
      // Mode legacy : PENDING → MATCHED directement
      const { count } = await this.prisma.ride.updateMany({
        where: { id: rideId, status: "PENDING", driverId: null },
        data: { driverId, status: "MATCHED", matchedAt: new Date() },
      });
      if (count === 0) throw new BadRequestException("Course déjà prise");

      const ride = await this.prisma.ride.findUniqueOrThrow({ where: { id: rideId }, include: WITH_CLIENT });
      this.gateway.invalidateRideLocationContext(rideId);
      await this.notifications.push(ride.clientId, "Chauffeur trouvé", "Un chauffeur a accepté ta course et arrive vers toi.", "ride", {
        titleKey: "NOTIFICATION_RIDE_MATCHED",
        bodyKey: "NOTIFICATION_RIDE_MATCHED_BODY",
      });
      this.gateway.emitStatus(rideId, "MATCHED");
      this.gateway.emitRideRemoved(rideId, "taken");
      return this.withoutPickupCode(ride);
    }
  }

  /** Client confirme la proposition du Zem → OFFERED → MATCHED */
  async approveDriver(rideId: string, clientId: string) {
    await this.expireOfferedIfNeeded(rideId);
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundException("Course introuvable");
    if (ride.clientId !== clientId) throw new ForbiddenException();
    if (ride.status === "MATCHED") {
      const full = await this.prisma.ride.findUniqueOrThrow({ where: { id: rideId }, include: WITH_CLIENT });
      return this.visibleRideToUser(full, clientId);
    }
    if (ride.status !== "OFFERED") throw this.offerEnded("Cette proposition n'est plus disponible");
    // Marge de confirmation : on absorbe la latence réseau après la fin du compte à rebours
    const cutoff = new Date(Date.now() - this.offerGraceMs());
    if (!ride.offerExpiresAt || ride.offerExpiresAt < cutoff) throw this.offerEnded("La proposition a expiré");
    const { count } = await this.prisma.ride.updateMany({
      where: { id: rideId, clientId, status: "OFFERED", offerExpiresAt: { gt: cutoff } },
      data: { status: "MATCHED", matchedAt: new Date(), offeredAt: null, offerExpiresAt: null, offerSeenAt: null },
    });
    if (count === 0) throw this.offerEnded("La proposition a expiré ou n'est plus disponible");
    this.gateway.emitOfferEnded(clientId, rideId, "approved");
    await this.closeOffer(rideId, ride.driverId, "APPROVED");
    const updated = await this.prisma.ride.findUniqueOrThrow({ where: { id: rideId }, include: WITH_CLIENT });
    this.gateway.invalidateRideLocationContext(rideId);
    if (ride.driverId) {
      await this.notifications.push(ride.driverId, "Le client t'a choisi", "Rejoins le point de prise en charge.", "ride", {
        sendPush: true,
        data: { event: "ride-approved", rideId },
        titleKey: "NOTIFICATION_RIDE_APPROVED",
        bodyKey: "NOTIFICATION_RIDE_APPROVED_BODY",
      }).catch(() => null);
    }
    this.gateway.emitStatus(rideId, "MATCHED");
    return this.visibleRideToUser(updated, clientId);
  }

  /** Client refuse la proposition du Zem → OFFERED → PENDING (Zem exclu) */
  async declineDriver(rideId: string, clientId: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundException("Course introuvable");
    if (ride.clientId !== clientId) throw new ForbiddenException();
    if (ride.status !== "OFFERED") throw this.offerEnded("Aucune proposition à refuser");
    return this.revertOfferToPending(ride, ride.driverId, "declined");
  }

  /** Zem retire sa proposition → OFFERED → PENDING (Zem exclu) */
  async withdrawOffer(rideId: string, driverId: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundException("Course introuvable");
    if (ride.driverId !== driverId) throw new ForbiddenException("Cette proposition ne vous est pas attribuée");
    if (ride.status === "MATCHED") throw new BadRequestException("La course est déjà confirmée. Utilise l'annulation normale.");
    if (ride.status !== "OFFERED") throw this.offerEnded("Aucune proposition à retirer");
    return this.revertOfferToPending(ride, driverId, "withdrawn");
  }

  private async revertOfferToPending(
    ride: { id: string; clientId: string; driverId: string | null; status: string; declinedDriverIds: string[] },
    driverId: string | null,
    reason: "declined" | "withdrawn" | "expired"
  ) {
    const newDeclined = driverId && !ride.declinedDriverIds.includes(driverId)
      ? [...ride.declinedDriverIds, driverId]
      : ride.declinedDriverIds;

    const { count } = await this.prisma.ride.updateMany({
      where: { id: ride.id, status: "OFFERED" },
      data: { status: "PENDING", driverId: null, offeredAt: null, offerExpiresAt: null, offerSeenAt: null, declinedDriverIds: newDeclined },
    });
    if (count === 0) return { rideId: ride.id, status: "PENDING" };

    // Ferme la popup du client et retire la notification qui serait restée dans sa barre (sauf s'il vient de refuser lui-même)
    this.gateway.emitOfferEnded(ride.clientId, ride.id, reason);
    await this.closeOffer(ride.id, driverId, reason.toUpperCase() as "DECLINED" | "EXPIRED" | "WITHDRAWN");
    if (reason !== "declined") {
      void this.notifications
        .pushSilent?.(ride.clientId, { event: "ride-offer-ended", rideId: ride.id, outcome: reason }, { channelId: "ride-offers" })
        ?.catch?.(() => null);
    }

    if (driverId && reason === "declined") {
      await this.notifications.push(driverId, "Le client a choisi un autre Zem.", "Tu peux accepter une autre demande.", "ride",
        { sendPush: true, data: { event: "ride-declined", rideId: ride.id }, titleKey: "NOTIFICATION_RIDE_DECLINED" }
      ).catch(() => null);
    }
    if (driverId && reason === "withdrawn") {
      await this.notifications.push(ride.clientId, "Le Zem a retiré sa proposition.", "Nous cherchons un autre Zem.", "ride",
        { titleKey: "NOTIFICATION_RIDE_WITHDRAWN", bodyKey: "NOTIFICATION_RIDE_WITHDRAWN_BODY" }
      ).catch(() => null);
    }
    if (driverId && reason === "expired") {
      await this.notifications.push(driverId, "Le client n'a pas répondu à ta proposition.", "", "ride",
        { sendPush: true, data: { event: "ride-offer-expired", rideId: ride.id }, titleKey: "NOTIFICATION_RIDE_OFFER_EXPIRED" }
      ).catch(() => null);
    }

    const updated = await this.prisma.ride.findUnique({
      where: { id: ride.id },
      select: { vehicleType: true, price: true, originLat: true, originLng: true,
                client: { select: { firstName: true, lastName: true, fullName: true } } as any },
    });
    if (updated) {
      const clientData = (updated as any).client ?? {};
      const { displayName } = buildDisplayName(clientData);
      this.gateway.emitNewRequest({
        rideId: ride.id,
        vehicleType: updated.vehicleType,
        price: updated.price,
        originLat: updated.originLat,
        originLng: updated.originLng,
        clientDisplayName: displayName,
      });
    }
    return { rideId: ride.id, status: "PENDING" };
  }

  private async expireOfferedIfNeeded(rideId: string): Promise<boolean> {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      select: { id: true, clientId: true, driverId: true, status: true, declinedDriverIds: true, offerExpiresAt: true },
    });
    if (!ride || ride.status !== "OFFERED") return false;
    if (!ride.offerExpiresAt || ride.offerExpiresAt > new Date(Date.now() - this.offerGraceMs())) return false;
    await this.revertOfferToPending(ride, ride.driverId, "expired");
    return true;
  }

  async expireAllPendingOffers(): Promise<void> {
    const expired = await this.prisma.ride.findMany({
      where: { status: "OFFERED", offerExpiresAt: { lt: new Date(Date.now() - this.offerGraceMs()) } },
      select: { id: true, clientId: true, driverId: true, status: true, declinedDriverIds: true, offerExpiresAt: true },
    });
    await Promise.all(
      expired.map((ride) =>
        this.revertOfferToPending(ride, ride.driverId, "expired").catch((e) => {
          this.logger.warn(`expireAllPendingOffers: ${ride.id} — ${e?.message}`);
        })
      )
    );
  }

  /** Ouvre la ligne d'historique d'une proposition. Ne doit jamais faire échouer l'acceptation. */
  private async openOffer(rideId: string, driverId: string, expiresAt: Date) {
    try {
      await this.prisma.rideOffer.create({ data: { rideId, driverId, status: "OFFERED", expiresAt } });
    } catch (e: any) {
      this.logger.warn(`openOffer ${rideId} : ${e?.message ?? e}`);
    }
  }

  /** Clôt la proposition ouverte de ce Zem et le prévient en temps réel (la room user: suffit, il n'a pas rejoint la course). */
  private async closeOffer(
    rideId: string,
    driverId: string | null,
    status: "APPROVED" | "DECLINED" | "EXPIRED" | "WITHDRAWN" | "CANCELLED"
  ) {
    if (!driverId) return;
    try {
      await this.prisma.rideOffer.updateMany({
        where: { rideId, driverId, status: "OFFERED" },
        data: { status, endedAt: new Date() },
      });
    } catch (e: any) {
      this.logger.warn(`closeOffer ${rideId} : ${e?.message ?? e}`);
    }
    if (status === "APPROVED") this.gateway.emitOfferApproved(driverId, rideId);
    else this.gateway.emitOfferEnded(driverId, rideId, status.toLowerCase() as "declined" | "expired" | "withdrawn" | "cancelled");
  }

  /** Vue restreinte pour un Zem détaché de la course : jamais de position, de téléphone ni de nom complet du client. */
  private async endedOfferView(rideId: string, userId: string) {
    let last: { status: string; endedAt: Date | null } | null = null;
    try {
      last = await this.prisma.rideOffer.findFirst({
        where: { rideId, driverId: userId, status: { not: "OFFERED" }, endedAt: { gt: new Date(Date.now() - 24 * 3600 * 1000) } },
        orderBy: { endedAt: "desc" },
      });
    } catch {
      last = null;
    }
    if (!last) return null;
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId }, select: { status: true } });
    if (!ride) return null;
    return {
      id: rideId,
      status: ride.status,
      driverId: null,
      offerOutcome: last.status.toLowerCase(),
      offerEndedAt: last.endedAt?.toISOString() ?? null,
    };
  }

  /** Ma proposition en cours : reprise après redémarrage de l'application du Zem. */
  async currentOffer(driverId: string) {
    const now = new Date();
    const ride = await this.prisma.ride.findFirst({
      where: { driverId, status: "OFFERED", offerExpiresAt: { gt: new Date(now.getTime() - this.offerGraceMs()) } },
      select: { id: true, price: true, vehicleType: true, originLabel: true, destLabel: true, offerExpiresAt: true, offerSeenAt: true },
    });
    let ended: { rideId: string; status: string; endedAt: Date | null } | null = null;
    try {
      ended = await this.prisma.rideOffer.findFirst({
        where: { driverId, status: { not: "OFFERED" }, endedAt: { gt: new Date(now.getTime() - 10 * 60 * 1000) } },
        orderBy: { endedAt: "desc" },
      });
    } catch {
      ended = null;
    }
    return {
      offer: ride
        ? {
            rideId: ride.id,
            status: "OFFERED",
            expiresAt: ride.offerExpiresAt!.toISOString(),
            serverNow: now.toISOString(),
            ride: {
              id: ride.id, status: "OFFERED", price: ride.price, vehicleType: ride.vehicleType,
              originLabel: ride.originLabel ?? null, destLabel: ride.destLabel ?? null,
              offerSeenAt: ride.offerSeenAt?.toISOString() ?? null,
            },
          }
        : null,
      lastEnded: ended
        ? { rideId: ended.rideId, outcome: ended.status.toLowerCase(), endedAt: ended.endedAt!.toISOString() }
        : null,
    };
  }

  /** Marge (ms) laissée au client après la fin du compte à rebours. */
  private offerGraceMs(): number {
    const seconds = this.pricing.rideSettings?.()?.offerApprovalGraceSeconds;
    return (typeof seconds === "number" ? seconds : 5) * 1000;
  }

  /** Proposition terminée : code stable que le mobile traduit (RIDE_OFFER_ENDED). */
  private offerEnded(message: string) {
    return new ConflictException({ code: "RIDE_OFFER_ENDED", message });
  }

  /**
   * Contenu de la popup du client : profil public du Zem + délai, avec l'heure du serveur pour que le compte à
   * rebours ne dépende pas de l'horloge du téléphone. Même contenu pour l'événement `ride:offered` et pour
   * `GET /rides/offers/pending`. Jamais de téléphone, d'identifiant ni de nom complet du Zem.
   */
  private async loadOfferPayload(rideId: string) {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      select: {
        clientId: true, driverId: true, status: true, price: true, originLabel: true, destLabel: true,
        originLat: true, originLng: true, offerExpiresAt: true, driverLat: true, driverLng: true,
      },
    });
    if (!ride || ride.status !== "OFFERED" || !ride.driverId || !ride.offerExpiresAt) return null;
    const driver = await this.prisma.user.findUnique({
      where: { id: ride.driverId },
      select: {
        fullName: true, firstName: true, lastName: true, createdAt: true,
        provider: {
          select: {
            fullName: true, city: true, zones: true, bio: true, experienceYears: true,
            vehicleType: true, vehicleModel: true, plateNumber: true, status: true,
            kycScore: true, rating: true, ratingCount: true, jobsCompleted: true, agencyName: true,
          },
        },
      },
    });
    if (!driver) return null;
    const { offer, ...profile } = this.buildPublicDriverProfile(driver, ride) as ReturnType<RidesService["buildPublicDriverProfile"]> & {
      offer?: { distanceKm: number | null; etaMinutes: number | null };
    };
    const now = new Date();
    return {
      clientId: ride.clientId,
      payload: {
        rideId,
        expiresAt: ride.offerExpiresAt.toISOString(),
        serverNow: now.toISOString(),
        expiresInSeconds: Math.max(0, Math.round((ride.offerExpiresAt.getTime() - now.getTime()) / 1000)),
        price: ride.price,
        originLabel: ride.originLabel ?? null,
        destLabel: ride.destLabel ?? null,
        driver: profile,
        offer: { distanceKm: offer?.distanceKm ?? null, etaMinutes: offer?.etaMinutes ?? null },
      },
    };
  }

  /** Prévient le client qu'un Zem a accepté : événement temps réel + notification poussée dédiée. */
  private async announceOffer(rideId: string) {
    const loaded = await this.loadOfferPayload(rideId);
    if (!loaded) return;
    const { clientId, payload } = loaded;
    this.gateway.emitOffered(clientId, payload);
    const user = await this.prisma.user.findUnique({ where: { id: clientId }, select: { language: true } }).catch(() => null);
    const text = offerPushText(user?.language, payload.expiresInSeconds);
    await this.notifications.push(clientId, text.title, text.body, "ride", {
      sendPush: true,
      // Canal Android dédié (son et vibration forts) et durée de vie = délai de la proposition :
      // une alerte périmée n'est jamais livrée.
      channelId: "ride-offers",
      ttlSeconds: payload.expiresInSeconds,
      // Pas de profil complet dans la notification (taille et écran verrouillé) : le mobile le relit
      data: { event: "ride-offered", rideId, expiresAt: payload.expiresAt, serverNow: payload.serverNow },
      titleKey: "NOTIFICATION_RIDE_OFFERED",
      bodyKey: "NOTIFICATION_RIDE_OFFERED_BODY",
      params: { s: payload.expiresInSeconds },
    });
  }

  /** Propositions de Zem en attente de la décision du client (rattrapage de la popup). */
  async pendingOffers(clientId: string) {
    const cutoff = new Date(Date.now() - this.offerGraceMs());
    const rides = await this.prisma.ride.findMany({
      where: { clientId, status: "OFFERED", offerExpiresAt: { gt: cutoff } },
      select: { id: true },
    });
    const loaded = await Promise.all(rides.map((r) => this.loadOfferPayload(r.id)));
    return { offers: loaded.flatMap((entry) => (entry ? [entry.payload] : [])) };
  }

  /** Le client a ouvert la popup : le Zem peut afficher « Le client regarde ton profil ». Idempotent. */
  async offerSeen(rideId: string, clientId: string) {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      select: { clientId: true, driverId: true, status: true, offerSeenAt: true },
    });
    if (!ride) throw new NotFoundException("Course introuvable");
    if (ride.clientId !== clientId) throw new ForbiddenException();
    if (ride.status !== "OFFERED") throw this.offerEnded("La proposition est terminée");
    if (ride.offerSeenAt) return { seenAt: ride.offerSeenAt.toISOString() };
    const seenAt = new Date();
    const { count } = await this.prisma.ride.updateMany({
      where: { id: rideId, clientId, status: "OFFERED", offerSeenAt: null },
      data: { offerSeenAt: seenAt },
    });
    if (count === 1 && ride.driverId) this.gateway.emitOfferSeen(ride.driverId, rideId, seenAt.toISOString());
    return { seenAt: seenAt.toISOString() };
  }

  async driverProfile(rideId: string, clientId: string) {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      select: { clientId: true, driverId: true, status: true, offeredAt: true, offerExpiresAt: true,
                driverLat: true, driverLng: true, originLat: true, originLng: true },
    });
    if (!ride) throw new NotFoundException("Course introuvable");
    if (ride.clientId !== clientId) throw new ForbiddenException();
    const allowedStatuses = ["OFFERED", "MATCHED", "ARRIVED", "IN_PROGRESS", "COMPLETED"];
    if (!allowedStatuses.includes(ride.status) || !ride.driverId) {
      throw new BadRequestException("Le profil du Zem n'est pas encore disponible");
    }
    const driver = await this.prisma.user.findUnique({
      where: { id: ride.driverId },
      select: {
        fullName: true, firstName: true, lastName: true, createdAt: true,
        provider: {
          select: {
            fullName: true, city: true, zones: true, bio: true, experienceYears: true,
            vehicleType: true, vehicleModel: true, plateNumber: true, status: true,
            kycScore: true, rating: true, ratingCount: true, jobsCompleted: true, agencyName: true,
          },
        },
      },
    });
    if (!driver) throw new NotFoundException("Zem introuvable");
    return this.buildPublicDriverProfile(driver, ride);
  }

  private buildPublicDriverProfile(
    driver: {
      fullName: string | null; firstName: string | null; lastName: string | null; createdAt: Date;
      provider: {
        fullName: string | null; city: string | null; zones: string[]; bio: string | null;
        experienceYears: number | null; vehicleType: string | null; vehicleModel: string | null;
        plateNumber: string | null; status: string; kycScore: number; rating: number;
        ratingCount: number; jobsCompleted: number; agencyName: string | null;
      } | null;
    },
    ride: { status: string; offerExpiresAt: Date | null; driverLat: number | null; driverLng: number | null; originLat: number; originLng: number }
  ) {
    const p = driver.provider;
    const { displayName } = buildDriverDisplayName({
      providerFullName: p?.fullName, userFullName: driver.fullName,
      firstName: driver.firstName, lastName: driver.lastName,
    });
    const verified = p?.status === "APPROVED" && (p.kycScore ?? 0) >= 80;
    const rating = p && p.ratingCount >= 1 ? Math.round(p.rating * 10) / 10 : null;
    const bio = p?.bio ? p.bio.replace(/<[^>]*>/g, "").slice(0, 200) : null;
    let distanceKm: number | null = null;
    if (ride.driverLat !== null && ride.driverLng !== null) {
      distanceKm = Math.round(haversineKm(
        { latitude: ride.driverLat, longitude: ride.driverLng },
        { latitude: ride.originLat, longitude: ride.originLng }
      ) * 10) / 10;
    }
    const offer = ride.status === "OFFERED"
      ? { expiresAt: ride.offerExpiresAt?.toISOString() ?? null, distanceKm,
          etaMinutes: distanceKm !== null ? Math.max(1, Math.round((distanceKm / 20) * 60)) : null }
      : undefined;
    return {
      displayName, photoUrl: null, verified,
      rating, ratingCount: p?.ratingCount ?? 0,
      jobsCompleted: p?.jobsCompleted ?? 0, experienceYears: p?.experienceYears ?? null,
      memberSince: driver.createdAt.toISOString(),
      city: p?.city ?? null, zones: p?.zones ?? [], bio,
      vehicleType: p?.vehicleType ?? null, vehicleModel: p?.vehicleModel ?? null,
      plateMasked: maskPlate(p?.plateNumber), agencyName: p?.agencyName ?? null,
      ...(offer ? { offer } : {}),
    };
  }

  /** Le chauffeur signale son arrivée avant que le client ne révèle son code. */
  async arrive(rideId: string, driverId: string) {
    const ride = await this.getOwnedByDriver(rideId, driverId);

    // Idempotent : un double appui, un renvoi après coupure réseau ou un écran pas
    // encore rafraîchi ne doivent pas afficher d'erreur au chauffeur déjà sur place.
    if (ride.status === "ARRIVED") {
      this.gateway.emitStatus(rideId, "ARRIVED");
      return this.withoutPickupCode(ride);
    }
    if (ride.status !== "MATCHED") {
      throw new BadRequestException("Seul un chauffeur en route vers le client peut signaler son arrivée.");
    }

    let count = 0;
    try {
      ({ count } = await this.prisma.ride.updateMany({
        where: { id: rideId, driverId, status: "MATCHED" },
        data: { status: "ARRIVED", driverArrivedAt: new Date() },
      }));
    } catch (error) {
      throw this.databaseOutOfDate(error, "signaler l'arrivée");
    }
    if (count === 0) throw new BadRequestException("Le statut de la course a changé. Actualise l'écran.");

    const arrivedRide = await this.prisma.ride.findUniqueOrThrow({ where: { id: rideId }, include: WITH_CLIENT });
    this.gateway.invalidateRideLocationContext(rideId);
    const arrivalTitle = this.pricing.isZem(arrivedRide.vehicleType)
      ? "Ton Zem est arrivé"
      : "Ton chauffeur est arrivé";

    // L'arrivée est déjà enregistrée : une panne de notification (inbox, Expo Push)
    // ne doit plus faire échouer la requête et bloquer le chauffeur sur « MATCHED ».
    await this.notifications
      .push(
        arrivedRide.clientId,
        arrivalTitle,
        "Ton chauffeur est au point de prise en charge. Donne-lui le code Bouclier affiché dans l'application pour démarrer.",
        "ride",
        {
          sendPush: true,
          data: { event: "ride-arrived", rideId },
          titleKey: this.pricing.isZem(arrivedRide.vehicleType)
            ? "NOTIFICATION_ZEM_ARRIVED"
            : "NOTIFICATION_DRIVER_ARRIVED",
          bodyKey: "NOTIFICATION_DRIVER_ARRIVED_BODY",
        }
      )
      .catch(() => null);
    try {
      this.gateway.emitStatus(rideId, "ARRIVED");
    } catch {
      // Socket.IO indisponible : le client récupère le statut au prochain rafraîchissement.
    }
    return this.withoutPickupCode(arrivedRide);
  }

  /**
   * Une base déployée sans la migration « ARRIVED » renvoie une erreur Prisma brute
   * (valeur d'enum ou colonne inconnue) affichée telle quelle dans l'application.
   * On la traduit en consigne exploitable au lieu d'un « Internal server error ».
   */
  private databaseOutOfDate(error: unknown, action: string) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ARRIVED|driverArrivedAt|pickupCode|column .* does not exist|invalid input value for enum/i.test(message)) {
      return new BadRequestException(
        `Le serveur AZƆ̀ n'est pas à jour : impossible de ${action}. ` +
          "Déploie la dernière version du backend puis exécute « npx prisma migrate deploy »."
      );
    }
    return error instanceof Error ? error : new Error(message);
  }

  async start(rideId: string, driverId: string, pin?: string) {
    const ride = await this.getOwnedByDriver(rideId, driverId);
    if (ride.status !== "ARRIVED") {
      throw new BadRequestException("Le démarrage est interdit avant l'arrivée au point de prise en charge.");
    }

    const cleanPin = typeof pin === "string" ? pin.trim() : "";
    if (!/^\d{4}$/.test(cleanPin) || !ride.pickupCode || cleanPin !== ride.pickupCode) {
      throw new BadRequestException("Code Bouclier AZƆ̀ incorrect. Demande au client le code affiché dans son application.");
    }

    // On vérifie le solde AVANT le départ : sinon la course se terminait avec un
    // client insolvable et le chauffeur n'était jamais payé.
    const clientWallet = await this.prisma.wallet.findUnique({ where: { userId: ride.clientId } });
    if (!clientWallet || clientWallet.balance < ride.price) {
      throw new BadRequestException("Le client n'a pas assez de solde AZƆ̀ Pay pour cette course");
    }

    const { count } = await this.prisma.ride.updateMany({
      where: { id: rideId, driverId, status: "ARRIVED", pickupCode: cleanPin },
      data: {
        status: "IN_PROGRESS",
        pickupCode: null,
        clientLat: null,
        clientLng: null,
        clientLocatedAt: null,
      },
    });
    if (count === 0) throw new BadRequestException("Le statut de la course a changé. Actualise l'écran.");

    this.gateway.clearClientLocationState(rideId);
    this.gateway.invalidateRideLocationContext(rideId);
    await this.notifications.push(ride.clientId, "Course démarrée", "Ton chauffeur est en route vers la destination.", "ride", {
      titleKey: "NOTIFICATION_RIDE_STARTED",
      bodyKey: "NOTIFICATION_RIDE_STARTED_BODY",
    });
    this.gateway.emitStatus(rideId, "IN_PROGRESS");
    const updated = await this.prisma.ride.findUniqueOrThrow({ where: { id: rideId }, include: WITH_CLIENT });
    return this.withoutPickupCode(updated);
  }

  getMessages(rideId: string) {
    return this.gateway.getMessages(rideId);
  }

  sendMessage(
    rideId: string,
    user: { userId: string; role?: string },
    dto: { text: string; senderRole?: "CLIENT" | "PROVIDER"; senderName?: string }
  ) {
    const role: "CLIENT" | "PROVIDER" =
      dto.senderRole ?? (user.role === "DRIVER" ? "PROVIDER" : "CLIENT");
    const name = (dto.senderName || (role === "PROVIDER" ? "Prestataire AZƆ̀" : "Client AZƆ̀")).slice(0, 40);
    return this.gateway.addChatMessage(rideId, user.userId, role, name, dto.text);
  }

  // Fin de course : paiement + commission + revenus du chauffeur, en une transaction.
  // Commission : taux du niveau d'agence si le conducteur est rattaché à une flotte,
  // sinon règles du profil prestataire (config tarifaire).
  /**
   * Le Zem demande le code d'arrivée : le serveur le génère (une seule fois, la demande est
   * idempotente) et le client le lit dans son application. Le client le communique au Zem,
   * qui le saisit dans `complete` pour confirmer l'arrivée à destination.
   */
  async requestDropCode(rideId: string, driverId: string) {
    const ride = await this.getOwnedByDriver(rideId, driverId);
    if (ride.status !== "IN_PROGRESS") {
      throw new BadRequestException("Le code d'arrivée ne peut être demandé que pendant la course.");
    }
    if (ride.dropCode) return { ...this.withoutPickupCode(ride), dropCodeRequested: true };

    // Conditionné à `dropCode: null` : deux appuis simultanés ne génèrent qu'un seul code.
    const { count } = await this.prisma.ride.updateMany({
      where: { id: rideId, driverId, status: "IN_PROGRESS", dropCode: null },
      data: { dropCode: createPickupCode() },
    });
    if (count === 1) {
      await this.notifications
        .push(
          ride.clientId,
          "Confirme ton arrivée",
          "Ton Zem demande le code d'arrivée. Donne-lui le code affiché dans l'application pour confirmer que tu es arrivé.",
          "ride",
          {
            sendPush: true,
            data: { event: "ride-drop-code", rideId },
            titleKey: "NOTIFICATION_RIDE_DROP_CODE",
            bodyKey: "NOTIFICATION_RIDE_DROP_CODE_BODY",
          }
        )
        .catch(() => null);
    }
    const updated = await this.prisma.ride.findUniqueOrThrow({ where: { id: rideId }, include: WITH_CLIENT });
    return { ...this.withoutPickupCode(updated), dropCodeRequested: true };
  }

  async requestStop(rideId: string, userId: string) {
    let ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundException("Course introuvable");
    const requester = this.participantRole(ride, userId);
    if (!requester) throw new ForbiddenException();
    if (ride.status !== "IN_PROGRESS") {
      throw new BadRequestException("L'arrêt anticipé est disponible uniquement pendant une course en cours.");
    }
    if (await this.expireStopRequestIfNeeded(ride)) {
      ride = await this.prisma.ride.findUniqueOrThrow({ where: { id: rideId } });
    }
    if (ride.stopRequestedAt) throw new BadRequestException("Une demande d'arrêt est déjà en attente.");

    const progress = await this.gateway.freezeRideProgress(rideId);
    const distanceMeters = progress?.traveledMeters ?? ride.traveledMeters;
    const price = progress?.currentPrice ?? this.currentRidePrice(ride);
    const requestedAt = new Date();
    const count = await this.prisma.$transaction(async (tx) => {
      const result = await tx.ride.updateMany({
        where: { id: rideId, status: "IN_PROGRESS", stopRequestedAt: null, stopRequestedBy: null },
        data: {
          stopRequestedBy: requester,
          stopRequestedAt: requestedAt,
          stopRequestedPrice: price,
          stopRequestedDistanceMeters: distanceMeters,
          ...(progress?.dirtyOdometer && progress.odometer
            ? {
                traveledMeters: { increment: progress.pendingMeters },
                odoLat: progress.odometer.lat,
                odoLng: progress.odometer.lng,
                odoAt: new Date(progress.odometer.at),
              }
            : {}),
        },
      });
      if (result.count && progress?.dirtyOdometer && progress.odometer) {
        await tx.rideTrackPoint.create({
          data: {
            rideId,
            lat: progress.odometer.lat,
            lng: progress.odometer.lng,
            accuracy: progress.odometerAccuracy,
            speed: progress.odometerSpeed,
            at: new Date(progress.odometer.at),
          },
        });
      }
      return result.count;
    });
    if (!count) {
      this.gateway.invalidateRideLocationContext(rideId);
      throw new BadRequestException("Une demande d'arrêt est déjà en attente.");
    }

    this.gateway.invalidateRideLocationContext(rideId);
    const otherId = requester === "CLIENT" ? ride.driverId : ride.clientId;
    if (otherId) {
      await this.notifications
        .push(otherId, "Demande d'arrêt de course", "L'autre participant demande d'arrêter la course ici.", "ride", {
          titleKey: "NOTIFICATION_RIDE_STOP_REQUEST",
          bodyKey: "NOTIFICATION_RIDE_STOP_REQUEST_BODY",
        })
        .catch(() => null);
    }
    const request = this.stopRequestPayload(requester, requestedAt, price, distanceMeters);
    this.gateway.emitStopRequest(rideId, request);
    return { rideId, stopRequest: request };
  }

  async acceptStop(rideId: string, userId: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundException("Course introuvable");
    const accepter = this.participantRole(ride, userId);
    if (!accepter) throw new ForbiddenException();
    if (ride.status !== "IN_PROGRESS") throw new BadRequestException("La course n'est pas en cours.");
    if (await this.expireStopRequestIfNeeded(ride)) {
      throw new BadRequestException("La demande d'arrêt a expiré. La course continue.");
    }
    if (!ride.stopRequestedBy || !ride.stopRequestedAt || ride.stopRequestedPrice === null) {
      throw new BadRequestException("Aucune demande d'arrêt n'est en attente.");
    }
    if (ride.stopRequestedBy === accepter) {
      throw new ForbiddenException("Seul l'autre participant peut accepter cette demande.");
    }
    if (!ride.driverId) throw new BadRequestException("Aucun chauffeur n'est assigné à cette course.");

    // Arrêt accepté : le paiement n'est PAS encore fait. Un code d'arrivée est généré pour le client ; le client le
    // communique au Zem, qui le saisit (POST /rides/:id/complete) : c'est cette saisie qui débite le client.
    if (ride.stopAcceptedAt) {
      return { rideId, stopRequest: this.stopRequestPayload(ride.stopRequestedBy as "CLIENT" | "DRIVER", ride.stopRequestedAt, ride.stopRequestedPrice, ride.stopRequestedDistanceMeters ?? ride.traveledMeters, ride.stopAcceptedAt) };
    }
    const acceptedAt = new Date();
    const { count } = await this.prisma.ride.updateMany({
      where: { id: rideId, status: "IN_PROGRESS", stopRequestedAt: ride.stopRequestedAt, stopAcceptedAt: null },
      data: { stopAcceptedAt: acceptedAt, dropCode: ride.dropCode ?? createPickupCode() },
    });
    if (!count) throw new BadRequestException("La demande d'arrêt a déjà été traitée.");
    this.gateway.invalidateRideLocationContext(rideId);
    const request = this.stopRequestPayload(
      ride.stopRequestedBy as "CLIENT" | "DRIVER",
      ride.stopRequestedAt,
      ride.stopRequestedPrice,
      ride.stopRequestedDistanceMeters ?? ride.traveledMeters,
      acceptedAt
    );
    await this.notifications
      .push(ride.clientId, "Confirme ton arrivée", "Arrêt accepté. Donne à ton Zem le code affiché dans l'application pour confirmer le paiement.", "ride", {
        sendPush: true,
        data: { event: "ride-drop-code", rideId },
        titleKey: "NOTIFICATION_RIDE_DROP_CODE",
        bodyKey: "NOTIFICATION_RIDE_DROP_CODE_BODY",
      })
      .catch(() => null);
    await this.notifications
      .push(ride.driverId, "Arrêt accepté", "Demande le code d'arrivée au client et saisis-le pour terminer la course.", "ride", {
        sendPush: true,
        data: { event: "ride-stop-accepted", rideId },
        titleKey: "NOTIFICATION_RIDE_STOP_UPDATED",
        bodyKey: "NOTIFICATION_RIDE_STOP_ACCEPTED_BODY",
      })
      .catch(() => null);
    this.gateway.emitStopRequest(rideId, request, { accepted: true });
    return { rideId, stopRequest: request };
  }

  async declineStop(rideId: string, userId: string) {
    return this.removeStopRequest(rideId, userId, "declined");
  }

  async cancelStop(rideId: string, userId: string) {
    return this.removeStopRequest(rideId, userId, "cancelled");
  }

  private async removeStopRequest(rideId: string, userId: string, action: "declined" | "cancelled") {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundException("Course introuvable");
    const actor = this.participantRole(ride, userId);
    if (!actor) throw new ForbiddenException();
    if (ride.status !== "IN_PROGRESS") throw new BadRequestException("La course n'est pas en cours.");
    if (await this.expireStopRequestIfNeeded(ride)) {
      throw new BadRequestException("La demande d'arrêt a expiré. La course continue.");
    }
    if (!ride.stopRequestedBy || !ride.stopRequestedAt) {
      throw new BadRequestException("Aucune demande d'arrêt n'est en attente.");
    }
    if (ride.stopAcceptedAt) {
      throw new BadRequestException("L'arrêt est déjà accepté : saisis le code d'arrivée, ou la demande expirera.");
    }
    if ((action === "cancelled" && ride.stopRequestedBy !== actor) ||
        (action === "declined" && ride.stopRequestedBy === actor)) {
      throw new ForbiddenException(
        action === "cancelled" ? "Seul l'auteur peut annuler sa demande." : "Seul l'autre participant peut refuser."
      );
    }

    const { count } = await this.prisma.ride.updateMany({
      where: {
        id: rideId,
        status: "IN_PROGRESS",
        stopRequestedBy: ride.stopRequestedBy,
        stopRequestedAt: ride.stopRequestedAt,
      },
      data: {
        stopRequestedBy: null,
        stopRequestedAt: null,
        stopRequestedPrice: null,
        stopRequestedDistanceMeters: null,
      },
    });
    if (!count) throw new BadRequestException("La demande d'arrêt a déjà été traitée.");
    this.gateway.invalidateRideLocationContext(rideId);

    const notifyId =
      action === "declined"
        ? ride.stopRequestedBy === "CLIENT"
          ? ride.clientId
          : ride.driverId
        : actor === "CLIENT"
          ? ride.driverId
          : ride.clientId;
    if (notifyId) {
      const message =
        action === "declined"
          ? "L'autre participant a refusé l'arrêt. La course continue."
          : "La demande d'arrêt a été annulée.";
      await this.notifications.push(notifyId, "Demande d'arrêt mise à jour", message, "ride", {
        titleKey: "NOTIFICATION_RIDE_STOP_UPDATED",
        bodyKey: action === "declined" ? "NOTIFICATION_RIDE_STOP_DECLINED_BODY" : "NOTIFICATION_RIDE_STOP_CANCELLED_BODY",
      }).catch(() => null);
    }
    this.gateway.emitStopRequest(rideId, null, { [action]: true });
    return { rideId, stopRequest: null };
  }

  private participantRole(ride: { clientId: string; driverId: string | null }, userId: string) {
    if (ride.clientId === userId) return "CLIENT" as const;
    if (ride.driverId === userId) return "DRIVER" as const;
    return null;
  }

  private currentRidePrice(ride: { traveledMeters: number; vehicleType: string; price: number }) {
    return Math.min(this.pricing.breakdown(ride.traveledMeters / 1000, ride.vehicleType).price, ride.price);
  }

  private stopRequestPayload(by: "CLIENT" | "DRIVER", at: Date, price: number, distanceMeters: number, acceptedAt?: Date | null) {
    const ttl = this.pricing.rideSettings().stopRequestExpiryMinutes * 60_000;
    return {
      by,
      at: at.toISOString(),
      // Une fois l'arrêt accepté, le délai repart de l'acceptation : le temps de lire et dicter le code
      expiresAt: new Date((acceptedAt ?? at).getTime() + ttl).toISOString(),
      price,
      distanceMeters,
      // Arrêt accepté : le client lit le code d'arrivée, le Zem le saisit (POST /rides/:id/complete) et le paiement part
      ...(acceptedAt ? { accepted: true, codeRequired: true } : {}),
    };
  }

  private async expireStopRequestIfNeeded(ride: {
    id: string;
    stopRequestedAt: Date | null;
    stopAcceptedAt?: Date | null;
  }) {
    const ttl = this.pricing.rideSettings().stopRequestExpiryMinutes * 60_000;
    const since = ride.stopAcceptedAt ?? ride.stopRequestedAt;
    if (!ride.stopRequestedAt || !since || Date.now() - since.getTime() < ttl) return false;
    const { count } = await this.prisma.ride.updateMany({
      where: { id: ride.id, status: "IN_PROGRESS", stopRequestedAt: ride.stopRequestedAt },
      data: {
        stopRequestedBy: null,
        stopRequestedAt: null,
        stopRequestedPrice: null,
        stopRequestedDistanceMeters: null,
        // le code généré pour cet arrêt n'a plus d'objet : la course continue
        ...(ride.stopAcceptedAt ? { stopAcceptedAt: null, dropCode: null } : {}),
      },
    });
    if (count) {
      this.gateway.invalidateRideLocationContext(ride.id);
      this.gateway.emitStopRequest(ride.id, null, { expired: true });
    }
    return count > 0;
  }

  /** Fin de course par le Zem : le code d'arrivée donné par le client est obligatoire. */
  async complete(rideId: string, driverId: string, code?: string) {
    const ride = await this.getOwnedByDriver(rideId, driverId);
    if (ride.status !== "IN_PROGRESS") throw new BadRequestException("La course n'est pas en cours");
    if (!ride.dropCode) {
      throw new BadRequestException("Demande d'abord le code d'arrivée au client avant de terminer la course.");
    }
    const clean = typeof code === "string" ? code.trim() : "";
    if (!/^\d{4}$/.test(clean) || clean !== ride.dropCode) {
      throw new BadRequestException("Code d'arrivée incorrect. Demande au client le code affiché dans son application.");
    }
    // Arrêt anticipé accepté par le client : on règle la distance réellement parcourue, sans exiger d'être à destination.
    if (ride.stopAcceptedAt && ride.stopRequestedBy && ride.stopRequestedAt && ride.stopRequestedPrice !== null) {
      if (await this.expireStopRequestIfNeeded(ride)) {
        throw new BadRequestException("La demande d'arrêt a expiré. La course continue.");
      }
      const amount = Math.min(ride.stopRequestedPrice, ride.price);
      const result = await this.settle(ride, driverId, {
        amount,
        settledDistanceMeters: ride.stopRequestedDistanceMeters ?? ride.traveledMeters,
        priceMode: "PARTIAL",
        stopRequestAt: ride.stopRequestedAt,
        stopRequestedBy: ride.stopRequestedBy,
      });
      this.gateway.emitStopRequest(rideId, null, { accepted: true });
      return result;
    }
    this.assertAtDestination(ride);
    return this.settle(ride, driverId, {
      amount: ride.price,
      settledDistanceMeters: ride.traveledMeters,
      priceMode: "FULL",
    });
  }

  /** Fin de course validée par le client lui-même (confirmation du dépôt) : pas de code. */
  async completeConfirmedByClient(rideId: string, driverId: string) {
    const ride = await this.getOwnedByDriver(rideId, driverId);
    if (ride.status !== "IN_PROGRESS") throw new BadRequestException("La course n'est pas en cours");
    this.assertAtDestination(ride);
    return this.settle(ride, driverId, {
      amount: ride.price,
      settledDistanceMeters: ride.traveledMeters,
      priceMode: "FULL",
    });
  }

  private assertAtDestination(ride: {
    odoLat: number | null;
    odoLng: number | null;
    odoAt: Date | null;
    driverLat: number | null;
    driverLng: number | null;
    driverLocatedAt: Date | null;
    destLat: number;
    destLng: number;
  }) {
    const odometerAge = ride.odoAt ? Date.now() - ride.odoAt.getTime() : Number.POSITIVE_INFINITY;
    const odometerIsAvailable =
      ride.odoLat !== null &&
      ride.odoLng !== null &&
      odometerAge <= 30_000 &&
      odometerAge >= -60_000;
    const latestLocationIsFresh =
      ride.driverLat !== null &&
      ride.driverLng !== null &&
      ride.driverLocatedAt instanceof Date &&
      Date.now() - ride.driverLocatedAt.getTime() <= 30_000 &&
      Date.now() - ride.driverLocatedAt.getTime() >= -60_000;
    const latitude = odometerIsAvailable ? ride.odoLat : latestLocationIsFresh ? ride.driverLat : null;
    const longitude = odometerIsAvailable ? ride.odoLng : latestLocationIsFresh ? ride.driverLng : null;
    if (latitude === null || longitude === null) {
      throw new BadRequestException("La position du chauffeur n'est pas suffisamment précise pour confirmer l'arrivée.");
    }
    const tolerance = this.pricing.rideSettings().destinationToleranceMeters;
    if (haversineMeters({ lat: latitude, lng: longitude }, { lat: ride.destLat, lng: ride.destLng }) > tolerance) {
      throw new BadRequestException(
        "Le chauffeur est encore loin de la destination. Demande un arrêt anticipé et attends l'accord de l'autre participant."
      );
    }
  }

  private async settle(
    ride: {
      id: string;
      clientId: string;
      price: number;
      traveledMeters: number;
      stopRequestedBy?: string | null;
      stopRequestedAt?: Date | null;
      stopRequestedPrice?: number | null;
    },
    driverId: string,
    options: {
      amount: number;
      settledDistanceMeters: number;
      priceMode: "FULL" | "PARTIAL";
      stopRequestAt?: Date;
      stopRequestedBy?: string;
    }
  ) {
    const rideId = ride.id;
    const amount = Math.min(Math.max(0, Math.trunc(options.amount)), ride.price);

    const driver = await this.prisma.user.findUnique({
      where: { id: driverId },
      include: { agency: true, provider: true },
    });

    // Une agence ne peut opérer qu'une fois ses frais d'activation payés.
    if (driver?.agency && !this.pricing.agencyCanOperate(driver.agency)) {
      throw new BadRequestException(
        `Agence non activée : les frais d'activation de la formule ${driver.agency.plan} ` +
          `(${this.pricing.agencyActivationFee(driver.agency.plan).toLocaleString("fr-FR")} FCFA, paiement unique) ` +
          "doivent être réglés avant toute course."
      );
    }

    const commission = this.pricing.rideCommission(
      {
        profile: this.profileKeyOf(driver),
        agencyLevel: driver?.agency?.plan ?? null,
      },
      amount
    );
    const driverGain = amount - commission;
    const ref = `Course #${ride.id.slice(0, 6)}`;

    const updated = await this.prisma.$transaction(async (tx) => {
      const clientWallet = await tx.wallet.upsert({
        where: { userId: ride.clientId },
        create: { userId: ride.clientId },
        update: {},
      });
      const driverWallet = await tx.wallet.upsert({
        where: { userId: driverId },
        create: { userId: driverId },
        update: {},
      });
      const debit = await tx.wallet.updateMany({
        where: { id: clientWallet.id, balance: { gte: amount } },
        data: { balance: { decrement: amount } },
      });
      if (debit.count !== 1) throw new BadRequestException("Solde insuffisant");

      await tx.wallet.update({
        where: { id: driverWallet.id },
        data: { balance: { increment: driverGain } },
      });
      await tx.transaction.createMany({
        data: [
          { walletId: clientWallet.id, type: "DEBIT", amount, label: "Course AZƆ̀", labelKey: "TRANSACTION_RIDE_PAYMENT", labelParams: { ref }, meta: ref },
          { walletId: driverWallet.id, type: "CREDIT", amount: driverGain, label: "Gain de course", labelKey: "TRANSACTION_RIDE_EARNING", labelParams: { ref, commission }, meta: ref },
        ],
      });

      const where: Prisma.RideWhereInput = { id: rideId, driverId, status: "IN_PROGRESS" };
      if (options.stopRequestAt) {
        where.stopRequestedBy = options.stopRequestedBy;
        where.stopRequestedAt = options.stopRequestAt;
        where.stopRequestedPrice = options.amount;
      }
      const completed = await tx.ride.updateMany({
        where,
        data: {
          status: "COMPLETED",
          commission,
          finalPrice: amount,
          settledDistanceMeters: options.settledDistanceMeters,
          priceMode: options.priceMode,
          stopRequestedBy: null,
          stopRequestedAt: null,
          stopRequestedPrice: null,
          stopRequestedDistanceMeters: null,
          stopAcceptedAt: null,
          driverLat: null,
          driverLng: null,
          driverHeading: null,
          driverSpeed: null,
          driverLocatedAt: null,
          clientLat: null,
          clientLng: null,
          clientLocatedAt: null,
        },
      });
      if (completed.count !== 1) {
        throw new BadRequestException("Le statut de la course ou la demande d'arrêt a changé. Actualise l'écran.");
      }
      return tx.ride.findUniqueOrThrow({ where: { id: rideId } });
    });
    this.gateway.clearRideLocations(rideId);
    await this.notifications
      .push(ride.clientId, "Course terminée", `${amount} FCFA débités de ton portefeuille.`, "payment", {
        titleKey: "NOTIFICATION_RIDE_COMPLETED_CLIENT",
        bodyKey: "NOTIFICATION_RIDE_COMPLETED_CLIENT_BODY",
        params: { amount },
      })
      .catch(() => null);
    await this.notifications
      .push(driverId, "Paiement reçu", `+${driverGain} FCFA (commission AZƆ̀ : ${commission} F).`, "payment", {
        titleKey: "NOTIFICATION_RIDE_COMPLETED_DRIVER",
        bodyKey: "NOTIFICATION_RIDE_COMPLETED_DRIVER_BODY",
        params: { driverGain, commission },
      })
      .catch(() => null);
    this.gateway.emitStatus(rideId, "COMPLETED");
    this.gateway.emitRideSettled(rideId, {
      finalPrice: amount,
      settledDistanceMeters: options.settledDistanceMeters,
      priceMode: options.priceMode,
    });
    return this.withoutPickupCode(updated);
  }

  // Annulation par le client ou le chauffeur avant le démarrage de la course
  async cancel(rideId: string, userId: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundException("Course introuvable");

    const isClient = ride.clientId === userId;
    const isDriver = ride.driverId === userId;
    if (!isClient && !isDriver) throw new ForbiddenException();

    // Le Zem en OFFERED doit utiliser withdraw-offer, pas cancel
    if (isDriver && ride.status === "OFFERED") {
      return this.withdrawOffer(rideId, userId);
    }

    if (!["PENDING", "OFFERED", "MATCHED", "ARRIVED"].includes(ride.status)) {
      throw new BadRequestException("Cette course ne peut plus être annulée");
    }

    // Client : la course est annulée pour de bon.
    // Chauffeur : elle repart en recherche avec un nouveau code (l'ancien a pu être révélé).
    const updated = isClient
      ? await this.prisma.ride.update({
          where: { id: rideId },
          data: {
            status: "CANCELLED",
            driverLat: null,
            driverLng: null,
            driverHeading: null,
            driverSpeed: null,
            driverLocatedAt: null,
            clientLat: null,
            clientLng: null,
            clientLocatedAt: null,
          },
        })
      : await this.prisma.ride.update({
          where: { id: rideId },
          data: {
            status: "PENDING",
            driverId: null,
            driverArrivedAt: null,
            pickupCode: createPickupCode(),
            driverLat: null,
            driverLng: null,
            driverHeading: null,
            driverSpeed: null,
            driverLocatedAt: null,
            clientLat: null,
            clientLng: null,
            clientLocatedAt: null,
          },
        });
    this.gateway.clearRideLocations(rideId);
    if (isClient && ride.status === "OFFERED") {
      this.gateway.emitOfferEnded(ride.clientId, rideId, "cancelled");
      await this.closeOffer(rideId, ride.driverId, "CANCELLED");
    }

    if (isClient) {
      if (ride.driverId) {
        this.gateway.emitRideCancelled(ride.driverId, rideId);
        await this.notifications.push(ride.driverId, "Course annulée", "Le client a annulé la course.", "ride", {
          titleKey: "NOTIFICATION_RIDE_CANCELLED",
          bodyKey: "NOTIFICATION_RIDE_CANCELLED_BY_CLIENT_BODY",
        });
      }
    } else {
      await this.notifications.push(ride.clientId, "Course annulée", "Ton chauffeur a annulé. Recherche d'un nouveau chauffeur…", "ride", {
        titleKey: "NOTIFICATION_RIDE_CANCELLED",
        bodyKey: "NOTIFICATION_RIDE_CANCELLED_BY_DRIVER_BODY",
      });
    }

    this.gateway.emitStatus(rideId, updated.status);
    return this.withoutPickupCode(updated);
  }

  async rate(rideId: string, clientId: string, stars: number) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride || ride.clientId !== clientId) throw new ForbiddenException();
    if (ride.status !== "COMPLETED") throw new BadRequestException("La course doit être terminée pour être notée");
    if (ride.rating !== null) throw new BadRequestException("Tu as déjà noté cette course");

    const updated = await this.prisma.ride.update({ where: { id: rideId }, data: { rating: stars } });

    // Mise à jour incrémentale de la note sur le dossier prestataire
    if (ride.driverId) {
      const provider = await this.prisma.providerProfile.findUnique({
        where: { userId: ride.driverId },
        select: { rating: true, ratingCount: true },
      });
      if (provider) {
        const n = provider.ratingCount;
        const newRating = n === 0 ? stars : (provider.rating * n + stars) / (n + 1);
        await this.prisma.providerProfile.update({
          where: { userId: ride.driverId },
          data: { rating: Math.round(newRating * 10) / 10, ratingCount: { increment: 1 } },
        });
      }
    }
    return this.withoutPickupCode(updated);
  }

  // Détail d'une course (avec les infos du chauffeur ET du client) — lu par l'écran
  // de suivi côté client et par la fiche course côté chauffeur.
  async findOne(id: string, userId: string) {
    // Rattrapage de l'expiration d'offre avant de lire (B.4)
    await this.expireOfferedIfNeeded(id);
    this.sweepScheduledRides();

    let ride = await this.prisma.ride.findUnique({
      where: { id },
      include: {
        driver: {
          select: {
            fullName: true, phone: true, firstName: true, lastName: true, createdAt: true,
            provider: {
              select: {
                fullName: true, city: true, zones: true, bio: true, experienceYears: true,
                vehicleType: true, vehicleModel: true, plateNumber: true, status: true,
                kycScore: true, rating: true, ratingCount: true, jobsCompleted: true, agencyName: true,
              },
            },
          },
        },
        client: { select: { fullName: true, phone: true, firstName: true, lastName: true } },
      },
    });
    if (!ride) throw new NotFoundException("Course introuvable");
    if (ride.clientId !== userId && ride.driverId !== userId) {
      // Zem dont la proposition vient de finir : vue restreinte (issue de la proposition) au lieu d'un 403
      const ended = await this.endedOfferView(id, userId);
      if (ended) return ended;
      throw new ForbiddenException();
    }

    // Demande restée sans chauffeur : on l'annule au moment où le client recharge son
    // suivi (aucun débit), et on le lui signale dans la réponse (`expired: true`).
    if (ride.status === "PENDING" && !isWaitingForRelease(ride) && isRideExpired(withReleaseAsCreation(ride).createdAt, this.pricing.radarSettings().pendingExpiryMinutes)) {
      const cancelled = await this.expireRide(ride);
      if (cancelled) return this.visibleRideToUser({ ...ride, status: "CANCELLED", expired: true }, userId);
    }

    // Le client voit combien de temps il reste avant l'expiration de sa demande.
    if (ride.status === "PENDING") {
      const expiryMinutes = this.pricing.radarSettings().pendingExpiryMinutes;
      // Course programmée pas encore ouverte : pas de compte à rebours d'attente
      const ageMinutes = isWaitingForRelease(ride) ? 0 : rideAgeMinutes(withReleaseAsCreation(ride).createdAt);
      return this.visibleRideToUser(
        { ...ride, expiresInMinutes: Math.max(0, Math.ceil(expiryMinutes - ageMinutes)) },
        userId
      );
    }
    if (ride.status === "IN_PROGRESS" && (await this.expireStopRequestIfNeeded(ride))) {
      ride = await this.prisma.ride.findUniqueOrThrow({
        where: { id },
        include: {
          driver: {
            select: {
              fullName: true, phone: true, firstName: true, lastName: true, createdAt: true,
              provider: {
                select: {
                  fullName: true, city: true, zones: true, bio: true, experienceYears: true,
                  vehicleType: true, vehicleModel: true, plateNumber: true, status: true,
                  kycScore: true, rating: true, ratingCount: true, jobsCompleted: true, agencyName: true,
                },
              },
            },
          },
          client: { select: { fullName: true, phone: true, firstName: true, lastName: true } },
        },
      });
    }

    // Pour le client en statut OFFERED : ajouter le profil du Zem (B.5)
    const rideVisible = this.visibleRideToUser(ride, userId) as any;
    if (userId === ride.clientId && ["OFFERED", "MATCHED", "ARRIVED", "IN_PROGRESS", "COMPLETED"].includes(ride.status) && ride.driverId && (ride as any).driver) {
      const d = (ride as any).driver;
      const { displayName: driverDisplayName, firstName: driverFirstName } = buildDriverDisplayName({
        providerFullName: d.provider?.fullName,
        userFullName: d.fullName,
        firstName: d.firstName,
        lastName: d.lastName,
      });
      const driverProfile = ride.status === "OFFERED"
        ? this.buildPublicDriverProfile(d, ride as any)
        : undefined;
      rideVisible.driver = {
        fullName: d.fullName,
        // Téléphone masqué avant MATCHED
        phone: ["MATCHED", "ARRIVED", "IN_PROGRESS", "COMPLETED"].includes(ride.status) ? d.phone : null,
        displayName: driverDisplayName,
        firstName: driverFirstName,
        ...(driverProfile ? { profile: driverProfile } : {}),
        // En OFFERED : inclure aussi l'offre
        ...(ride.status === "OFFERED" ? { offer: {
          expiresAt: (ride as any).offerExpiresAt?.toISOString() ?? null,
        }} : {}),
      };
    } else if (userId === ride.driverId && (ride as any).client) {
      // Pour le Zem : displayName du client (C.2.4)
      const c = (ride as any).client;
      const { displayName, firstName } = buildDisplayName(c);
      rideVisible.client = { ...c, displayName, firstName };
    }

    // Pourboire (3.2) : le montant envoyé est visible du client ET du Zem de la course ;
    // la fenêtre restante (`tipUntil`) n'est calculée que pour le client propriétaire.
    const tipInfo = await this.readTipForRide(ride);
    if (tipInfo?.tip) {
      rideVisible.tip = tipInfo.tip;
    }
    if (userId === ride.clientId) {
      const tipUntil = this.computeTipUntil(ride);
      if (tipUntil && !rideVisible.tip) {
        rideVisible.tipUntil = tipUntil;
      }
    }

    return rideVisible;
  }

  async history(userId: string) {
    const rides = await this.prisma.ride.findMany({
      where: { OR: [{ clientId: userId }, { driverId: userId }] },
      include: {
        driver: { select: { fullName: true, phone: true, firstName: true, lastName: true } },
        client: { select: { fullName: true, phone: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return Promise.all(
      rides.map(async (ride) => {
        const visible = this.withoutPickupCode(ride) as any;
        const tipInfo = await this.readTipForRide(ride);
        if (tipInfo?.tip) {
          visible.tip = tipInfo.tip;
        }
        if (userId === ride.clientId) {
          const tipUntil = this.computeTipUntil(ride);
          if (tipUntil && !visible.tip) {
            visible.tipUntil = tipUntil;
          }
        }
        return visible;
      })
    );
  }

  /**
   * Pourboire attaché à une course (3.2) : `{ amount, at }` si un pourboire a été
   * envoyé, sinon `null`. Visible du client ET du Zem de la course.
   */
  private async readTipForRide(ride: { id: string }): Promise<{ tip: { amount: number; at: string } | null }> {
    // Défensif : selon les contextes (tests avec mock partiel), le client Prisma peut ne
    // pas exposer `rideTip`. Une panne de lecture du pourboire ne doit jamais faire
    // échouer la lecture de la course.
    const tip = await this.prisma.rideTip
      ?.findUnique({
        where: { rideId: ride.id },
        select: { amount: true, createdAt: true },
      })
      .catch(() => null);
    if (!tip) return { tip: null };
    return { tip: { amount: tip.amount, at: tip.createdAt.toISOString() } };
  }

  /**
   * Fin de la fenêtre d'envoi de pourboire (`completedAt + windowHours`), tant que la
   * course est terminée avec un Zem et qu'aucun pourboire n'a encore été envoyé.
   * Renvoie `null` si la fenêtre n'est pas (ou plus) ouverte. (3.2)
   */
  private computeTipUntil(ride: {
    status: string;
    driverId?: string | null;
    completedAt?: Date | null;
  }): string | null {
    if (ride.status !== "COMPLETED" || !ride.driverId || !ride.completedAt) return null;
    const windowHours = this.pricing.tipSettings().windowHours;
    const until = new Date(ride.completedAt.getTime() + windowHours * 60 * 60 * 1000);
    if (until.getTime() <= Date.now()) return null;
    return until.toISOString();
  }

  /** Profil prestataire (spec tarifaire) d'un conducteur, d'après son dossier et son véhicule. */
  private profileKeyOf(
    driver: {
      provider?: { type: string; vehicleType: string | null } | null;
      agencyId?: string | null;
    } | null
  ): string | null {
    if (!driver?.provider) return null;
    const type = String(driver.provider.type).toUpperCase();
    if (type === "COURIER") return "COURSIER";
    if (type === "DRIVER") {
      // Un conducteur de moto-taxi (Zem essence ou électrique) sans agence est un Zem
      // indépendant : il paie 15 % de ses revenus du mois, pas de commission par course.
      const isZem = this.pricing.isZem(driver.provider.vehicleType);
      const hasAgency = !!driver.agencyId;
      return isZem && !hasAgency ? "ZEM_INDEPENDANT" : null;
    }
    return null;
  }

  /** Retire les deux codes secrets (départ et arrivée) d'une course avant de la renvoyer. */
  private withoutPickupCode<
    T extends {
      pickupCode?: string | null;
      dropCode?: string | null;
      status?: string;
      traveledMeters?: number;
      vehicleType?: string;
      price?: number;
      finalPrice?: number | null;
      settledDistanceMeters?: number | null;
      priceMode?: string | null;
      stopRequestedBy?: string | null;
      stopRequestedAt?: Date | null;
      stopRequestedPrice?: number | null;
      stopRequestedDistanceMeters?: number | null;
      stopAcceptedAt?: Date | null;
    }
  >(
    ride: T
  ): Omit<
    T,
    | "pickupCode"
    | "dropCode"
    | "stopRequestedBy"
    | "stopRequestedAt"
    | "stopRequestedPrice"
    | "stopRequestedDistanceMeters"
    | "stopAcceptedAt"
  > & ReturnType<RidesService["progressFields"]> {
    const {
      pickupCode: _pickupCode,
      dropCode: _dropCode,
      stopRequestedBy: _stopRequestedBy,
      stopRequestedAt: _stopRequestedAt,
      stopRequestedPrice: _stopRequestedPrice,
      stopRequestedDistanceMeters: _stopRequestedDistanceMeters,
      stopAcceptedAt: _stopAcceptedAt,
      ...safeRide
    } = ride;
    return { ...safeRide, ...this.progressFields(ride) };
  }

  private progressFields(ride: {
    id?: string;
    status?: string;
    traveledMeters?: number;
    vehicleType?: string;
    price?: number;
    finalPrice?: number | null;
    settledDistanceMeters?: number | null;
    priceMode?: string | null;
    stopRequestedBy?: string | null;
    stopRequestedAt?: Date | null;
    stopRequestedPrice?: number | null;
    stopRequestedDistanceMeters?: number | null;
    stopAcceptedAt?: Date | null;
  }) {
    const traveledMeters = ride.traveledMeters ?? 0;
    const stopRequest =
      (ride.stopRequestedBy === "CLIENT" || ride.stopRequestedBy === "DRIVER") &&
      ride.stopRequestedAt &&
      ride.stopRequestedPrice !== null &&
      ride.stopRequestedPrice !== undefined &&
      Date.now() - (ride.stopAcceptedAt ?? ride.stopRequestedAt).getTime() <
        this.pricing.rideSettings().stopRequestExpiryMinutes * 60_000
        ? this.stopRequestPayload(
            ride.stopRequestedBy,
            ride.stopRequestedAt,
            ride.stopRequestedPrice,
            ride.stopRequestedDistanceMeters ?? traveledMeters,
            ride.stopAcceptedAt
          )
        : null;
    return {
      traveledMeters,
      ...(ride.status === "IN_PROGRESS" && ride.vehicleType && typeof ride.price === "number"
        ? { currentPrice: this.currentRidePrice({ traveledMeters, vehicleType: ride.vehicleType, price: ride.price }) }
        : {}),
      stopRequest,
      ...(ride.status === "COMPLETED" && ride.finalPrice !== null && ride.finalPrice !== undefined
        ? {
            finalPrice: ride.finalPrice,
            settledDistanceMeters: ride.settledDistanceMeters ?? traveledMeters,
            priceMode: ride.priceMode,
          }
        : {}),
    };
  }

  /**
   * Chaque code n'est lisible que par le client, à son étape : le code de départ à ARRIVED,
   * le code d'arrivée (une fois demandé par le Zem) à IN_PROGRESS.
   */
  private visibleRideToUser<
    T extends {
      clientId: string;
      driverId?: string | null;
      status: string;
      pickupCode?: string | null;
      dropCode?: string | null;
      driverLat?: number | null;
      driverLng?: number | null;
      driverHeading?: number | null;
      driverSpeed?: number | null;
      driverLocatedAt?: Date | null;
      clientLat?: number | null;
      clientLng?: number | null;
      clientLocatedAt?: Date | null;
      // champs WITH_CLIENT
      client?: { fullName?: string | null; phone?: string | null; firstName?: string | null; lastName?: string | null } | null;
      // champs OFFERED
      offerExpiresAt?: Date | null;
      offeredAt?: Date | null;
    }
  >(ride: T, userId: string) {
    const {
      driverLat, driverLng, driverHeading, driverSpeed, driverLocatedAt,
      clientLat, clientLng, clientLocatedAt,
      ...rideWithoutLocations
    } = ride;
    const safe = this.withoutPickupCode(rideWithoutLocations);
    let visible: any = safe;

    if (userId === ride.clientId) {
      // Code de départ visible à ARRIVED, code d'arrivée visible à IN_PROGRESS
      if (ride.status === "ARRIVED") visible = { ...visible, pickupCode: ride.pickupCode };
      if (ride.status === "IN_PROGRESS" && ride.dropCode) visible = { ...visible, dropCode: ride.dropCode };

      // Position du Zem visible dès OFFERED (le client voit "à X km" pendant qu'il décide)
      if (
        ["OFFERED", "MATCHED", "ARRIVED", "IN_PROGRESS"].includes(ride.status) &&
        driverLat !== null && driverLat !== undefined &&
        driverLng !== null && driverLng !== undefined && driverLocatedAt
      ) {
        visible = {
          ...visible,
          driverLocation: {
            lat: driverLat, lng: driverLng,
            ...(driverHeading !== null && driverHeading !== undefined ? { heading: driverHeading } : {}),
            ...(driverSpeed !== null && driverSpeed !== undefined ? { speed: driverSpeed } : {}),
            at: driverLocatedAt.getTime(),
          },
        };
      }
    } else if (userId === ride.driverId) {
      // Position du client visible au Zem uniquement en MATCHED/ARRIVED (C.2.1)
      if (
        ["MATCHED", "ARRIVED"].includes(ride.status) &&
        clientLat !== null && clientLat !== undefined &&
        clientLng !== null && clientLng !== undefined && clientLocatedAt
      ) {
        visible = {
          ...visible,
          clientLocation: { lat: clientLat, lng: clientLng, at: clientLocatedAt.getTime() },
        };
      }
    }

    return visible;
  }

  private async getOwnedByDriver(rideId: string, driverId: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId }, include: WITH_CLIENT });
    if (!ride) throw new NotFoundException("Course introuvable");
    if (ride.driverId !== driverId) throw new ForbiddenException("Cette course ne vous est pas attribuée");
    return ride;
  }
}
