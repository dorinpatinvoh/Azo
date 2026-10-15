import { tarification } from "../services/tarification";

/**
 * Réglages du radar du Speeder lus dans la configuration partagée (`tarification.json`), avec une
 * valeur par défaut quand le serveur ne les fournit pas encore.
 * Contrat : PROJECT_SUMMARY/DEMANDE_BACKEND_RADAR_PROFIL_ZEM_ET_CARTE.md
 */
type RadarConfig = { nearbyRadiusKm?: number };
type RidesConfig = { offerExpirySeconds?: number };

/** Rayon dans lequel le Speeder voit les clients disponibles (km). */
export const nearbyRadiusKm = (): number => {
  const value = (tarification().radar as RadarConfig | undefined)?.nearbyRadiusKm;
  return typeof value === "number" && value > 0 ? value : 10;
};

/** Temps laissé au client pour confirmer un Speeder avant que la demande reparte sur les radars (s). */
export const offerExpirySeconds = (): number => {
  const value = ((tarification() as { rides?: RidesConfig }).rides)?.offerExpirySeconds;
  return typeof value === "number" && value > 0 ? value : 45;
};
