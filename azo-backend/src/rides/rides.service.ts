import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { VehicleType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { WalletService } from "../wallet/wallet.module";
import { NotificationsService } from "../notifications/notifications.module";
import { RidesGateway } from "./rides.gateway";
import { CreateRideDto } from "./dto/create-ride.dto";

// Tarifs fixes de la maquette (FCFA). À remplacer par un vrai calcul distance/durée.
const BASE_PRICES: Record<VehicleType, number> = {
  ZEM: 650,
  ZEM_ELECTRIC: 600,
  CAR: 1850,
};

// Taux de commission AZƆ̀ : 15% pour un indépendant, taux de la formule pour une agence
const INDEPENDENT_RATE = 0.15;

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

  // Estimation affichée avant confirmation (écran "Sélection trajet")
  estimate(dto: CreateRideDto) {
    const km = this.distanceKm(dto.originLat, dto.originLng, dto.destLat, dto.destLng);
    const price = BASE_PRICES[dto.vehicleType];
    return { distanceKm: Number(km.toFixed(1)), etaMinutes: Math.max(3, Math.round(km * 3)), price };
  }

  async create(clientId: string, dto: CreateRideDto) {
    const price = BASE_PRICES[dto.vehicleType];
    return this.prisma.ride.create({
      data: { ...dto, clientId, price, commission: 0, status: "PENDING" },
    });
  }

  // Courses en attente visibles par les chauffeurs (écran "Zém Radar")
  pending() {
    return this.prisma.ride.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" } });
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

  // Fin de course : paiement + commission + revenus du chauffeur, en une transaction
  async complete(rideId: string, driverId: string) {
    const ride = await this.getOwnedByDriver(rideId, driverId);
    if (ride.status !== "IN_PROGRESS") throw new BadRequestException("La course n'est pas en cours");

    const driver = await this.prisma.user.findUnique({ where: { id: driverId }, include: { agency: true } });
    const rate = driver?.agency ? driver.agency.commissionRate : INDEPENDENT_RATE;
    const commission = Math.round(ride.price * rate);
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

  private async getOwnedByDriver(rideId: string, driverId: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundException("Course introuvable");
    if (ride.driverId !== driverId) throw new ForbiddenException("Cette course ne vous est pas attribuée");
    return ride;
  }
}
