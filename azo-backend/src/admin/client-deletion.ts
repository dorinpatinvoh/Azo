import { BadRequestException, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

const logger = new Logger("ClientDeletion");

export type ClientDeletionResult = {
  userId: string;
  /** « deleted » : le compte et ses données sont effacés ; « anonymized » : l'historique financier est gardé, les données personnelles effacées. */
  mode: "deleted" | "anonymized";
  /** Commercial supprimé : nombre de prestataires qu'il avait recrutés, désormais sans commercial. */
  detachedReferrals?: number;
};

/**
 * Suppression d'un compte CLIENT ou COMMERCIAL par un administrateur.
 *
 * Un commercial est supprimé comme un client ; en plus, son profil de parrain (et son code) disparaît et les prestataires
 * qu'il avait recrutés restent en place, simplement sans commercial rattaché.
 *
 * Refusée pour : son propre compte, tout compte qui n'est ni un client simple ni un commercial (prestataire, agence,
 * administrateur), un client dont une course ou une livraison est en cours, un client dont le portefeuille n'est pas à zéro
 * (il faut d'abord solder l'argent qui lui appartient, ou passer `settleBalance` : le solde est alors remis à zéro par une
 * écriture visible dans l'historique conservé, et le compte est anonymisé).
 *
 * Un client qui n'a jamais rien commandé ni payé est effacé pour de bon. Un client qui a un historique (courses,
 * livraisons, mouvements d'argent) est ANONYMISÉ : les écritures comptables restent, mais son nom, son numéro, son NPI et
 * ses appareils disparaissent et le numéro redevient libre pour une nouvelle inscription.
 */
export async function deleteClientAccount(
  prisma: PrismaService,
  adminId: string,
  userId: string,
  options: { settleBalance?: boolean } = {}
): Promise<ClientDeletionResult> {
  if (adminId === userId) throw new BadRequestException("Tu ne peux pas supprimer ton propre compte.");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { provider: { select: { id: true } }, referrerProfile: { select: { id: true, _count: { select: { referrals: true } } } }, wallet: { select: { id: true, balance: true } } },
  });
  if (!user) throw new NotFoundException("Utilisateur introuvable");
  if (user.role !== "CLIENT" || user.provider || user.agencyId)
    throw new BadRequestException("Seul un client ou un commercial peut être supprimé ici (pas un prestataire, une agence ou un administrateur).");
  const referrer = user.referrerProfile;
  // Commercial : ses filleuls sont détachés, puis son profil de parrain est supprimé (avant le compte, clé étrangère)
  const dropReferrer = referrer
    ? [
        prisma.user.updateMany({ where: { referrerId: referrer.id }, data: { referrerId: null, referredAt: null } }),
        prisma.referrer.delete({ where: { id: referrer.id } }),
      ]
    : [];
  const detachedReferrals = referrer?._count.referrals;
  const settle = !!options.settleBalance && !!user.wallet && user.wallet.balance !== 0;
  if (user.wallet && user.wallet.balance !== 0 && !settle)
    throw new BadRequestException(
      `Le portefeuille de ce client contient ${user.wallet.balance.toLocaleString("fr-FR")} FCFA : règle d'abord cet argent avant de supprimer le compte.`
    );

  const open = { in: ["PENDING", "OFFERED", "MATCHED", "ARRIVED", "IN_PROGRESS"] as ("PENDING" | "OFFERED" | "MATCHED" | "ARRIVED" | "IN_PROGRESS")[] };
  const [openRides, openDeliveries] = await Promise.all([
    prisma.ride.count({ where: { clientId: userId, status: open } }),
    prisma.delivery.count({ where: { clientId: userId, status: open } }),
  ]);
  if (openRides + openDeliveries > 0)
    throw new BadRequestException("Ce client a une course ou une livraison en cours : attends qu'elle soit terminée ou annulée.");

  const [rides, deliveries, rentals, orders, artisans, tips, movements] = await Promise.all([
    prisma.ride.count({ where: { clientId: userId } }),
    prisma.delivery.count({ where: { clientId: userId } }),
    prisma.rentalBooking.count({ where: { clientId: userId } }),
    prisma.marketplaceOrder.count({ where: { clientId: userId } }),
    prisma.artisanRequest.count({ where: { clientId: userId } }),
    prisma.rideTip.count({ where: { clientId: userId } }),
    user.wallet ? prisma.transaction.count({ where: { walletId: user.wallet.id, status: { not: "PENDING" } } }) : Promise.resolve(0),
  ]);
  const hasHistory = settle || rides + deliveries + rentals + orders + artisans + tips + movements > 0;

  // Données personnelles et techniques : effacées dans les deux cas
  const wipePersonal = [
    prisma.userAvatar.deleteMany({ where: { userId } }),
    prisma.devicePushToken.deleteMany({ where: { userId } }),
    prisma.notification.deleteMany({ where: { userId } }),
    prisma.savedPlace.deleteMany({ where: { userId } }),
    prisma.npiRegistrationAttempt.deleteMany({ where: { userId } }),
    prisma.phoneChangeRequest.deleteMany({ where: { userId } }),
    prisma.identityCorrectionRequest.deleteMany({ where: { userId } }),
    prisma.userProfileChange.deleteMany({ where: { userId } }),
    prisma.otpCode.deleteMany({ where: { phone: user.phone } }),
  ];

  if (hasHistory) {
    const settleOps =
      settle && user.wallet
        ? [
            prisma.transaction.create({
              data: {
                walletId: user.wallet.id,
                type: user.wallet.balance > 0 ? "DEBIT" : "CREDIT",
                amount: Math.abs(user.wallet.balance),
                label: "Solde remis à zéro à la suppression du compte",
                meta: `Suppression par ${adminId}`,
              },
            }),
            prisma.wallet.update({ where: { id: user.wallet.id }, data: { balance: 0 } }),
          ]
        : [];
    await prisma.$transaction([
      ...settleOps,
      ...dropReferrer,
      ...wipePersonal,
      prisma.user.update({
        where: { id: userId },
        data: {
          phone: `supprime-${userId}`,
          fullName: "Compte supprimé",
          firstName: null,
          lastName: null,
          gender: null,
          email: null,
          npiHash: null,
          npiCipher: null,
          npiLast4: null,
          emergencyContactName: null,
          emergencyContactPhone: null,
          passwordHash: null,
          status: "BLOCKED",
        },
      }),
    ]);
    logger.warn(`Compte client ${userId} anonymisé par l'administrateur ${adminId} (historique conservé)`);
    return { userId, mode: "anonymized", detachedReferrals };
  }

  await prisma.$transaction([
    ...dropReferrer,
    ...wipePersonal,
    ...(user.wallet ? [prisma.transaction.deleteMany({ where: { walletId: user.wallet.id } }), prisma.wallet.delete({ where: { id: user.wallet.id } })] : []),
    prisma.user.delete({ where: { id: userId } }),
  ]);
  logger.warn(`Compte client ${userId} supprimé par l'administrateur ${adminId}`);
  return { userId, mode: "deleted", detachedReferrals };
}
