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

  async accept(rideId: string, driverId: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundException("Course introuvable");
    if (ride.status !== "PENDING") throw new BadRequestException("Course déjà prise");
    const updated = await this.prisma.ride.update({ where: { id: rideId }, data: { driverId, status: "MATCHED" } });
    await this.notifications.push(ride.clientId, "Chauffeur trouvé", "Un chauffeur a accepté ta course et arrive vers toi.", "ride");
    this.gateway.emitStatus(rideId, "MATCHED");
    return updated;
  }

  async start(rideId: string, driverId: string) {
    const ride = await this.getOwnedByDriver(rideId, driverId);
    if (ride.status !== "MATCHED") throw new BadRequestException("Statut invalide");
    const updated = await this.prisma.ride.update({ where: { id: rideId }, data: { status: "IN_PROGRESS" } });
    await this.notifications.push(ride.clientId, "Course démarrée", "Ton chauffeur est en route vers la destination.", "ride");
    this.gateway.emitStatus(rideId, "IN_PROGRESS");
    return updated;
  }

  // Fin de course : paiement + commission + revenus du chauffeur
  async complete(rideId: string, driverId: string) {
    const ride = await this.getOwnedByDriver(rideId, driverId);
    if (ride.status !== "IN_PROGRESS") throw new BadRequestException("La course n'est pas en cours");

    const driver = await this.prisma.user.findUnique({ where: { id: driverId }, include: { agency: true } });
    const rate = driver?.agency ? driver.agency.commissionRate : INDEPENDENT_RATE;
    const commission = Math.round(ride.price * rate);
    const driverGain = ride.price - commission;

    // 1) Le client paie  2) Le chauffeur est crédité (montant - commission)
    await this.wallet.debit(ride.clientId, ride.price, "Course AZƆ̀", `Course #${ride.id.slice(0, 6)}`);
    await this.wallet.credit(driverId, driverGain, "Gain de course", `Course #${ride.id.slice(0, 6)}`);

    const updated = await this.prisma.ride.update({ where: { id: rideId }, data: { status: "COMPLETED", commission } });
    await this.notifications.push(ride.clientId, "Course terminée", `${ride.price} FCFA débités de ton portefeuille.`, "payment");
    await this.notifications.push(driverId, "Paiement reçu", `+${driverGain} FCFA (commission AZƆ̀ : ${commission} F).`, "payment");
    this.gateway.emitStatus(rideId, "COMPLETED");
    return updated;
  }

  async rate(rideId: string, clientId: string, stars: number) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride || ride.clientId !== clientId) throw new ForbiddenException();
    return this.prisma.ride.update({ where: { id: rideId }, data: { rating: stars } });
  }

  // Détail d'une course (avec les infos du chauffeur) — lu par l'écran de suivi
  async findOne(id: string, userId: string) {
    const ride = await this.prisma.ride.findUnique({
      where: { id },
      include: { driver: { select: { fullName: true, phone: true } } },
    });
    if (!ride) throw new NotFoundException("Course introuvable");
    if (ride.clientId !== userId && ride.driverId !== userId) throw new ForbiddenException();
    return ride;
  }

  history(userId: string) {
    return this.prisma.ride.findMany({
      where: { OR: [{ clientId: userId }, { driverId: userId }] },
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
