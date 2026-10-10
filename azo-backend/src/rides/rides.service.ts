import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomInt } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { WalletService } from "../wallet/wallet.module";
import { NotificationsService } from "../notifications/notifications.module";
import { PricingService } from "../pricing/pricing.module";
import { RidesGateway } from "./rides.gateway";
import { CreateRideDto } from "./dto/create-ride.dto";
import { LatLng, buildRadar, isRideExpired, rideAgeMinutes } from "./radar";

function createPickupCode(): string {
  return String(randomInt(0, 10_000)).padStart(4, "0");
}

@Injectable()
export class RidesService {
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
          "ride"
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
      data: { status: "CANCELLED" },
    });
    if (count === 0) return false;

    const minutes = this.pricing.radarSettings().pendingExpiryMinutes;
    await this.notifications.push(
      ride.clientId,
      "Aucun chauffeur trouvé",
      `Ta demande est restée ${minutes} min sans chauffeur disponible : elle a été annulée. Aucun montant n'a été débité — relance une recherche.`,
      "ride"
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
      include: { client: { select: { fullName: true, phone: true } } },
    });
    await this.notifications.push(ride.clientId, "Chauffeur trouvé", "Un chauffeur a accepté ta course et arrive vers toi.", "ride");
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

    const arrivedRide = await this.prisma.ride.findUniqueOrThrow({ where: { id: rideId } });
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
        { sendPush: true, data: { event: "ride-arrived", rideId } }
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
      data: { status: "IN_PROGRESS", pickupCode: null },
    });
    if (count === 0) throw new BadRequestException("Le statut de la course a changé. Actualise l'écran.");

    await this.notifications.push(ride.clientId, "Course démarrée", "Ton chauffeur est en route vers la destination.", "ride");
    this.gateway.emitStatus(rideId, "IN_PROGRESS");
    const updated = await this.prisma.ride.findUniqueOrThrow({ where: { id: rideId } });
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
  async complete(rideId: string, driverId: string) {
    const ride = await this.getOwnedByDriver(rideId, driverId);
    if (ride.status !== "IN_PROGRESS") throw new BadRequestException("La course n'est pas en cours");

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
      ride.price
    );
    const driverGain = ride.price - commission;
    const ref = `Course #${ride.id.slice(0, 6)}`;

    // Débit client + crédit chauffeur atomiques (le chauffeur reçoit prix - commission)
    await this.wallet.transfer(ride.clientId, driverId, ride.price, driverGain, "Course AZƆ̀", "Gain de course", ref);

    const updated = await this.prisma.ride.update({ where: { id: rideId }, data: { status: "COMPLETED", commission } });
    await this.notifications.push(ride.clientId, "Course terminée", `${ride.price} FCFA débités de ton portefeuille.`, "payment");
    await this.notifications.push(driverId, "Paiement reçu", `+${driverGain} FCFA (commission AZƆ̀ : ${commission} F).`, "payment");
    this.gateway.emitStatus(rideId, "COMPLETED");
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
      ? await this.prisma.ride.update({ where: { id: rideId }, data: { status: "CANCELLED" } })
      : await this.prisma.ride.update({
          where: { id: rideId },
          data: { status: "PENDING", driverId: null, driverArrivedAt: null, pickupCode: createPickupCode() },
        });

    if (isClient) {
      if (ride.driverId) {
        await this.notifications.push(ride.driverId, "Course annulée", "Le client a annulé la course.", "ride");
      }
    } else {
      await this.notifications.push(ride.clientId, "Course annulée", "Ton chauffeur a annulé. Recherche d'un nouveau chauffeur…", "ride");
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
    const ride = await this.prisma.ride.findUnique({
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

  private withoutPickupCode<T extends { pickupCode?: string | null }>(ride: T): Omit<T, "pickupCode"> {
    const { pickupCode: _pickupCode, ...safeRide } = ride;
    return safeRide;
  }

  /** Le code n'est lisible que par le client, et seulement après le statut ARRIVED. */
  private visibleRideToUser<T extends { clientId: string; status: string; pickupCode?: string | null }>(
    ride: T,
    userId: string
  ) {
    return userId === ride.clientId && ride.status === "ARRIVED" ? ride : this.withoutPickupCode(ride);
  }

  private async getOwnedByDriver(rideId: string, driverId: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundException("Course introuvable");
    if (ride.driverId !== driverId) throw new ForbiddenException("Cette course ne vous est pas attribuée");
    return ride;
  }
}
