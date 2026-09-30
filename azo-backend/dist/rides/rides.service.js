"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RidesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const wallet_module_1 = require("../wallet/wallet.module");
const notifications_module_1 = require("../notifications/notifications.module");
const rides_gateway_1 = require("./rides.gateway");
// Tarifs fixes de la maquette (FCFA). À remplacer par un vrai calcul distance/durée.
const BASE_PRICES = {
    ZEM: 650,
    ZEM_ELECTRIC: 600,
    CAR: 1850,
};
// Taux de commission AZƆ̀ : 15% pour un indépendant, taux de la formule pour une agence
const INDEPENDENT_RATE = 0.15;
let RidesService = class RidesService {
    constructor(prisma, wallet, notifications, gateway) {
        this.prisma = prisma;
        this.wallet = wallet;
        this.notifications = notifications;
        this.gateway = gateway;
    }
    // Distance approximative en km (formule de Haversine)
    distanceKm(lat1, lng1, lat2, lng2) {
        const R = 6371;
        const dLat = ((lat2 - lat1) * Math.PI) / 180;
        const dLng = ((lng2 - lng1) * Math.PI) / 180;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    // Estimation affichée avant confirmation (écran "Sélection trajet")
    estimate(dto) {
        const km = this.distanceKm(dto.originLat, dto.originLng, dto.destLat, dto.destLng);
        const price = BASE_PRICES[dto.vehicleType];
        return { distanceKm: Number(km.toFixed(1)), etaMinutes: Math.max(3, Math.round(km * 3)), price };
    }
    async create(clientId, dto) {
        const price = BASE_PRICES[dto.vehicleType];
        return this.prisma.ride.create({
            data: { ...dto, clientId, price, commission: 0, status: "PENDING" },
        });
    }
    // Courses en attente visibles par les chauffeurs (écran "Zém Radar")
    pending() {
        return this.prisma.ride.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" } });
    }
    async accept(rideId, driverId) {
        const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
        if (!ride)
            throw new common_1.NotFoundException("Course introuvable");
        if (ride.status !== "PENDING")
            throw new common_1.BadRequestException("Course déjà prise");
        const updated = await this.prisma.ride.update({ where: { id: rideId }, data: { driverId, status: "MATCHED" } });
        await this.notifications.push(ride.clientId, "Chauffeur trouvé", "Un chauffeur a accepté ta course et arrive vers toi.", "ride");
        this.gateway.emitStatus(rideId, "MATCHED");
        return updated;
    }
    async start(rideId, driverId) {
        const ride = await this.getOwnedByDriver(rideId, driverId);
        if (ride.status !== "MATCHED")
            throw new common_1.BadRequestException("Statut invalide");
        const updated = await this.prisma.ride.update({ where: { id: rideId }, data: { status: "IN_PROGRESS" } });
        await this.notifications.push(ride.clientId, "Course démarrée", "Ton chauffeur est en route vers la destination.", "ride");
        this.gateway.emitStatus(rideId, "IN_PROGRESS");
        return updated;
    }
    // Fin de course : paiement + commission + revenus du chauffeur
    async complete(rideId, driverId) {
        const ride = await this.getOwnedByDriver(rideId, driverId);
        if (ride.status !== "IN_PROGRESS")
            throw new common_1.BadRequestException("La course n'est pas en cours");
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
    async rate(rideId, clientId, stars) {
        const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
        if (!ride || ride.clientId !== clientId)
            throw new common_1.ForbiddenException();
        return this.prisma.ride.update({ where: { id: rideId }, data: { rating: stars } });
    }
    // Détail d'une course (avec les infos du chauffeur) — lu par l'écran de suivi
    async findOne(id, userId) {
        const ride = await this.prisma.ride.findUnique({
            where: { id },
            include: { driver: { select: { fullName: true, phone: true } } },
        });
        if (!ride)
            throw new common_1.NotFoundException("Course introuvable");
        if (ride.clientId !== userId && ride.driverId !== userId)
            throw new common_1.ForbiddenException();
        return ride;
    }
    history(userId) {
        return this.prisma.ride.findMany({
            where: { OR: [{ clientId: userId }, { driverId: userId }] },
            orderBy: { createdAt: "desc" },
        });
    }
    async getOwnedByDriver(rideId, driverId) {
        const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
        if (!ride)
            throw new common_1.NotFoundException("Course introuvable");
        if (ride.driverId !== driverId)
            throw new common_1.ForbiddenException("Cette course ne vous est pas attribuée");
        return ride;
    }
};
exports.RidesService = RidesService;
exports.RidesService = RidesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        wallet_module_1.WalletService,
        notifications_module_1.NotificationsService,
        rides_gateway_1.RidesGateway])
], RidesService);
//# sourceMappingURL=rides.service.js.map