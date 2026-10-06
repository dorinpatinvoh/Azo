import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { WalletService } from "../wallet/wallet.module";
import { NotificationsService } from "../notifications/notifications.module";
import { PricingService } from "../pricing/pricing.module";
import { RidesGateway } from "./rides.gateway";
import { CreateRideDto } from "./dto/create-ride.dto";
import { LatLng, buildRadar, isRideExpired, rideAgeMinutes } from "./radar";

export function rideSecurityPin(rideId: string): string {
  let hash = 2166136261;
  for (let i = 0; i < rideId.length; i++) {
    hash ^= rideId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return String((Math.abs(hash) % 9000) + 1000);
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

  // Distance approximative en km (formule de Haversine)
  private distanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Estimation affichée avant confirmation (écran "Sélection trajet").
  // Le prix vient du barème configuré : tarif de base + coût kilométrique par tranche.
  estimate(dto: CreateRideDto) {
    const km = this.distanceKm(dto.originLat, dto.originLng, dto.destLat, dto.destLng);
    const breakdown = this.pricing.breakdown(km, dto.vehicleType);
    return {
      distanceKm: Number(km.toFixed(1)),
      etaMinutes: Math.max(3, Math.round(km * 3)),
      price: breakdown.price,
      gamme: breakdown.gamme,
      breakdown,
    };
  }

  async create(clientId: string, dto: CreateRideDto) {
    const { price } = this.estimate(dto);
    const ride = await this.prisma.ride.create({
      data: { ...dto, clientId, price, commission: 0, status: "PENDING" },
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

    return ride;
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
    const rides = await this.prisma.ride.findMany({
      where: { status: "PENDING" },
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
    return radar.filter((ride) => this.pricing.rideVisibleFor(driverVehicle, ride.vehicleType));
  }

  // Un chauffeur ne peut conduire qu'une course à la fois
  private async assertDriverIsFree(driverId: string) {
    const current = await this.prisma.ride.findFirst({
      where: { driverId, status: { in: ["MATCHED", "IN_PROGRESS"] } },
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
    return ride;
  }

  async start(rideId: string, driverId: string, pin?: string) {
    const ride = await this.getOwnedByDriver(rideId, driverId);
    if (ride.status !== "MATCHED") throw new BadRequestException("Statut invalide");

    if (pin && pin.trim() && pin.trim() !== rideSecurityPin(rideId)) {
      throw new BadRequestException("Code Bouclier AZƆ̀ incorrect. Demande les 4 chiffres affichés sur l'écran du client.");
    }

    // On vérifie le solde AVANT le départ : sinon la course se terminait avec un
    // client insolvable et le chauffeur n'était jamais payé.
    const clientWallet = await this.prisma.wallet.findUnique({ where: { userId: ride.clientId } });
    if (!clientWallet || clientWallet.balance < ride.price) {
      throw new BadRequestException("Le client n'a pas assez de solde AZƆ̀ Pay pour cette course");
    }

    const updated = await this.prisma.ride.update({ where: { id: rideId }, data: { status: "IN_PROGRESS" } });
    await this.notifications.push(ride.clientId, "Course démarrée", "Ton chauffeur est en route vers la destination.", "ride");
    this.gateway.emitStatus(rideId, "IN_PROGRESS");
    return updated;
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
    return updated;
  }

  // Annulation par le client (course non démarrée) ou par le chauffeur (course acceptée)
  async cancel(rideId: string, userId: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundException("Course introuvable");

    const isClient = ride.clientId === userId;
    const isDriver = ride.driverId === userId;
    if (!isClient && !isDriver) throw new ForbiddenException();
    if (ride.status !== "PENDING" && ride.status !== "MATCHED") {
      throw new BadRequestException("Cette course ne peut plus être annulée");
    }

    // Client : la course est annulée pour de bon.
    // Chauffeur : elle repart en recherche pour qu'un autre chauffeur la prenne.
    const updated = isClient
      ? await this.prisma.ride.update({ where: { id: rideId }, data: { status: "CANCELLED" } })
      : await this.prisma.ride.update({ where: { id: rideId }, data: { status: "PENDING", driverId: null } });

    if (isClient) {
      if (ride.driverId) {
        await this.notifications.push(ride.driverId, "Course annulée", "Le client a annulé la course.", "ride");
      }
    } else {
      await this.notifications.push(ride.clientId, "Course annulée", "Ton chauffeur a annulé. Recherche d'un nouveau chauffeur…", "ride");
    }

    this.gateway.emitStatus(rideId, updated.status);
    return updated;
  }

  async rate(rideId: string, clientId: string, stars: number) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride || ride.clientId !== clientId) throw new ForbiddenException();
    return this.prisma.ride.update({ where: { id: rideId }, data: { rating: stars } });
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
      if (cancelled) return { ...ride, status: "CANCELLED", expired: true };
    }

    // Le client voit combien de temps il reste avant l'expiration de sa demande.
    if (ride.status === "PENDING") {
      const expiryMinutes = this.pricing.radarSettings().pendingExpiryMinutes;
      const ageMinutes = rideAgeMinutes(ride.createdAt);
      return { ...ride, expiresInMinutes: Math.max(0, Math.ceil(expiryMinutes - ageMinutes)) };
    }
    return ride;
  }

  history(userId: string) {
    return this.prisma.ride.findMany({
      where: { OR: [{ clientId: userId }, { driverId: userId }] },
      include: {
        driver: { select: { fullName: true, phone: true } },
        client: { select: { fullName: true, phone: true } },
      },
      orderBy: { createdAt: "desc" },
    });
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

  private async getOwnedByDriver(rideId: string, driverId: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundException("Course introuvable");
    if (ride.driverId !== driverId) throw new ForbiddenException("Cette course ne vous est pas attribuée");
    return ride;
  }
}
