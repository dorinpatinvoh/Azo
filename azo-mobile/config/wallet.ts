/** Recharge FedaPay : montant minimum (FCFA). Identique côté serveur (MIN_RECHARGE, wallet.service.ts). */
export const MIN_RECHARGE = 300;

/** Montants proposés en un appui. */
export const RECHARGE_PRESETS = [500, 1000, 2000, 5000, 10000];

/** Après l'ouverture du paiement : le solde est relu toutes les 4 s pendant 3 minutes, le temps que FedaPay confirme. */
export const RECHARGE_POLL_MS = 4000;
export const RECHARGE_POLL_MAX_MS = 3 * 60 * 1000;

/** Chemin de la page de retour du serveur : FedaPay y redirige à la fin du paiement (FEDAPAY_CALLBACK_URL = <API>/wallet/recharge/return). */
export const PAYMENT_RETURN_PATH = "/wallet/recharge/return";
