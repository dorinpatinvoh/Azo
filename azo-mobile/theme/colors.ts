// Jetons de couleur extraits de la charte graphique AZƆ̀ (maquette Stitch)
// Un seul fichier source de vérité pour tous les écrans.

export const colors = {
  // Surfaces
  background: "#fcf9f8",
  surface: "#fcf9f8",
  surfaceContainerLowest: "#ffffff",
  surfaceContainerLow: "#f6f3f2",
  surfaceContainer: "#f0eded",
  surfaceContainerHigh: "#eae7e7",
  surfaceContainerHighest: "#e5e2e1",

  // Texte
  onSurface: "#1c1b1b",
  onSurfaceVariant: "#4d4353",
  outline: "#7f7384",
  outlineVariant: "#d0c2d5",

  // Primaire (violet — confiance, marque)
  primary: "#7100af",
  onPrimary: "#ffffff",
  primaryContainer: "#8b2fc9",
  primaryFixed: "#f3daff",
  onPrimaryFixed: "#2f004c",

  // Secondaire (orange — vitalité, rapidité)
  secondary: "#a53c00",
  onSecondary: "#ffffff",
  secondaryContainer: "#fd712f",
  secondaryFixed: "#ffdbce",
  onSecondaryFixed: "#370e00",

  // Tertiaire (ambre doré)
  tertiary: "#634200",
  onTertiary: "#ffffff",
  tertiaryContainer: "#825800",
  tertiaryFixed: "#ffddaf",
  tertiaryFixedDim: "#ffba44",
  onTertiaryFixed: "#281800",

  // États
  error: "#ba1a1a",
  onError: "#ffffff",
  errorContainer: "#ffdad6",

  // Dégradé du bouton signature (CTA principal)
  gradientCta: ["#8B2FC9", "#C0392B", "#E05C1A", "#F0A500"] as const,
};

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 20,
  xl: 28,
};
