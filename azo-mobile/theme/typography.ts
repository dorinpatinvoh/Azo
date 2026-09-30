import { TextStyle } from "react-native";

// Police de la charte : "Plus Jakarta Sans" (titres) + "Inter" (texte courant).
// À charger avec expo-font avant le premier rendu (voir App.tsx).
export const fontFamily = {
  display: "PlusJakartaSans_800ExtraBold",
  headlineBold: "PlusJakartaSans_700Bold",
  headlineSemibold: "PlusJakartaSans_600SemiBold",
  body: "Inter_400Regular",
  label: "PlusJakartaSans_600SemiBold",
};

type Typo = Record<string, TextStyle>;

export const typography: Typo = {
  displayLgMobile: {
    fontFamily: fontFamily.display,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.4,
  },
  headlineXl: {
    fontFamily: fontFamily.headlineBold,
    fontSize: 28,
    lineHeight: 36,
    letterSpacing: -0.3,
  },
  headlineLg: {
    fontFamily: fontFamily.headlineBold,
    fontSize: 24,
    lineHeight: 32,
  },
  headlineMd: {
    fontFamily: fontFamily.headlineSemibold,
    fontSize: 20,
    lineHeight: 28,
  },
  headlineSm: {
    fontFamily: fontFamily.headlineSemibold,
    fontSize: 18,
    lineHeight: 24,
  },
  bodyLg: {
    fontFamily: fontFamily.body,
    fontSize: 16,
    lineHeight: 24,
  },
  bodyMd: {
    fontFamily: fontFamily.body,
    fontSize: 14,
    lineHeight: 20,
  },
  bodySm: {
    fontFamily: fontFamily.body,
    fontSize: 12,
    lineHeight: 18,
  },
  labelLg: {
    fontFamily: fontFamily.label,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: 0.1,
  },
  labelMd: {
    fontFamily: fontFamily.label,
    fontSize: 13,
    lineHeight: 16,
  },
  labelSm: {
    fontFamily: fontFamily.label,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.4,
  },
};
