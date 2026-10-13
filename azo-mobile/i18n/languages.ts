// Langues proposées par l'application. Le français est la langue source : toute clé absente d'une
// autre langue retombe sur le français (jamais de texte vide à l'écran).

export type LangCode = "fr" | "en" | "es" | "de";

export type LanguageInfo = {
  code: LangCode;
  /** Nom de la langue, écrit dans cette langue (c'est ce que l'utilisateur reconnaît) */
  native: string;
  /** Drapeau, pour repérer la langue d'un coup d'œil */
  flag: string;
  /** Code BCP 47 pour la synthèse vocale du téléphone */
  speech: string;
  /** Code pour formater les dates et les nombres */
  locale: string;
};

export const LANGUAGES: LanguageInfo[] = [
  { code: "fr", native: "Français", flag: "🇫🇷", speech: "fr-FR", locale: "fr-FR" },
  { code: "en", native: "English", flag: "🇬🇧", speech: "en-GB", locale: "en-GB" },
  { code: "es", native: "Español", flag: "🇪🇸", speech: "es-ES", locale: "es-ES" },
  { code: "de", native: "Deutsch", flag: "🇩🇪", speech: "de-DE", locale: "de-DE" },
];

export const DEFAULT_LANGUAGE: LangCode = "fr";

export function languageInfo(code: LangCode): LanguageInfo {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

export function isLangCode(value: unknown): value is LangCode {
  return LANGUAGES.some((l) => l.code === value);
}
