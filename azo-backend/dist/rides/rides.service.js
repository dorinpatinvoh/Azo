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
exports.rideSecurityPin = rideSecurityPin;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const wallet_module_1 = require("../wallet/wallet.module");
const notifications_module_1 = require("../notifications/notifications.module");
const pricing_module_1 = require("../pricing/pricing.module");
const rides_gateway_1 = require("./rides.gateway");
function rideSecurityPin(rideId) {
    let hash = 2166136261;
    for (let i = 0; i < rideId.length; i++) {
        hash ^= rideId.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return String((Math.abs(hash) % 9000) + 1000);
}
let RidesService = class RidesService {
    constructor(prisma, wallet, notifications, pricing, gateway) {
        this.prisma = prisma;
        this.wallet = wallet;
        this.notifications = notifications;
        this.pricing = pricing;
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
    // Estimation affichée avant confirmation (écran "Sélection trajet").
    // Le prix vient du barème configuré : tarif de base + coût kilométrique par tranche.
    estimate(dto) {
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
    async create(clientId, dto) {
        const { price } = this.estimate(dto);
        return this.prisma.ride.create({
            data: { ...dto, clientId, price, commission: 0, status: "PENDING" },
        });
    }
    // Courses en attente visibles par les chauffeurs (écran "Zém Radar")
    pending() {
        return this.prisma.ride.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" } });
    }
    // Un chauffeur ne peut conduire qu'une course à la fois
    async assertDriverIsFree(driverId) {
        const current = await this.prisma.ride.findFirst({
            where: { driverId, status: { in: ["MATCHED", "IN_PROGRESS"] } },
            select: { id: true },
        });
        if (current)
            throw new common_1.BadRequestException("Tu as déjà une course en cours");
    }
    // Acceptation atomique : `updateMany` avec le statut dans le WHERE évite que deux
    // chauffeurs prennent la même course en même temps (avant : lecture puis écriture).
    async accept(rideId, driverId) {
        await this.assertDriverIsFree(driverId);
        const { count } = await this.prisma.ride.updateMany({
            where: { id: rideId, status: "PENDING" },
            data: { driverId, status: "MATCHED" },
        });
        if (count === 0) {
            const exists = await this.prisma.ride.findUnique({ where: { id: rideId }, select: { id: true } });
            if (!exists)
                throw new common_1.NotFoundException("Course introuvable");
            throw new common_1.BadRequestException("Course déjà prise");
        }
        const ride = await this.prisma.ride.findUniqueOrThrow({
            where: { id: rideId },
            include: { client: { select: { fullName: true, phone: true } } },
        });
        await this.notifications.push(ride.clientId, "Chauffeur trouvé", "Un chauffeur a accepté ta course et arrive vers toi.", "ride");
        this.gateway.emitStatus(rideId, "MATCHED");
        return ride;
    }
    async start(rideId, driverId, pin) {
        const ride = await this.getOwnedByDriver(rideId, driverId);
        if (ride.status !== "MATCHED")
            throw new common_1.BadRequestException("Statut invalide");
        if (pin && pin.trim() && pin.trim() !== rideSecurityPin(rideId)) {
            throw new common_1.BadRequestException("Code Bouclier AZƆ̀ incorrect. Demande les 4 chiffres affichés sur l'écran du client.");
        }
        // On vérifie le solde AVANT le départ : sinon la course se terminait avec un
        // client insolvable et le chauffeur n'était jamais payé.
        const clientWallet = await this.prisma.wallet.findUnique({ where: { userId: ride.clientId } });
        if (!clientWallet || clientWallet.balance < ride.price) {
            throw new common_1.BadRequestException("Le client n'a pas assez de solde AZƆ̀ Pay pour cette course");
        }
        const updated = await this.prisma.ride.update({ where: { id: rideId }, data: { status: "IN_PROGRESS" } });
        await this.notifications.push(ride.clientId, "Course démarrée", "Ton chauffeur est en route vers la destination.", "ride");
        this.gateway.emitStatus(rideId, "IN_PROGRESS");
        return updated;
    }
    getMessages(rideId) {
        return this.gateway.getMessages(rideId);
    }
    sendMessage(rideId, user, dto) {
        const role = dto.senderRole ?? (user.role === "DRIVER" ? "PROVIDER" : "CLIENT");
        const name = (dto.senderName || (role === "PROVIDER" ? "Prestataire AZƆ̀" : "Client AZƆ̀")).slice(0, 40);
        return this.gateway.addChatMessage(rideId, user.userId, role, name, dto.text);
    }
    // Fin de course : paiement + commission + revenus du chauffeur, en une transaction.
    // Commission : taux du niveau d'agence si le conducteur est rattaché à une flotte,
    // sinon règles du profil prestataire (config tarifaire).
    async complete(rideId, driverId) {
        const ride = await this.getOwnedByDriver(rideId, driverId);
        if (ride.status !== "IN_PROGRESS")
            throw new common_1.BadRequestException("La course n'est pas en cours");
        const driver = await this.prisma.user.findUnique({
            where: { id: driverId },
            include: { agency: true, provider: true },
        });
        // Une agence ne peut opérer qu'une fois ses frais d'activation payés.
        if (driver?.agency && !this.pricing.agencyCanOperate(driver.agency)) {
            throw new common_1.BadRequestException(`Agence non activée : les frais d'activation de la formule ${driver.agency.plan} ` +
                `(${this.pricing.agencyActivationFee(driver.agency.plan).toLocaleString("fr-FR")} FCFA, paiement unique) ` +
                "doivent être réglés avant toute course.");
        }
        const commission = this.pricing.rideCommission({
            profile: this.profileKeyOf(driver),
            agencyLevel: driver?.agency?.plan ?? null,
        }, ride.price);
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
    async cancel(rideId, userId) {
        const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
        if (!ride)
            throw new common_1.NotFoundException("Course introuvable");
        const isClient = ride.clientId === userId;
        const isDriver = ride.driverId === userId;
        if (!isClient && !isDriver)
            throw new common_1.ForbiddenException();
        if (ride.status !== "PENDING" && ride.status !== "MATCHED") {
            throw new common_1.BadRequestException("Cette course ne peut plus être annulée");
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
        }
        else {
            await this.notifications.push(ride.clientId, "Course annulée", "Ton chauffeur a annulé. Recherche d'un nouveau chauffeur…", "ride");
        }
        this.gateway.emitStatus(rideId, updated.status);
        return updated;
    }
    async rate(rideId, clientId, stars) {
        const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
        if (!ride || ride.clientId !== clientId)
            throw new common_1.ForbiddenException();
        return this.prisma.ride.update({ where: { id: rideId }, data: { rating: stars } });
    }
    // Détail d'une course (avec les infos du chauffeur ET du client) — lu par l'écran
    // de suivi côté client et par la fiche course côté chauffeur.
    async findOne(id, userId) {
        const ride = await this.prisma.ride.findUnique({
            where: { id },
            include: {
                driver: { select: { fullName: true, phone: true } },
                client: { select: { fullName: true, phone: true } },
            },
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
            include: {
                driver: { select: { fullName: true, phone: true } },
                client: { select: { fullName: true, phone: true } },
            },
            orderBy: { createdAt: "desc" },
        });
    }
    /** Profil prestataire (spec tarifaire) d'un conducteur, d'après son dossier et son véhicule. */
    profileKeyOf(driver) {
        if (!driver?.provider)
            return null;
        const type = String(driver.provider.type).toUpperCase();
        if (type === "COURIER")
            return "COURSIER";
        if (type === "DRIVER") {
            // Un conducteur de moto-taxi (gamme GAZELLE) sans agence est un Zem
            // indépendant : il paie 15 % de ses revenus du mois, pas par course.
            const gamme = driver.provider.vehicleType
                ? this.pricing.resolveGamme(driver.provider.vehicleType)
                : null;
            const hasAgency = !!driver.agencyId;
            return gamme === "GAZELLE" && !hasAgency ? "ZEM_INDEPENDANT" : null;
        }
        return null;
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
        pricing_module_1.PricingService,
        rides_gateway_1.RidesGateway])
], RidesService);
//# sourceMappingURL=rides.service.js.map