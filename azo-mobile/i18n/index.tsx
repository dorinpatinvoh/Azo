// Traductions et préférences de langue / aide vocale de l'application.
//
// Tout est stocké SUR LE TÉLÉPHONE (expo-secure-store) : aucune route du serveur n'est nécessaire.
// Les erreurs du serveur portent un `code` stable : l'application les traduit (clés `err.<CODE>`).
// Les textes libres du serveur (notifications, libellés) restent dans la langue où il les écrit.
import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import * as SecureStore from "expo-secure-store";
import { DEFAULT_LANGUAGE, isLangCode, languageInfo, type LangCode } from "./languages";
import { fr, type MessageKey } from "./fr";
import { en } from "./en";
import { es } from "./es";
import { de } from "./de";

export type { LangCode, MessageKey };
export { LANGUAGES, languageInfo } from "./languages";

const DICTIONARIES: Record<LangCode, Record<MessageKey, string>> = { fr, en, es, de };

const LANGUAGE_KEY = "appLanguage";
const VOICE_KEY = "voiceAssist";
const OFFER_ANSWERED_KEY = "voiceOfferAnswered";

// État lu UNE fois au démarrage (`loadI18n`), avant le premier affichage : pas de flash en français.
let currentLang: LangCode = DEFAULT_LANGUAGE;
let currentVoice = false;
let offerAnswered = false;

export async function loadI18n(): Promise<void> {
  try {
    const [lang, voice, answered] = await Promise.all([
      SecureStore.getItemAsync(LANGUAGE_KEY),
      SecureStore.getItemAsync(VOICE_KEY),
      SecureStore.getItemAsync(OFFER_ANSWERED_KEY),
    ]);
    if (isLangCode(lang)) currentLang = lang;
    currentVoice = voice === "1";
    offerAnswered = answered === "1";
  } catch {
    // Stockage illisible : on garde le français, sans voix.
  }
}

/** L'utilisateur a-t-il déjà répondu à « veux-tu une aide vocale ? » (la question n'est posée qu'une fois) */
export const isVoiceOfferAnswered = () => offerAnswered;

export function markVoiceOfferAnswered(): void {
  offerAnswered = true;
  SecureStore.setItemAsync(OFFER_ANSWERED_KEY, "1").catch(() => undefined);
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => (name in vars ? String(vars[name]) : `{${name}}`));
}

/** Traduit une clé. Une clé absente de la langue retombe sur le français, jamais sur du vide. */
export function translate(lang: LangCode, key: MessageKey, vars?: Record<string, string | number>): string {
  return interpolate(DICTIONARIES[lang][key] ?? fr[key], vars);
}

/** Pour le code hors composant (ex. un message construit dans un service) : langue courante. */
export const tr = (key: MessageKey, vars?: Record<string, string | number>) => translate(currentLang, key, vars);
/** Une traduction existe-t-elle pour cette clé ? (codes d'erreur du serveur, clés venues d'ailleurs) */
export const hasMessage = (key: string): key is MessageKey => key in fr;
export const getLanguage = () => currentLang;

type I18nContextValue = {
  lang: LangCode;
  /** Code pour formater dates et nombres (ex. « fr-FR ») */
  locale: string;
  setLang: (lang: LangCode) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  voiceAssist: boolean;
  setVoiceAssist: (on: boolean) => void;
};

const I18nContext = createContext<I18nContextValue>({
  lang: DEFAULT_LANGUAGE,
  locale: languageInfo(DEFAULT_LANGUAGE).locale,
  setLang: () => undefined,
  t: (key, vars) => translate(DEFAULT_LANGUAGE, key, vars),
  voiceAssist: false,
  setVoiceAssist: () => undefined,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<LangCode>(currentLang);
  const [voiceAssist, setVoiceState] = useState<boolean>(currentVoice);

  const setLang = useCallback((next: LangCode) => {
    currentLang = next;
    setLangState(next);
    SecureStore.setItemAsync(LANGUAGE_KEY, next).catch(() => undefined);
  }, []);

  const setVoiceAssist = useCallback((on: boolean) => {
    currentVoice = on;
    setVoiceState(on);
    SecureStore.setItemAsync(VOICE_KEY, on ? "1" : "0").catch(() => undefined);
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      locale: languageInfo(lang).locale,
      setLang,
      t: (key, vars) => translate(lang, key, vars),
      voiceAssist,
      setVoiceAssist,
    }),
    [lang, voiceAssist, setLang, setVoiceAssist]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
