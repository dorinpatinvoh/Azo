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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeliveryModule = exports.DeliveryController = exports.DeliveryService = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const current_user_decorator_1 = require("../common/decorators/current-user.decorator");
const wallet_module_1 = require("../wallet/wallet.module");
const notifications_module_1 = require("../notifications/notifications.module");
const pricing_module_1 = require("../pricing/pricing.module");
class CreateDeliveryDto {
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(30),
    __metadata("design:type", String)
], CreateDeliveryDto.prototype, "packageType", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], CreateDeliveryDto.prototype, "pickupAddress", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], CreateDeliveryDto.prototype, "dropAddress", void 0);
__decorate([
    (0, class_validator_1.IsEnum)(client_1.Payer),
    __metadata("design:type", String)
], CreateDeliveryDto.prototype, "payer", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(200),
    __metadata("design:type", Number)
], CreateDeliveryDto.prototype, "price", void 0);
class ConfirmCodeDto {
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(8),
    __metadata("design:type", String)
], ConfirmCodeDto.prototype, "code", void 0);
const code4 = () => Math.floor(1000 + Math.random() * 9000).toString();
let DeliveryService = class DeliveryService {
    constructor(prisma, wallet, notifications, pricing) {
        this.prisma = prisma;
        this.wallet = wallet;
        this.notifications = notifications;
        this.pricing = pricing;
    }
    async enrich(items) {
        const courierIds = Array.from(new Set(items.map((d) => d.courierId).filter((id) => !!id)));
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
            courier: d.courierId ? courierMap.get(d.courierId) ?? null : null,
        }));
    }
    // Double sécurité OTP : un code au ramassage, un code à la remise
    async create(clientId, dto) {
        if (dto.payer === "SENDER") {
            const w = await this.wallet.getWallet(clientId);
            if (w.balance < dto.price) {
                throw new common_1.BadRequestException(`Solde AZƆ̀ Pay insuffisant (${w.balance.toLocaleString("fr-FR")} F pour ${dto.price.toLocaleString("fr-FR")} F). Recharge ton portefeuille ou choisis « Par destinataire ».`);
            }
        }
        const created = await this.prisma.delivery.create({
            data: { ...dto, clientId, pickupCode: code4(), deliveryCode: code4() },
            include: { client: { select: { fullName: true, phone: true } } },
        });
        const [enriched] = await this.enrich([created]);
        return enriched;
    }
    // Livraisons du client connecté
    async list(clientId) {
        const items = await this.prisma.delivery.findMany({
            where: { clientId },
            include: { client: { select: { fullName: true, phone: true } } },
            orderBy: { createdAt: "desc" },
            take: 50,
        });
        return this.enrich(items);
    }
    // Missions disponibles pour les coursiers / livreurs (sans code secret exposé !)
    async pending() {
        const items = await this.prisma.delivery.findMany({
            where: { status: "PENDING", courierId: null },
            include: { client: { select: { fullName: true, phone: true } } },
            orderBy: { createdAt: "desc" },
            take: 40,
        });
        const enriched = await this.enrich(items);
        // Le coursier ne doit PAS voir les codes OTP : c'est le client/destinataire qui les lui donne.
        return enriched.map(({ pickupCode: _p, deliveryCode: _d, ...rest }) => ({
            ...rest,
            pickupCode: "••••",
            deliveryCode: "••••",
        }));
    }
    // Historique et mission active du coursier connecté
    async courierDeliveries(courierId) {
        const items = await this.prisma.delivery.findMany({
            where: { courierId },
            include: { client: { select: { fullName: true, phone: true } } },
            orderBy: { createdAt: "desc" },
            take: 50,
        });
        const enriched = await this.enrich(items);
        const isLiveSms = process.env.SMS_PROVIDER === "live";
        return enriched.map(({ pickupCode, deliveryCode, ...rest }) => ({
            ...rest,
            pickupCode: isLiveSms ? "••••" : pickupCode,
            deliveryCode: isLiveSms ? "••••" : deliveryCode,
        }));
    }
    // Acceptation atomique d'une mission par un coursier / livreur
    async accept(courierId, id) {
        const active = await this.prisma.delivery.findFirst({
            where: { courierId, status: { in: ["MATCHED", "IN_PROGRESS"] } },
        });
        if (active && active.id !== id) {
            throw new common_1.BadRequestException("Tu as déjà une livraison en cours. Termine-la avant d'en accepter une autre.");
        }
        const existing = await this.prisma.delivery.findUnique({ where: { id } });
        if (!existing)
            throw new common_1.NotFoundException("Mission de livraison introuvable");
        if (existing.clientId === courierId) {
            throw new common_1.BadRequestException("Tu ne peux pas accepter ta propre demande de livraison");
        }
        const updated = await this.prisma.delivery.updateMany({
            where: { id, status: "PENDING", courierId: null },
            data: { courierId, status: "MATCHED" },
        });
        if (updated.count === 0) {
            throw new common_1.BadRequestException("Cette mission vient d'être prise par un autre coursier ou a été annulée");
        }
        const fresh = await this.prisma.delivery.findUniqueOrThrow({
            where: { id },
            include: { client: { select: { fullName: true, phone: true } } },
        });
        await this.notifications.push(fresh.clientId, "Coursier en route 📦", `Un coursier AZƆ̀ a accepté ta livraison vers ${fresh.dropAddress}. Prépare le code de ramassage (${fresh.pickupCode}).`, "DELIVERY");
        const [enriched] = await this.enrich([fresh]);
        const isLiveSms = process.env.SMS_PROVIDER === "live";
        return isLiveSms
            ? { ...enriched, pickupCode: "••••", deliveryCode: "••••" }
            : enriched;
    }
    // Étape 1 : le coursier saisit le code de ramassage à 4 chiffres donné par l'expéditeur
    async confirmPickup(userId, id, code) {
        const d = await this.prisma.delivery.findUnique({
            where: { id },
            include: { client: { select: { fullName: true, phone: true } } },
        });
        if (!d)
            throw new common_1.NotFoundException("Livraison introuvable");
        if (d.courierId && d.courierId !== userId && d.clientId !== userId) {
            throw new common_1.ForbiddenException("Cette livraison est assignée à un autre coursier");
        }
        if (!["PENDING", "MATCHED"].includes(d.status)) {
            throw new common_1.BadRequestException("Cette livraison a déjà démarré ou est terminée");
        }
        if (d.pickupCode !== code.trim()) {
            throw new common_1.BadRequestException("Code de ramassage invalide : demande les 4 chiffres à l'expéditeur");
        }
        if (d.payer === "SENDER") {
            const clientWallet = await this.wallet.getWallet(d.clientId);
            if (clientWallet.balance < d.price) {
                throw new common_1.BadRequestException("Le solde AZƆ̀ Pay de l'expéditeur est insuffisant pour couvrir la livraison");
            }
        }
        const updated = await this.prisma.delivery.update({
            where: { id },
            data: { status: "IN_PROGRESS", courierId: d.courierId ?? userId },
            include: { client: { select: { fullName: true, phone: true } } },
        });
        await this.notifications.push(d.clientId, "Colis pris en charge ✅", `Le coursier a validé le code de ramassage et se dirige vers ${d.dropAddress}. Code de remise destinataire : ${d.deliveryCode}.`, "DELIVERY");
        const [enriched] = await this.enrich([updated]);
        const isLiveSms = process.env.SMS_PROVIDER === "live";
        return userId === d.clientId || !isLiveSms
            ? enriched
            : { ...enriched, pickupCode: "••••", deliveryCode: "••••" };
    }
    // Étape 2 : le coursier saisit le code de remise à 4 chiffres du destinataire -> paiement
    async confirmDelivery(userId, id, code) {
        const d = await this.prisma.delivery.findUnique({
            where: { id },
            include: { client: { select: { fullName: true, phone: true } } },
        });
        if (!d)
            throw new common_1.NotFoundException("Livraison introuvable");
        if (d.courierId && d.courierId !== userId && d.clientId !== userId) {
            throw new common_1.ForbiddenException("Cette livraison est assignée à un autre coursier");
        }
        if (d.status !== "IN_PROGRESS") {
            throw new common_1.BadRequestException("Valide d'abord le ramassage avant de confirmer la remise finale");
        }
        if (d.deliveryCode !== code.trim()) {
            throw new common_1.BadRequestException("Code de remise invalide : demande les 4 chiffres au destinataire");
        }
        const courierId = d.courierId ?? userId;
        const commission = this.pricing.deliveryCommission(d.price);
        const net = d.price - commission;
        if (d.payer === "SENDER" && courierId !== d.clientId) {
            await this.wallet.transfer(d.clientId, courierId, d.price, net, `Livraison colis (${d.dropAddress})`, `Gain livraison (${d.dropAddress})`, id);
        }
        else if (courierId !== d.clientId) {
            // Paiement par le destinataire : on crédite le gain net sur le wallet AZƆ̀ Pay du coursier
            await this.wallet.credit(courierId, net, `Gain livraison destinataire (${d.dropAddress})`, id);
        }
        const updated = await this.prisma.delivery.update({
            where: { id },
            data: { status: "COMPLETED", courierId },
            include: { client: { select: { fullName: true, phone: true } } },
        });
        // Incrémente le compteur de missions du dossier prestataire du coursier
        await this.prisma.providerProfile
            .updateMany({
            where: { userId: courierId },
            data: { jobsCompleted: { increment: 1 } },
        })
            .catch(() => undefined);
        await this.notifications.push(d.clientId, "Livraison terminée 🎉", `Ton colis à destination de ${d.dropAddress} a bien été remis avec le code OTP.`, "DELIVERY");
        const [enriched] = await this.enrich([updated]);
        return userId === d.clientId
            ? enriched
            : { ...enriched, pickupCode: "••••", deliveryCode: "••••" };
    }
    // Annulation par le client (PENDING / MATCHED) ou par le coursier (MATCHED -> retour en PENDING)
    async cancel(userId, id) {
        const d = await this.prisma.delivery.findUnique({ where: { id } });
        if (!d)
            throw new common_1.NotFoundException("Livraison introuvable");
        if (d.clientId === userId) {
            if (!["PENDING", "MATCHED"].includes(d.status)) {
                throw new common_1.BadRequestException("Impossible d'annuler : le colis est déjà en cours d'acheminement");
            }
            const updated = await this.prisma.delivery.update({
                where: { id },
                data: { status: "CANCELLED" },
                include: { client: { select: { fullName: true, phone: true } } },
            });
            if (d.courierId) {
                await this.notifications.push(d.courierId, "Livraison annulée", `Le client a annulé la livraison vers ${d.dropAddress}.`, "DELIVERY");
            }
            const [enriched] = await this.enrich([updated]);
            return enriched;
        }
        if (d.courierId === userId) {
            if (d.status !== "MATCHED") {
                throw new common_1.BadRequestException("Impossible d'annuler après avoir pris le colis en charge");
            }
            const updated = await this.prisma.delivery.update({
                where: { id },
                data: { status: "PENDING", courierId: null },
                include: { client: { select: { fullName: true, phone: true } } },
            });
            await this.notifications.push(d.clientId, "Recherche d'un nouveau coursier", "Le coursier a dû se désister. Ta livraison est reproposée aux coursiers disponibles.", "DELIVERY");
            const [enriched] = await this.enrich([updated]);
            return { ...enriched, pickupCode: "••••", deliveryCode: "••••" };
        }
        throw new common_1.ForbiddenException("Tu ne peux pas annuler cette livraison");
    }
};
exports.DeliveryService = DeliveryService;
exports.DeliveryService = DeliveryService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        wallet_module_1.WalletService,
        notifications_module_1.NotificationsService,
        pricing_module_1.PricingService])
], DeliveryService);
let DeliveryController = class DeliveryController {
    constructor(svc) {
        this.svc = svc;
    }
    create(u, dto) {
        return this.svc.create(u.userId, dto);
    }
    list(u) {
        return this.svc.list(u.userId);
    }
    pending() {
        return this.svc.pending();
    }
    courier(u) {
        return this.svc.courierDeliveries(u.userId);
    }
    accept(u, id) {
        return this.svc.accept(u.userId, id);
    }
    pickup(u, id, b) {
        return this.svc.confirmPickup(u.userId, id, b.code);
    }
    drop(u, id, b) {
        return this.svc.confirmDelivery(u.userId, id, b.code);
    }
    cancel(u, id) {
        return this.svc.cancel(u.userId, id);
    }
};
exports.DeliveryController = DeliveryController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, CreateDeliveryDto]),
    __metadata("design:returntype", void 0)
], DeliveryController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], DeliveryController.prototype, "list", null);
__decorate([
    (0, common_1.Get)("pending"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], DeliveryController.prototype, "pending", null);
__decorate([
    (0, common_1.Get)("courier"),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], DeliveryController.prototype, "courier", null);
__decorate([
    (0, common_1.Post)(":id/accept"),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], DeliveryController.prototype, "accept", null);
__decorate([
    (0, common_1.Post)(":id/confirm-pickup"),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, ConfirmCodeDto]),
    __metadata("design:returntype", void 0)
], DeliveryController.prototype, "pickup", null);
__decorate([
    (0, common_1.Post)(":id/confirm-delivery"),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, ConfirmCodeDto]),
    __metadata("design:returntype", void 0)
], DeliveryController.prototype, "drop", null);
__decorate([
    (0, common_1.Post)(":id/cancel"),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], DeliveryController.prototype, "cancel", null);
exports.DeliveryController = DeliveryController = __decorate([
    (0, common_1.Controller)("deliveries"),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [DeliveryService])
], DeliveryController);
let DeliveryModule = class DeliveryModule {
};
exports.DeliveryModule = DeliveryModule;
exports.DeliveryModule = DeliveryModule = __decorate([
    (0, common_1.Module)({
        imports: [wallet_module_1.WalletModule, notifications_module_1.NotificationsModule, pricing_module_1.PricingModule],
        controllers: [DeliveryController],
        providers: [DeliveryService],
    })
], DeliveryModule);
//# sourceMappingURL=delivery.module.js.map