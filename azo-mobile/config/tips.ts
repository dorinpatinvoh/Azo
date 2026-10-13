import { tarification } from "../services/tarification";

/**
 * Pourboire : montants proposés et limites, lus dans la configuration partagée (`tips` de
 * `tarification.json`) avec des valeurs par défaut tant que le serveur ne les fournit pas.
 * Contrat : PROJECT_SUMMARY/DEMANDE_BACKEND_PROFIL_MESSAGERIE_POURBOIRE.md (§3)
 */
type TipsConfig = { presets?: number[]; minAmount?: number; maxAmount?: number };

export function tipSettings(): { presets: number[]; min: number; max: number } {
  const cfg = (tarification() as { tips?: TipsConfig }).tips;
  const presets = Array.isArray(cfg?.presets) && cfg.presets.length ? cfg.presets : [100, 200, 500, 1000];
  return { presets, min: cfg?.minAmount ?? 50, max: cfg?.maxAmount ?? 10000 };
}
