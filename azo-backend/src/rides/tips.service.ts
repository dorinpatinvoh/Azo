import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { PricingService } from "../pricing/pricing.module";
import { NotificationsService } from "../notifications/notifications.module";
import { buildDisplayName } from "./display-name";

@Injectable()
export class TipsService {
  constructor(
    private prisma: PrismaService,
    private pricing: PricingService,
    private notifications: NotificationsService,
  ) {}

  async sendTip(
    rideId: string,
    clientId: string,
    amount: number,
    idempotencyKey?: string
  ) {
    const settings = this.pricing.tipSettings();

    // Validation du montant (avant toute lecture DB)
    if (!Number.isInteger(amount) || amount < settings.minAmount || amount > settings.maxAmount) {
      throw new BadRequestException({
        code: "TIP_AMOUNT_INVALID",
        message: `Le montant du pourboire doit être un entier entre ${settings.minAmount} et ${settings.maxAmount} FCFA.`,
      });
    }

    // Idempotence : si la clé est connue, renvoyer le pourboire existant
    if (idempotencyKey) {
      const existing = await this.prisma.rideTip.findFirst({
        where: { clientId, rideId },
        select: { id: true, amount: true, createdAt: true },
      });
      if (existing) {
        const wallet = await this.prisma.wallet.findUnique({
          where: { userId: clientId },
          select: { balance: true },
        });
        return {
          rideId,
          tipId: existing.id,
          amount: existing.amount,
          balance: wallet?.balance ?? 0,
          at: existing.createdAt.toISOString(),
        };
      }
    }

    // Vérifier que la course appartient au client, est terminée avec un chauffeur
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      select: {
        clientId: true,
        driverId: true,
        status: true,
        completedAt: true,
        driver: {
          select: {
            firstName: true,
            lastName: true,
            fullName: true,
            agencyId: true,
          },
        },
        client: {
          select: { firstName: true, lastName: true, fullName: true },
        },
      },
    });

    if (!ride) throw new NotFoundException("Course introuvable");
    if (ride.clientId !== clientId) throw new ForbiddenException({ code: "FORBIDDEN", message: "Accès refusé." });
    if (ride.status !== "COMPLETED" || !ride.driverId) {
      throw new BadRequestException({ code: "RIDE_NOT_COMPLETED", message: "La course doit être terminée pour envoyer un pourboire." });
    }

    // Vérifier la fenêtre de temps
    if (ride.completedAt) {
      const windowEnd = new Date(ride.completedAt.getTime() + settings.windowHours * 60 * 60 * 1000);
      if (new Date() > windowEnd) {
        throw new BadRequestException({
          code: "TIP_WINDOW_CLOSED",
          message: `La fenêtre pour envoyer un pourboire (${settings.windowHours} h après la course) est fermée.`,
        });
      }
    }
    // Courses sans completedAt (antérieures à la migration) : non éligibles
    if (!ride.completedAt) {
      throw new BadRequestException({
        code: "TIP_WINDOW_CLOSED",
        message: "Cette course n'est pas éligible au pourboire.",
      });
    }

    // Limite de débit : maxPerHourPerClient pourboires par heure
    const recentTips = await this.prisma.rideTip.count({
      where: {
        clientId,
        createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });
    if (recentTips >= settings.maxPerHourPerClient) {
      throw new HttpException(
        { code: "TOO_MANY_REQUESTS", message: "Trop de pourboires envoyés. Réessaie dans une heure." },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    // Nom d'affichage du chauffeur et du client
    const { displayName: driverDisplayName } = buildDisplayName({
      firstName: ride.driver?.firstName,
      lastName: ride.driver?.lastName,
      fullName: ride.driver?.fullName,
    });
    const { displayName: clientDisplayName } = buildDisplayName({
      firstName: ride.client?.firstName,
      lastName: ride.client?.lastName,
      fullName: ride.client?.fullName,
    });

    const rideRef = `#${rideId.slice(0, 6)}`;
    const driverId = ride.driverId;

    // Transaction atomique
    let tipId: string;
    let newClientBalance: number;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Vérifier unicité du pourboire (contrainte @unique sur rideId)
        const existingTip = await tx.rideTip.findUnique({
          where: { rideId },
          select: { id: true, amount: true, createdAt: true },
        });
        if (existingTip) {
          throw new ConflictException({ code: "TIP_ALREADY_SENT", message: "Un pourboire a déjà été envoyé pour cette course." });
        }

        // Débit client (avec vérification de solde atomique)
        const clientWallet = await tx.wallet.upsert({
          where: { userId: clientId },
          create: { userId: clientId },
          update: {},
        });
        const debitResult = await tx.wallet.updateMany({
          where: { id: clientWallet.id, balance: { gte: amount } },
          data: { balance: { decrement: amount } },
        });
        if (debitResult.count === 0) {
          throw new BadRequestException({ code: "WALLET_INSUFFICIENT", message: "Solde insuffisant pour envoyer ce pourboire." });
        }

        // Crédit du Zem (pas de commission, 100 % reversé)
        const driverWallet = await tx.wallet.upsert({
          where: { userId: driverId },
          create: { userId: driverId },
          update: {},
        });
        await tx.wallet.update({
          where: { id: driverWallet.id },
          data: { balance: { increment: amount } },
        });

        // Transactions
        await tx.transaction.createMany({
          data: [
            {
              walletId: clientWallet.id,
              type: "DEBIT",
              amount,
              label: `Pourboire pour la course ${rideRef}`,
              labelKey: "TRANSACTION_TIP_SENT",
              labelParams: { ride: rideRef, driver: driverDisplayName ?? "Zem" },
              meta: `tip:${rideId}`,
              kind: "TIP",
            },
            {
              walletId: driverWallet.id,
              type: "CREDIT",
              amount,
              label: `Pourboire reçu pour la course ${rideRef}`,
              labelKey: "TRANSACTION_TIP_RECEIVED",
              labelParams: { ride: rideRef, client: clientDisplayName ?? "Client" },
              meta: `tip:${rideId}`,
              kind: "TIP",
            },
          ],
        });

        // Créer le RideTip
        const tip = await tx.rideTip.create({
          data: { rideId, clientId, driverId, amount },
        });

        // Lire le nouveau solde client
        const updatedClientWallet = await tx.wallet.findUnique({
          where: { id: clientWallet.id },
          select: { balance: true },
        });

        return { tipId: tip.id, balance: updatedClientWallet?.balance ?? 0 };
      });

      tipId = result.tipId;
      newClientBalance = result.balance;
    } catch (error) {
      // Re-throw ConflictException (TIP_ALREADY_SENT) directement
      if (error instanceof ConflictException || error instanceof BadRequestException) throw error;
      if ((error as any)?.code === "P2002") {
        throw new ConflictException({ code: "TIP_ALREADY_SENT", message: "Un pourboire a déjà été envoyé pour cette course." });
      }
      throw error;
    }

    // Notification au Zem
    await this.notifications
      .push(
        driverId,
        "Pourboire reçu",
        `${clientDisplayName ?? "Un client"} t'a envoyé un pourboire de ${amount} FCFA pour la course ${rideRef}.`,
        "payment",
        {
          sendPush: true,
          titleKey: "NOTIFICATION_TIP_RECEIVED",
          params: { amount, client: clientDisplayName ?? "Client" },
          data: { event: "tip-received", rideId },
        }
      )
      .catch(() => null);

    return {
      rideId,
      tipId,
      amount,
      balance: newClientBalance,
      at: new Date().toISOString(),
    };
  }

  async getTipForRide(rideId: string) {
    const tip = await this.prisma.rideTip.findUnique({
      where: { rideId },
      select: { amount: true, createdAt: true },
    });
    if (!tip) return null;
    return { amount: tip.amount, at: tip.createdAt.toISOString() };
  }
}
