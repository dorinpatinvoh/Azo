import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { IsString, MaxLength } from "class-validator";
import { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { NotificationsModule, NotificationsService } from "../notifications/notifications.module";
import { PricingModule, PricingService } from "../pricing/pricing.module";
import { WalletModule, WalletService } from "../wallet/wallet.module";
import { PLANS, PLAN_LABELS } from "./plans";
import { beninPhoneVariants, normalizeBeninPhone } from "../common/phone";

// Les formules (tarif, plafond de comptes, commission) vivent dans ./plans :
// le module Prestataires s'en sert aussi pour créer l'agence à l'approbation du dossier.
export { PLANS, PLAN_LABELS };

class AttachDriverDto {
  @IsString() @MaxLength(20) phone: string;
}

@Injectable()
export class AgenciesService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private pricing: PricingService,
    private wallet: WalletService
  ) {}

  private async ownerAgency(ownerId: string) {
    const owner = await this.prisma.user.findUnique({
      where: { id: ownerId },
      include: { agency: { include: { drivers: true } } },
    });
    if (!owner) throw new NotFoundException("Compte introuvable");
    if (!owner.agency)
      throw new BadRequestException(
        "Aucune agence liée à ce compte : une agence est créée à la validation de son dossier prestataire"
      );
    return owner.agency;
  }

  // Rattachement d'un chauffeur À UNE FLOTTE.
  // L'ancien comportement changeait le rôle de n'importe quel numéro en DRIVER, sans
  // son consentement et sans aucune vérification. Désormais :
  //   - le chauffeur doit exister et avoir un dossier APPROUVÉ de type DRIVER,
  //   - il ne doit pas déjà appartenir à une autre agence,
  //   - le plafond de comptes de la formule est respecté,
  //   - il est notifié, et le rattachement est réversible (DELETE) et journalisé.
  async attachDriver(ownerId: string, phone: string) {
    const agency = await this.ownerAgency(ownerId);

    // Une agence ne peut opérer qu'une fois activée (frais d'activation uniques payés).
    if (!this.pricing.agencyCanOperate(agency))
      throw new BadRequestException(
        `Agence non activée : règle d'abord les frais d'activation de la formule ${PLAN_LABELS[agency.plan]} ` +
          `(${this.pricing.agencyActivationFee(agency.plan).toLocaleString("fr-FR")} FCFA, paiement unique) ` +
          "pour gérer des comptes."
      );

    // Plafond de comptes du niveau (PRO 25 … DIAMANT 1 000) : toute création au-delà est refusée.
    if (!this.pricing.canAgencyAddAccount(agency.plan, agency.drivers.length))
      throw new BadRequestException(
        `Limite de comptes atteinte pour ${PLAN_LABELS[agency.plan]} ` +
          `(${this.pricing.agencyMaxAccounts(agency.plan)} comptes maximum). ` +
          "Passe au niveau supérieur pour ajouter des chauffeurs."
      );

    const normalized = normalizeBeninPhone(phone);
    const variants = beninPhoneVariants(phone);
    const driver = await this.prisma.user.findFirst({
      where: { phone: { in: variants } },
      include: { provider: true },
    });
    if (!driver)
      throw new NotFoundException(
        `Aucun compte AZƆ̀ pour le ${normalized} : ce conducteur ou coursier doit d'abord s'inscrire`
      );
    if (
      !driver.provider ||
      driver.provider.status !== "APPROVED" ||
      !["DRIVER", "COURIER"].includes(driver.provider.type)
    )
      throw new BadRequestException(
        "Ce compte n'a pas de dossier conducteur ou coursier validé par AZƆ̀ : il doit déposer un dossier prestataire et être approuvé"
      );
    if (driver.agencyId === agency.id)
      throw new BadRequestException("Ce chauffeur fait déjà partie de ton agence");
    if (driver.agencyId)
      throw new BadRequestException("Ce chauffeur est déjà rattaché à une autre agence");

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

    await this.notifications.push(
      driver.id,
      "Rattachement à une agence",
      `Tu as été rattaché à l'agence ${agency.name} (formule ${PLAN_LABELS[agency.plan]}).`,
      "AGENCY"
    );
    return { driver: { id: updated.id, phone: updated.phone, fullName: updated.fullName }, agencyId: agency.id };
  }

  async detachDriver(ownerId: string, driverId: string) {
    const agency = await this.ownerAgency(ownerId);
    const driver = await this.prisma.user.findUnique({
      where: { id: driverId },
      include: { provider: true },
    });
    if (!driver || driver.agencyId !== agency.id)
      throw new NotFoundException("Ce chauffeur ne fait pas partie de ton agence");

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

    await this.notifications.push(
      driverId,
      "Fin du rattachement à une agence",
      `Tu ne fais plus partie de l'agence ${agency.name}. Tu redeviens indépendant.`,
      "AGENCY"
    );
    return { detached: driverId, agencyId: agency.id };
  }

  /**
   * Activation de l'agence : paiement UNIQUE et non récurrent des frais du niveau.
   * Tant qu'il n'est pas réglé, l'agence ne peut ni gérer de comptes ni opérer.
   */
  async activate(ownerId: string) {
    const agency = await this.ownerAgency(ownerId);
    if (agency.feePaidAt)
      throw new BadRequestException(
        `Agence déjà activée le ${new Date(agency.feePaidAt).toLocaleDateString("fr-FR")} : ` +
          "l'activation est un paiement unique, non récurrent."
      );

    const fee = this.pricing.agencyActivationFee(agency.plan);
    const wallet = await this.wallet.getWallet(ownerId);

    if (wallet.balance < fee)
      throw new BadRequestException(
        `Solde AZƆ̀ Pay insuffisant : ${fee.toLocaleString("fr-FR")} FCFA requis pour activer ` +
          `${PLAN_LABELS[agency.plan]} (solde : ${wallet.balance.toLocaleString("fr-FR")} FCFA). Recharge ton portefeuille.`
      );

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
          label: `Activation agence ${PLAN_LABELS[agency.plan]}`,
          meta: `Paiement unique — ${agency.name}`,
        },
      }),
      this.prisma.agency.update({
        where: { id: agency.id },
        data: { feePaidAt: new Date(), activationFee: fee },
      }),
    ]);

    await this.notifications.push(
      ownerId,
      "Agence activée ✅",
      `${agency.name} est active (${PLAN_LABELS[agency.plan]} · ${this.pricing.agencyMaxAccounts(agency.plan)} comptes · ` +
        `commission ${this.pricing.getAgencyLevel(agency.plan).commissionPct} %).`,
      "AGENCY"
    );

    return {
      agencyId: updated.id,
      plan: updated.plan,
      activationFee: updated.activationFee,
      feePaidAt: updated.feePaidAt,
      canOperate: this.pricing.agencyCanOperate(updated),
    };
  }

  // Tableau de bord de l'agence : chiffres réels (l'écran mobile était une maquette).
  async dashboard(ownerId: string) {
    const agency = await this.ownerAgency(ownerId);
    const driverIds = agency.drivers.map((d) => d.id);

    const [completedRides, activeRides, ratings] = await Promise.all([
      this.prisma.ride.findMany({
        where: { driverId: { in: driverIds }, status: "COMPLETED" },
        select: { price: true, commission: true, rating: true, driverId: true },
      }),
      this.prisma.ride.findMany({
        where: { driverId: { in: driverIds }, status: { in: ["PENDING", "MATCHED", "ARRIVED", "IN_PROGRESS"] } },
        select: { driverId: true, status: true },
      }),
      this.prisma.providerProfile.findMany({
        where: { agencyId: agency.id },
        select: { userId: true, rating: true, jobsCompleted: true },
      }),
    ]);

    const formula = PLANS[agency.plan];
    const gross = completedRides.reduce((s, r) => s + r.price, 0);
    const commissions = completedRides.reduce((s, r) => s + r.commission, 0);
    const rated = completedRides.filter((r) => typeof r.rating === "number" && r.rating > 0);

    return {
      agency: {
        id: agency.id,
        name: agency.name,
        plan: agency.plan,
        planLabel: PLAN_LABELS[agency.plan],
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
        ? Math.round((rated.reduce((s, r) => s + (r.rating as number), 0) / rated.length) * 100) / 100
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
}

// NOTE : la création d'une agence ne passe plus par POST /agencies.
// Elle est produite par l'approbation du dossier prestataire de type AGENCY
// (POST /admin/providers/:id/decision), ce qui garantit qu'un administrateur a
// vérifié l'identité et les pièces avant qu'une flotte n'existe.
@Controller("agencies")
@UseGuards(JwtAuthGuard, RolesGuard)
export class AgenciesController {
  constructor(private svc: AgenciesService) {}

  // POST /agencies/drivers  { "phone": "97000042" }
  @Post("drivers")
  @Roles(Role.AGENCY)
  attachDriver(@CurrentUser() u, @Body() dto: AttachDriverDto) {
    return this.svc.attachDriver(u.userId, dto.phone);
  }

  // DELETE /agencies/drivers/:userId
  @Delete("drivers/:userId")
  @Roles(Role.AGENCY)
  detachDriver(@CurrentUser() u, @Param("userId") userId: string) {
    return this.svc.detachDriver(u.userId, userId);
  }

  // POST /agencies/activate — paie les frais d'activation (une seule fois) du niveau choisi
  @Post("activate")
  @Roles(Role.AGENCY)
  activate(@CurrentUser() u) {
    return this.svc.activate(u.userId);
  }

  // GET /agencies/dashboard
  @Get("dashboard")
  @Roles(Role.AGENCY)
  dashboard(@CurrentUser() u) {
    return this.svc.dashboard(u.userId);
  }
}

@Module({
  imports: [NotificationsModule, PricingModule, WalletModule],
  controllers: [AgenciesController],
  providers: [AgenciesService],
})
export class AgenciesModule {}
