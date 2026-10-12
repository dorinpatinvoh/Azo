import {
  BadRequestException,
  ForbiddenException,
  Injectable,
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
import { LatLng, buildRadar, isRideExpired, rideAgeMinutes } from "./radar";
import { haversineMeters } from "./odometer";

// Le client attaché à la course, tel que le chauffeur le reçoit (même forme que `accept`).
// L'app Zem remplace sa course active par chaque réponse (accept, arrive, start) : toutes
// doivent donc porter `client`, sinon le pseudo disparaît de l'écran dès l'arrivée.
const WITH_CLIENT = { client: { select: { fullName: true, phone: true } } } as const;

function createPickupCode(): string {
  return String(randomInt(0, 10_000)).padStart(4, "0");
}

@Injectable()
export class RidesService {
  private readonly routeCache = new Map<string, { expiresAt: number; route: Record<string, unknown> }>();
  private readonly lastValidRoutes = new Map<string, Record<string, unknown>>();

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

  async route(rideId: string, userId: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundException("Course introuvable");
    if (ride.clientId !== userId && ride.driverId !== userId) throw new ForbiddenException();
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
    const stage = inProgress ? "destination" : "pickup";
    const latitudeGrid = Math.round(from.lat / (50 / 111_195));
    const longitudeMetersPerDegree = 111_195 * Math.max(0.1, Math.cos((from.lat * Math.PI) / 180));
    const longitudeGrid = Math.round(from.lng / (50 / longitudeMetersPerDegree));
    const cacheKey = `${rideId}:${stage}:${latitudeGrid}:${longitudeGrid}`;
    const cached = this.routeCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.route;

    const routeKey = `${rideId}:${stage}`;
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
        typeof candidate !== "object" ||
        candidate === null ||
        !("distance" in candidate) ||
        typeof candidate.distance !== "number" ||
        !("duration" in candidate) ||
        typeof candidate.duration !== "number" ||
        !("geometry" in candidate) ||
        typeof candidate.geometry !== "object" ||
        candidate.geometry === null ||
        !("coordinates" in candidate.geometry) ||
        !Array.isArray(candidate.geometry.coordinates)
      ) {
        throw new Error("OSRM returned no valid route geometry");
      }
      const simplifiedCoordinates = this.simplifyRouteCoordinates(candidate.geometry.coordinates);
      if (simplifiedCoordinates.length < 2) throw new Error("OSRM route geometry is empty");
      const computedAt = new Date().toISOString();
      const route = {
        rideId,
        stage,
        coordinates: simplifiedCoordinates,
        distanceKm: candidate.distance / 1000,
        durationMinutes: Math.max(1, Math.ceil(candidate.duration / 60)),
        computedAt,
        fallback: false,
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
      this.routeCache.set(cacheKey, {
        expiresAt: Date.now() + this.pricing.rideSettings().routeCacheSeconds * 1000,
        route,
      });
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
    const { price } = await this.estimate(dto);
    const ride = await this.prisma.ride.create({
      data: { ...dto, clientId, price, commission: 0, status: "PENDING", pickupCode: createPickupCode() },
    });

    // Notification des chauffeurs dont le véhicule correspond (notification in-app :
    // elle apparaît dans l'écran « Notifications » et alimente le badge du radar).
    await this.notifyMatchingDrivers(ride.vehicleType, ride.price).catch(() => 0);

    // Diffusion temps réel : les radars ouverts se rafraîchissent sans attendre le
    // prochain cycle de rafraîchissement (8 s côté chauffeur).
    this.gateway.emitNewRequest({
      rideId: ride.id,
      vehicleType: ride.vehicleType,
      price: ride.price,
      originLat: ride.originLat,
      originLng: ride.originLng,
    });

    // Le code reste côté serveur jusqu'à l'arrivée du chauffeur.
    return this.withoutPickupCode(ride);
  }

  /**
   * Prévient les chauffeurs disponibles qu'une demande vient d'être publiée.
   *
   * Seuls les chauffeurs dont le dossier est **validé** (`APPROVED`) et dont le véhicule
   * correspond à la demande sont prévenus — la même règle que le radar
   * (`pricing.rideVisibleFor`), dans la limite de `radar.driverNotificationMax` pour ne
   * pas inonder la base sur une place très fréquentée.
   */
  private async notifyMatchingDrivers(vehicleType: string, price: number): Promise<number> {
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
  async pending(driverId: string, position?: LatLng) {
    const driver = await this.prisma.user.findUnique({
      where: { id: driverId },
      include: { provider: true },
    });
    if (driver?.provider?.type === "COURIER") return [];

    const driverVehicle = driver?.provider?.vehicleType ?? null;
    const settings = this.pricing.radarSettings();
    // Le chauffeur voit la destination (destLat/destLng) et le pseudo du client avant
    // d'accepter. Seul `fullName` est lu : le radar ne diffuse rien d'autre du client.
    const rides = await this.prisma.ride.findMany({
      where: { status: "PENDING" },
      include: { client: { select: { fullName: true } } },
      orderBy: { createdAt: "asc" },
    });

    // Le calcul (expiration, proximité) porte sur TOUTES les demandes en attente :
    // n'importe quel radar ouvert nettoie ainsi les demandes trop anciennes, quel que
    // soit le véhicule du chauffeur qui interroge le serveur.
    const { rides: radar, expired } = buildRadar(rides, {
      expiryMinutes: settings.pendingExpiryMinutes,
      radiusKm: settings.searchRadiusKm,
      driver: position ?? null,
    });

    // Les demandes trop anciennes sont annulées au passage (aucun débit client) :
    // elles ne traînent ni dans le radar, ni dans l'historique du client.
    if (expired.length > 0) {
      await Promise.all(expired.map((ride) => this.expireRide(ride).catch(() => false)));
    }

    // Filtrage par véhicule en dernier : c'est la règle du radar (Zem essence ≠ Zem
    // électrique ; Gazelle ≠ Koala ≠ Léopard ; coursiers sans demandes de transport).
    return radar
      .filter((ride) => this.pricing.rideVisibleFor(driverVehicle, ride.vehicleType))
      .map((ride) => this.withoutPickupCode(ride));
  }

  // Un chauffeur ne peut conduire qu'une course à la fois
  private async assertDriverIsFree(driverId: string) {
    const current = await this.prisma.ride.findFirst({
      where: { driverId, status: { in: ["MATCHED", "ARRIVED", "IN_PROGRESS"] } },
      select: { id: true },
    });
    if (current) throw new BadRequestException("Tu as déjà une course en cours");
  }

  // Acceptation atomique : `updateMany` avec le statut dans le WHERE évite que deux
  // chauffeurs prennent la même course en même temps (avant : lecture puis écriture).
  async accept(rideId: string, driverId: string) {
    await this.assertDriverIsFree(driverId);

    const { count } = await this.prisma.ride.updateMany({
      where: { id: rideId, status: "PENDING" },
      data: { driverId, status: "MATCHED" },
    });
    if (count === 0) {
      const exists = await this.prisma.ride.findUnique({ where: { id: rideId }, select: { id: true } });
      if (!exists) throw new NotFoundException("Course introuvable");
      throw new BadRequestException("Course déjà prise");
    }

    const ride = await this.prisma.ride.findUniqueOrThrow({
      where: { id: rideId },
      include: WITH_CLIENT,
    });
    this.gateway.invalidateRideLocationContext(rideId);
    await this.notifications.push(ride.clientId, "Chauffeur trouvé", "Un chauffeur a accepté ta course et arrive vers toi.", "ride", {
      titleKey: "NOTIFICATION_RIDE_MATCHED",
      bodyKey: "NOTIFICATION_RIDE_MATCHED_BODY",
    });
    this.gateway.emitStatus(rideId, "MATCHED");
    return this.withoutPickupCode(ride);
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

    const amount = Math.min(ride.stopRequestedPrice, ride.price);
    const result = await this.settle(ride, ride.driverId, {
      amount,
      settledDistanceMeters: ride.stopRequestedDistanceMeters ?? ride.traveledMeters,
      priceMode: "PARTIAL",
      stopRequestAt: ride.stopRequestedAt,
      stopRequestedBy: ride.stopRequestedBy,
    });
    this.gateway.emitStopRequest(rideId, null, { accepted: true });
    return result;
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

  private stopRequestPayload(by: "CLIENT" | "DRIVER", at: Date, price: number, distanceMeters: number) {
    const ttl = this.pricing.rideSettings().stopRequestExpiryMinutes * 60_000;
    return {
      by,
      at: at.toISOString(),
      expiresAt: new Date(at.getTime() + ttl).toISOString(),
      price,
      distanceMeters,
    };
  }

  private async expireStopRequestIfNeeded(ride: {
    id: string;
    stopRequestedAt: Date | null;
  }) {
    const ttl = this.pricing.rideSettings().stopRequestExpiryMinutes * 60_000;
    if (!ride.stopRequestedAt || Date.now() - ride.stopRequestedAt.getTime() < ttl) return false;
    const { count } = await this.prisma.ride.updateMany({
      where: { id: ride.id, status: "IN_PROGRESS", stopRequestedAt: ride.stopRequestedAt },
      data: {
        stopRequestedBy: null,
        stopRequestedAt: null,
        stopRequestedPrice: null,
        stopRequestedDistanceMeters: null,
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
    if (ride.status !== "PENDING" && ride.status !== "MATCHED" && ride.status !== "ARRIVED") {
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

    if (isClient) {
      if (ride.driverId) {
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
    const updated = await this.prisma.ride.update({ where: { id: rideId }, data: { rating: stars } });
    return this.withoutPickupCode(updated);
  }

  // Détail d'une course (avec les infos du chauffeur ET du client) — lu par l'écran
  // de suivi côté client et par la fiche course côté chauffeur.
  async findOne(id: string, userId: string) {
    let ride = await this.prisma.ride.findUnique({
      where: { id },
      include: {
        driver: { select: { fullName: true, phone: true } },
        client: { select: { fullName: true, phone: true } },
      },
    });
    if (!ride) throw new NotFoundException("Course introuvable");
    if (ride.clientId !== userId && ride.driverId !== userId) throw new ForbiddenException();

    // Demande restée sans chauffeur : on l'annule au moment où le client recharge son
    // suivi (aucun débit), et on le lui signale dans la réponse (`expired: true`).
    if (ride.status === "PENDING" && isRideExpired(ride.createdAt, this.pricing.radarSettings().pendingExpiryMinutes)) {
      const cancelled = await this.expireRide(ride);
      if (cancelled) return this.visibleRideToUser({ ...ride, status: "CANCELLED", expired: true }, userId);
    }

    // Le client voit combien de temps il reste avant l'expiration de sa demande.
    if (ride.status === "PENDING") {
      const expiryMinutes = this.pricing.radarSettings().pendingExpiryMinutes;
      const ageMinutes = rideAgeMinutes(ride.createdAt);
      return this.visibleRideToUser(
        { ...ride, expiresInMinutes: Math.max(0, Math.ceil(expiryMinutes - ageMinutes)) },
        userId
      );
    }
    if (ride.status === "IN_PROGRESS" && (await this.expireStopRequestIfNeeded(ride))) {
      ride = await this.prisma.ride.findUniqueOrThrow({
        where: { id },
        include: {
          driver: { select: { fullName: true, phone: true } },
          client: { select: { fullName: true, phone: true } },
        },
      });
    }
    return this.visibleRideToUser(ride, userId);
  }

  async history(userId: string) {
    const rides = await this.prisma.ride.findMany({
      where: { OR: [{ clientId: userId }, { driverId: userId }] },
      include: {
        driver: { select: { fullName: true, phone: true } },
        client: { select: { fullName: true, phone: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    // L'historique n'a jamais besoin du code, même si le client possède la course.
    return rides.map((ride) => this.withoutPickupCode(ride));
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
  > & ReturnType<RidesService["progressFields"]> {
    const {
      pickupCode: _pickupCode,
      dropCode: _dropCode,
      stopRequestedBy: _stopRequestedBy,
      stopRequestedAt: _stopRequestedAt,
      stopRequestedPrice: _stopRequestedPrice,
      stopRequestedDistanceMeters: _stopRequestedDistanceMeters,
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
  }) {
    const traveledMeters = ride.traveledMeters ?? 0;
    const stopRequest =
      (ride.stopRequestedBy === "CLIENT" || ride.stopRequestedBy === "DRIVER") &&
      ride.stopRequestedAt &&
      ride.stopRequestedPrice !== null &&
      ride.stopRequestedPrice !== undefined &&
      Date.now() - ride.stopRequestedAt.getTime() <
        this.pricing.rideSettings().stopRequestExpiryMinutes * 60_000
        ? this.stopRequestPayload(
            ride.stopRequestedBy,
            ride.stopRequestedAt,
            ride.stopRequestedPrice,
            ride.stopRequestedDistanceMeters ?? traveledMeters
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
    }
  >(ride: T, userId: string) {
    const {
      driverLat,
      driverLng,
      driverHeading,
      driverSpeed,
      driverLocatedAt,
      clientLat,
      clientLng,
      clientLocatedAt,
      ...rideWithoutLocations
    } = ride;
    const safe = this.withoutPickupCode(rideWithoutLocations);
    let visible = safe;
    if (userId === ride.clientId) {
      if (ride.status === "ARRIVED") visible = { ...visible, pickupCode: ride.pickupCode };
      if (ride.status === "IN_PROGRESS" && ride.dropCode) visible = { ...visible, dropCode: ride.dropCode };
      if (
        ["MATCHED", "ARRIVED", "IN_PROGRESS"].includes(ride.status) &&
        driverLat !== null &&
        driverLat !== undefined &&
        driverLng !== null &&
        driverLng !== undefined &&
        driverLocatedAt
      ) {
        visible = {
          ...visible,
          driverLocation: {
            lat: driverLat,
            lng: driverLng,
            ...(driverHeading !== null && driverHeading !== undefined ? { heading: driverHeading } : {}),
            ...(driverSpeed !== null && driverSpeed !== undefined ? { speed: driverSpeed } : {}),
            at: driverLocatedAt.getTime(),
          },
        };
      }
    } else if (
      userId === ride.driverId &&
      ["MATCHED", "ARRIVED"].includes(ride.status) &&
      clientLat !== null &&
      clientLat !== undefined &&
      clientLng !== null &&
      clientLng !== undefined &&
      clientLocatedAt
    ) {
      visible = {
        ...visible,
        clientLocation: { lat: clientLat, lng: clientLng, at: clientLocatedAt.getTime() },
      };
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
