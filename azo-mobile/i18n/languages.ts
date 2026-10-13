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

/**
 * Langues LOCALES du Bénin proposées pour la VOIX d'aide à l'inscription UNIQUEMENT. L'application reste en français :
 * ces langues n'ont ni voix de synthèse sur les téléphones ni textes traduits, la voix est donc un ENREGISTREMENT
 * fait par un locuteur natif (voir assets/voice/README.md). Tant qu'un enregistrement manque, la voix parle français.
 */
export type LocalVoiceCode = "fon" | "yor";
export type VoiceLangCode = LangCode | LocalVoiceCode;

export type LocalVoiceInfo = { code: LocalVoiceCode; native: string; flag: string };
export const LOCAL_VOICE_LANGUAGES: LocalVoiceInfo[] = [
  { code: "fon", native: "Fɔ̀ngbè", flag: "🇧🇯" },
  { code: "yor", native: "Yorùbá", flag: "🇧🇯" },
];

export const isLocalVoice = (code: string | null | undefined): code is LocalVoiceCode =>
  LOCAL_VOICE_LANGUAGES.some((l) => l.code === code);

export const DEFAULT_LANGUAGE: LangCode = "fr";

export function languageInfo(code: LangCode): LanguageInfo {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

export function isLangCode(value: unknown): value is LangCode {
  return LANGUAGES.some((l) => l.code === value);
}
