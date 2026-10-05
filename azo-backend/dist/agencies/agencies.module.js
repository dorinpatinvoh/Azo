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
exports.AgenciesModule = exports.AgenciesController = exports.AgenciesService = exports.PLAN_LABELS = exports.PLANS = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const current_user_decorator_1 = require("../common/decorators/current-user.decorator");
const notifications_module_1 = require("../notifications/notifications.module");
const pricing_module_1 = require("../pricing/pricing.module");
const wallet_module_1 = require("../wallet/wallet.module");
const plans_1 = require("./plans");
Object.defineProperty(exports, "PLANS", { enumerable: true, get: function () { return plans_1.PLANS; } });
Object.defineProperty(exports, "PLAN_LABELS", { enumerable: true, get: function () { return plans_1.PLAN_LABELS; } });
const phone_1 = require("../common/phone");
class AttachDriverDto {
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(20),
    __metadata("design:type", String)
], AttachDriverDto.prototype, "phone", void 0);
let AgenciesService = class AgenciesService {
    constructor(prisma, notifications, pricing, wallet) {
        this.prisma = prisma;
        this.notifications = notifications;
        this.pricing = pricing;
        this.wallet = wallet;
    }
    async ownerAgency(ownerId) {
        const owner = await this.prisma.user.findUnique({
            where: { id: ownerId },
            include: { agency: { include: { drivers: true } } },
        });
        if (!owner)
            throw new common_1.NotFoundException("Compte introuvable");
        if (!owner.agency)
            throw new common_1.BadRequestException("Aucune agence liée à ce compte : une agence est créée à la validation de son dossier prestataire");
        return owner.agency;
    }
    // Rattachement d'un chauffeur À UNE FLOTTE.
    // L'ancien comportement changeait le rôle de n'importe quel numéro en DRIVER, sans
    // son consentement et sans aucune vérification. Désormais :
    //   - le chauffeur doit exister et avoir un dossier APPROUVÉ de type DRIVER,
    //   - il ne doit pas déjà appartenir à une autre agence,
    //   - le plafond de comptes de la formule est respecté,
    //   - il est notifié, et le rattachement est réversible (DELETE) et journalisé.
    async attachDriver(ownerId, phone) {
        const agency = await this.ownerAgency(ownerId);
        // Une agence ne peut opérer qu'une fois activée (frais d'activation uniques payés).
        if (!this.pricing.agencyCanOperate(agency))
            throw new common_1.BadRequestException(`Agence non activée : règle d'abord les frais d'activation de la formule ${plans_1.PLAN_LABELS[agency.plan]} ` +
                `(${this.pricing.agencyActivationFee(agency.plan).toLocaleString("fr-FR")} FCFA, paiement unique) ` +
                "pour gérer des comptes.");
        // Plafond de comptes du niveau (PRO 25 … DIAMANT 1 000) : toute création au-delà est refusée.
        if (!this.pricing.canAgencyAddAccount(agency.plan, agency.drivers.length))
            throw new common_1.BadRequestException(`Limite de comptes atteinte pour ${plans_1.PLAN_LABELS[agency.plan]} ` +
                `(${this.pricing.agencyMaxAccounts(agency.plan)} comptes maximum). ` +
                "Passe au niveau supérieur pour ajouter des chauffeurs.");
        const normalized = (0, phone_1.normalizeBeninPhone)(phone);
        const variants = (0, phone_1.beninPhoneVariants)(phone);
        const driver = await this.prisma.user.findFirst({
            where: { phone: { in: variants } },
            include: { provider: true },
        });
        if (!driver)
            throw new common_1.NotFoundException(`Aucun compte AZƆ̀ pour le ${normalized} : ce conducteur ou coursier doit d'abord s'inscrire`);
        if (!driver.provider ||
            driver.provider.status !== "APPROVED" ||
            !["DRIVER", "COURIER"].includes(driver.provider.type))
            throw new common_1.BadRequestException("Ce compte n'a pas de dossier conducteur ou coursier validé par AZƆ̀ : il doit déposer un dossier prestataire et être approuvé");
        if (driver.agencyId === agency.id)
            throw new common_1.BadRequestException("Ce chauffeur fait déjà partie de ton agence");
        if (driver.agencyId)
            throw new common_1.BadRequestException("Ce chauffeur est déjà rattaché à une autre agence");
        const [updated] = await this.prisma.$transaction([
            this.prisma.user.update({ where: { id: driver.id }, data: { agencyId: agency.id } }),
            this.prisma.providerProfile.update({ where: { id: driver.provider.id }, data: { agencyId: agency.id } }),
            this.prisma.providerEvent.create({
                data: {
                    providerId: driver.provider.id,
                    actorId: ownerId,
                    type: "AGENCY_ATTACHED",
                    comment: `Rattaché à l'agence ${agency.name}`,
                },
            }),
        ]);
        await this.notifications.push(driver.id, "Rattachement à une agence", `Tu as été rattaché à l'agence ${agency.name} (formule ${plans_1.PLAN_LABELS[agency.plan]}).`, "AGENCY");
        return { driver: { id: updated.id, phone: updated.phone, fullName: updated.fullName }, agencyId: agency.id };
    }
    async detachDriver(ownerId, driverId) {
        const agency = await this.ownerAgency(ownerId);
        const driver = await this.prisma.user.findUnique({
            where: { id: driverId },
            include: { provider: true },
        });
        if (!driver || driver.agencyId !== agency.id)
            throw new common_1.NotFoundException("Ce chauffeur ne fait pas partie de ton agence");
        await this.prisma.$transaction([
            this.prisma.user.update({ where: { id: driverId }, data: { agencyId: null } }),
            ...(driver.provider
                ? [
                    this.prisma.providerProfile.update({ where: { id: driver.provider.id }, data: { agencyId: null } }),
                    this.prisma.providerEvent.create({
                        data: {
                            providerId: driver.provider.id,
                            actorId: ownerId,
                            type: "AGENCY_DETACHED",
                            comment: `Retiré de l'agence ${agency.name}`,
                        },
                    }),
                ]
                : []),
        ]);
        await this.notifications.push(driverId, "Fin du rattachement à une agence", `Tu ne fais plus partie de l'agence ${agency.name}. Tu redeviens indépendant.`, "AGENCY");
        return { detached: driverId, agencyId: agency.id };
    }
    /**
     * Activation de l'agence : paiement UNIQUE et non récurrent des frais du niveau.
     * Tant qu'il n'est pas réglé, l'agence ne peut ni gérer de comptes ni opérer.
     */
    async activate(ownerId) {
        const agency = await this.ownerAgency(ownerId);
        if (agency.feePaidAt)
            throw new common_1.BadRequestException(`Agence déjà activée le ${new Date(agency.feePaidAt).toLocaleDateString("fr-FR")} : ` +
                "l'activation est un paiement unique, non récurrent.");
        const fee = this.pricing.agencyActivationFee(agency.plan);
        const wallet = await this.wallet.getWallet(ownerId);
        if (wallet.balance < fee)
            throw new common_1.BadRequestException(`Solde AZƆ̀ Pay insuffisant : ${fee.toLocaleString("fr-FR")} FCFA requis pour activer ` +
                `${plans_1.PLAN_LABELS[agency.plan]} (solde : ${wallet.balance.toLocaleString("fr-FR")} FCFA). Recharge ton portefeuille.`);
        // Débit du wallet et activation dans LA MÊME transaction (aucun débit orphelin).
        const [, , updated] = await this.prisma.$transaction([
            this.prisma.wallet.update({
                where: { id: wallet.id },
                data: { balance: { decrement: fee } },
            }),
            this.prisma.transaction.create({
                data: {
                    walletId: wallet.id,
                    type: "DEBIT",
                    amount: fee,
                    label: `Activation agence ${plans_1.PLAN_LABELS[agency.plan]}`,
                    meta: `Paiement unique — ${agency.name}`,
                },
            }),
            this.prisma.agency.update({
                where: { id: agency.id },
                data: { feePaidAt: new Date(), activationFee: fee },
            }),
        ]);
        await this.notifications.push(ownerId, "Agence activée ✅", `${agency.name} est active (${plans_1.PLAN_LABELS[agency.plan]} · ${this.pricing.agencyMaxAccounts(agency.plan)} comptes · ` +
            `commission ${this.pricing.getAgencyLevel(agency.plan).commissionPct} %).`, "AGENCY");
        return {
            agencyId: updated.id,
            plan: updated.plan,
            activationFee: updated.activationFee,
            feePaidAt: updated.feePaidAt,
            canOperate: this.pricing.agencyCanOperate(updated),
        };
    }
    // Tableau de bord de l'agence : chiffres réels (l'écran mobile était une maquette).
    async dashboard(ownerId) {
        const agency = await this.ownerAgency(ownerId);
        const driverIds = agency.drivers.map((d) => d.id);
        const [completedRides, activeRides, ratings] = await Promise.all([
            this.prisma.ride.findMany({
                where: { driverId: { in: driverIds }, status: "COMPLETED" },
                select: { price: true, commission: true, rating: true, driverId: true },
            }),
            this.prisma.ride.findMany({
                where: { driverId: { in: driverIds }, status: { in: ["PENDING", "MATCHED", "IN_PROGRESS"] } },
                select: { driverId: true, status: true },
            }),
            this.prisma.providerProfile.findMany({
                where: { agencyId: agency.id },
                select: { userId: true, rating: true, jobsCompleted: true },
            }),
        ]);
        const formula = plans_1.PLANS[agency.plan];
        const gross = completedRides.reduce((s, r) => s + r.price, 0);
        const commissions = completedRides.reduce((s, r) => s + r.commission, 0);
        const rated = completedRides.filter((r) => typeof r.rating === "number" && r.rating > 0);
        return {
            agency: {
                id: agency.id,
                name: agency.name,
                plan: agency.plan,
                planLabel: plans_1.PLAN_LABELS[agency.plan],
                commissionRate: agency.commissionRate,
                maxAccounts: agency.maxAccounts,
                activationFee: agency.activationFee,
                feePaidAt: agency.feePaidAt,
                createdAt: agency.createdAt,
            },
            // Champs conservés pour ne pas casser les appels existants
            drivers: agency.drivers.length,
            completedRides: completedRides.length,
            netRevenue: gross - commissions,
            // Détail ajouté
            grossRevenue: gross,
            commissionsPaid: commissions,
            averageRating: rated.length
                ? Math.round((rated.reduce((s, r) => s + r.rating, 0) / rated.length) * 100) / 100
                : null,
            seatsUsed: agency.drivers.length,
            seatsTotal: formula.maxAccounts,
            commissionPct: this.pricing.getAgencyLevel(agency.plan).commissionPct,
            withdrawalFeePct: this.pricing.getAgencyLevel(agency.plan).withdrawalFeePct,
            activationFee: agency.activationFee,
            feePaidAt: agency.feePaidAt,
            activated: this.pricing.agencyCanOperate(agency),
            activeRides: activeRides.length,
            roster: agency.drivers.map((d) => {
                const profile = ratings.find((r) => r.userId === d.id);
                const active = activeRides.filter((r) => r.driverId === d.id).length;
                return {
                    id: d.id,
                    fullName: d.fullName,
                    phone: d.phone,
                    status: d.status,
                    activeRides: active,
                    state: active > 0 ? "EN_COURSE" : "DISPONIBLE",
                    rating: profile?.rating ?? 0,
                    jobsCompleted: profile?.jobsCompleted ?? 0,
                };
            }),
        };
    }
};
exports.AgenciesService = AgenciesService;
exports.AgenciesService = AgenciesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        notifications_module_1.NotificationsService,
        pricing_module_1.PricingService,
        wallet_module_1.WalletService])
], AgenciesService);
// NOTE : la création d'une agence ne passe plus par POST /agencies.
// Elle est produite par l'approbation du dossier prestataire de type AGENCY
// (POST /admin/providers/:id/decision), ce qui garantit qu'un administrateur a
// vérifié l'identité et les pièces avant qu'une flotte n'existe.
let AgenciesController = class AgenciesController {
    constructor(svc) {
        this.svc = svc;
    }
    // POST /agencies/drivers  { "phone": "97000042" }
    attachDriver(u, dto) {
        return this.svc.attachDriver(u.userId, dto.phone);
    }
    // DELETE /agencies/drivers/:userId
    detachDriver(u, userId) {
        return this.svc.detachDriver(u.userId, userId);
    }
    // POST /agencies/activate — paie les frais d'activation (une seule fois) du niveau choisi
    activate(u) {
        return this.svc.activate(u.userId);
    }
    // GET /agencies/dashboard
    dashboard(u) {
        return this.svc.dashboard(u.userId);
    }
};
exports.AgenciesController = AgenciesController;
__decorate([
    (0, common_1.Post)("drivers"),
    (0, roles_decorator_1.Roles)(client_1.Role.AGENCY),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, AttachDriverDto]),
    __metadata("design:returntype", void 0)
], AgenciesController.prototype, "attachDriver", null);
__decorate([
    (0, common_1.Delete)("drivers/:userId"),
    (0, roles_decorator_1.Roles)(client_1.Role.AGENCY),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("userId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AgenciesController.prototype, "detachDriver", null);
__decorate([
    (0, common_1.Post)("activate"),
    (0, roles_decorator_1.Roles)(client_1.Role.AGENCY),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AgenciesController.prototype, "activate", null);
__decorate([
    (0, common_1.Get)("dashboard"),
    (0, roles_decorator_1.Roles)(client_1.Role.AGENCY),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AgenciesController.prototype, "dashboard", null);
exports.AgenciesController = AgenciesController = __decorate([
    (0, common_1.Controller)("agencies"),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    __metadata("design:paramtypes", [AgenciesService])
], AgenciesController);
let AgenciesModule = class AgenciesModule {
};
exports.AgenciesModule = AgenciesModule;
exports.AgenciesModule = AgenciesModule = __decorate([
    (0, common_1.Module)({
        imports: [notifications_module_1.NotificationsModule, pricing_module_1.PricingModule, wallet_module_1.WalletModule],
        controllers: [AgenciesController],
        providers: [AgenciesService],
    })
], AgenciesModule);
//# sourceMappingURL=agencies.module.js.map