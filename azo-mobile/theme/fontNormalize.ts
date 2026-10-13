// Règle unique de police : « une graisse = une famille réellement chargée ».
//
// App.tsx charge une famille PAR graisse (Plus Jakarta Sans 600 / 700 / 800, Inter 400). Une
// famille personnalisée n'a pas de variante grasse : quand un style combine `fontFamily` et
// `fontWeight: "700"`, Android ajoute un gras ARTIFICIEL par-dessus la police (rendu épaissi,
// différent d'un texte à l'autre, et Inter 400 « gras » n'a rien d'Inter Bold). Un texte sans
// `fontFamily` retombe, lui, sur la police du système (Roboto).
//
// `normalizeTextStyle` remplace donc `fontWeight` par la vraie famille de cette graisse, et donne
// la police de la charte aux textes qui n'en avaient pas. Fonction pure, sans dépendance à
// React Native : elle est testable seule.

export const FONT = {
  regular: "Inter_400Regular",
  semibold: "PlusJakartaSans_600SemiBold",
  bold: "PlusJakartaSans_700Bold",
  extrabold: "PlusJakartaSans_800ExtraBold",
} as const;

const OWN_FAMILIES = new Set<string>(Object.values(FONT));

// Un style n'est traité que s'il parle de texte : les autres (cartes, boutons…) restent intacts.
const TEXT_KEYS = ["fontSize", "fontWeight", "lineHeight", "letterSpacing"];

function numericWeight(weight: unknown): number | undefined {
  if (weight === undefined || weight === null) return undefined;
  if (weight === "normal") return 400;
  if (weight === "bold") return 700;
  const n = Number(weight);
  return Number.isFinite(n) ? n : undefined;
}

/** Famille chargée la plus proche d'une graisse (les graisses 100-500 → Inter régulier). */
export function familyForWeight(weight: number): string {
  if (weight >= 800) return FONT.extrabold;
  if (weight >= 700) return FONT.bold;
  if (weight >= 600) return FONT.semibold;
  return FONT.regular;
}

export function normalizeTextStyle<T>(style: T): T {
  if (!style || typeof style !== "object" || Array.isArray(style)) return style;
  const source = style as Record<string, unknown>;
  if (!TEXT_KEYS.some((key) => key in source)) return style;

  const family = typeof source.fontFamily === "string" ? source.fontFamily : undefined;
  // Police volontairement différente de celles de la charte : on n'y touche pas.
  if (family && !OWN_FAMILIES.has(family)) return style;

  const weight = numericWeight(source.fontWeight);
  const next: Record<string, unknown> = { ...source };

  if (weight !== undefined) {
    delete next.fontWeight;
    if (weight >= 600) next.fontFamily = familyForWeight(weight);
    else if (!family) next.fontFamily = FONT.regular;
  } else if (!family) {
    next.fontFamily = FONT.regular;
  }
  return next as T;
}
