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
 * Suppression d'un compte utilisateur par un administrateur : client, commercial, prestataire (Speeder, livreur, coursier,
 * artisan), agence, ou autre administrateur.
 *
 * - Un commercial perd son profil de parrain (et son code) ; les prestataires qu'il avait recrutés restent en place, sans commercial.
 * - Un prestataire ou une agence : son dossier, ses pièces et son journal disparaissent (suppression), ou sont vidés de
 *   leurs données personnelles (anonymisation) si le compte a un historique. Une agence supprimée ne supprime pas ses
 *   conducteurs : ils restent rattachés à la structure.
 * - Un administrateur : le compte perd ses droits (anonymisé en simple client bloqué) ou disparaît.
 *
 * Refusée pour : son propre compte, le dernier administrateur actif (sinon plus personne ne pourrait gérer la plateforme),
 * un compte dont une course ou une livraison est en cours (comme client ou comme conducteur), un compte dont le portefeuille
 * n'est pas à zéro (il faut d'abord solder l'argent qui lui appartient, ou passer `settleBalance` : le solde est alors remis
 * à zéro par une écriture visible dans l'historique conservé, et le compte est anonymisé).
 *
 * Un compte qui n'a jamais rien commandé, conduit ni payé est effacé pour de bon. Un compte qui a un historique (courses,
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
  if (user.role === "ADMIN") {
    const otherAdmins = await prisma.user.count({ where: { role: "ADMIN", status: "ACTIVE", id: { not: userId } } });
    if (otherAdmins === 0) throw new BadRequestException("C'est le dernier administrateur actif : crée-en un autre avant de supprimer ce compte.");
  }
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
      `Le portefeuille de ce compte contient ${user.wallet.balance.toLocaleString("fr-FR")} FCFA : règle d'abord cet argent avant de supprimer le compte.`
    );

  const open = { in: ["PENDING", "OFFERED", "MATCHED", "ARRIVED", "IN_PROGRESS"] as ("PENDING" | "OFFERED" | "MATCHED" | "ARRIVED" | "IN_PROGRESS")[] };
  const [openRides, openDeliveries] = await Promise.all([
    prisma.ride.count({ where: { OR: [{ clientId: userId }, { driverId: userId }], status: open } }),
    prisma.delivery.count({ where: { OR: [{ clientId: userId }, { courierId: userId }], status: open } }),
  ]);
  if (openRides + openDeliveries > 0)
    throw new BadRequestException("Ce compte a une course ou une livraison en cours : attends qu'elle soit terminée ou annulée.");

  const [rides, deliveries, rentals, orders, artisans, tips, offers, movements] = await Promise.all([
    prisma.ride.count({ where: { OR: [{ clientId: userId }, { driverId: userId }] } }),
    prisma.delivery.count({ where: { OR: [{ clientId: userId }, { courierId: userId }] } }),
    prisma.rentalBooking.count({ where: { clientId: userId } }),
    prisma.marketplaceOrder.count({ where: { clientId: userId } }),
    prisma.artisanRequest.count({ where: { clientId: userId } }),
    prisma.rideTip.count({ where: { OR: [{ clientId: userId }, { driverId: userId }] } }),
    prisma.rideOffer.count({ where: { driverId: userId } }),
    user.wallet ? prisma.transaction.count({ where: { walletId: user.wallet.id, status: { not: "PENDING" } } }) : Promise.resolve(0),
  ]);
  const hasHistory = settle || rides + deliveries + rentals + orders + artisans + tips + offers + movements > 0;

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

  // Prestataire / agence : en cas d'anonymisation, le dossier reste (statistiques) mais vidé de ses données personnelles et de ses pièces
  const wipeProvider = user.provider
    ? [
        prisma.providerDocument.deleteMany({ where: { providerId: user.provider.id } }),
        prisma.providerProfile.update({
          where: { id: user.provider.id },
          data: { fullName: null, city: null, zones: [], bio: null, vehicleModel: null, plateNumber: null, agencyName: null, phoneShop: null, status: "SUSPENDED", suspensionReason: "Compte supprimé" },
        }),
      ]
    : [];

  const anonymize = async (): Promise<ClientDeletionResult> => {
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
      ...wipeProvider,
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
          role: "CLIENT",
          agencyId: null,
          status: "BLOCKED",
        },
      }),
    ]);
    logger.warn(`Compte ${user.role} ${userId} anonymisé par l'administrateur ${adminId} (historique conservé)`);
    return { userId, mode: "anonymized", detachedReferrals };
  };

  if (hasHistory) return anonymize();

  try {
    await prisma.$transaction([
      ...dropReferrer,
      ...wipePersonal,
      ...(user.wallet ? [prisma.transaction.deleteMany({ where: { walletId: user.wallet.id } }), prisma.wallet.delete({ where: { id: user.wallet.id } })] : []),
      prisma.user.delete({ where: { id: userId } }),
    ]);
  } catch (e: any) {
    // Une donnée liée au compte empêche l'effacement définitif (clé étrangère) : on anonymise à la place
    if (e?.code !== "P2003") throw e;
    logger.warn(`Effacement définitif impossible pour ${userId} (donnée liée) : anonymisation`);
    return anonymize();
  }
  logger.warn(`Compte ${user.role} ${userId} supprimé par l'administrateur ${adminId}`);
  return { userId, mode: "deleted", detachedReferrals };
}
