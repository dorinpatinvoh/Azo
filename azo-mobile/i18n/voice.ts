// Assistance vocale.
//  - Langues de l'application (fr, en, es, de) : lecture par la synthèse vocale DU TÉLÉPHONE (expo-speech). Aucun serveur, aucun
//    fichier audio : la voix dépend de ce que le téléphone a installé (l'espagnol et l'allemand peuvent demander de télécharger
//    les données vocales dans les réglages Android).
//  - Langues locales (Fon, Yoruba) : pas de synthèse possible. On joue un ENREGISTREMENT (assets/voice/…) ; s'il manque, la voix
//    parle français plutôt que de se taire. L'écran reste en français dans tous les cas.
import * as Speech from "expo-speech";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { isLocalVoice, languageInfo, LOCAL_VOICE_LANGUAGES, type LangCode, type VoiceLangCode } from "./languages";
import { translate } from "./index";
import type { MessageKey } from "./fr";
import { VOICE_CLIPS } from "./voiceClips";

/** Messages lus à voix haute, et nom du fichier d'enregistrement correspondant (assets/voice/<langue>/<nom>.mp3). */
export const VOICE_CLIP_IDS = {
  "lang.welcome": "welcome",
  "voice.hintOn": "hint-on",
  "voice.step.phone": "step-phone",
  "voice.step.code": "step-code",
  "voice.step.register": "step-register",
  "voice.done": "done",
} as const satisfies Partial<Record<MessageKey, string>>;
export type VoiceKey = keyof typeof VOICE_CLIP_IDS;

let player: AudioPlayer | null = null;

function stopClip(): void {
  const current = player;
  player = null;
  try {
    current?.pause();
    current?.remove();
  } catch {
    // lecteur déjà libéré
  }
}

function playClip(clip: number, onDone?: () => void): boolean {
  try {
    Speech.stop().catch(() => undefined);
    stopClip();
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
    const next = createAudioPlayer(clip);
    player = next;
    next.addListener("playbackStatusUpdate", (status) => {
      if (status.didJustFinish) {
        if (player === next) stopClip();
        onDone?.();
      }
    });
    next.play();
    return true;
  } catch {
    stopClip();
    return false;
  }
}

/** Lit `text` à voix haute avec la synthèse du téléphone, dans la langue d'application donnée. */
export function speak(text: string, lang: LangCode, onDone?: () => void): void {
  const message = text.trim();
  if (!message) return;
  Speech.stop();
  stopClip();
  Speech.speak(message, {
    language: languageInfo(lang).speech,
    rate: 0.92, // un peu plus lent que la normale : on s'adresse à des personnes qui découvrent l'application
    pitch: 1,
    onDone,
    onError: () => {
      // Synthèse vocale indisponible : on reste silencieux, le texte reste affiché à l'écran.
    },
  });
}

export function stopSpeaking(): void {
  Speech.stop().catch(() => undefined);
  stopClip();
}

/** A-t-on au moins un enregistrement pour cette langue locale ? (sinon on prévient que la voix parlera français) */
export function hasRecordings(lang: VoiceLangCode): boolean {
  return isLocalVoice(lang) && Object.keys(VOICE_CLIPS[lang] ?? {}).length > 0;
}

export const localVoiceName = (lang: VoiceLangCode): string => LOCAL_VOICE_LANGUAGES.find((l) => l.code === lang)?.native ?? lang;

/**
 * Lit un message prévu de l'application dans la langue de la voix.
 * Langue locale : enregistrement s'il existe, sinon français par synthèse. Autre langue : synthèse dans cette langue.
 */
export function speakKey(key: VoiceKey, voiceLang: VoiceLangCode, onDone?: () => void): void {
  if (isLocalVoice(voiceLang)) {
    const clip = VOICE_CLIPS[voiceLang]?.[VOICE_CLIP_IDS[key]];
    if (clip !== undefined && playClip(clip, onDone)) return;
    speak(translate("fr", key), "fr", onDone);
    return;
  }
  speak(translate(voiceLang, key), voiceLang, onDone);
}

/** Lit un texte libre (alerte, message d'erreur) : pas d'enregistrement possible en langue locale, donc en français. */
export function speakText(text: string, voiceLang: VoiceLangCode, onDone?: () => void): void {
  speak(text, isLocalVoice(voiceLang) ? "fr" : voiceLang, onDone);
}

/**
 * Le téléphone a-t-il une voix pour cette langue ? Sert à prévenir l'utilisateur quand il n'y en a
 * pas, au lieu de ne rien dire. En cas de doute (liste vide ou erreur) on répond « oui » : mieux
 * vaut tenter la lecture que de refuser à tort.
 */
export async function hasVoiceFor(lang: LangCode): Promise<boolean> {
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    if (!voices.length) return true;
    const prefix = languageInfo(lang).speech.slice(0, 2).toLowerCase();
    return voices.some((v) => v.language?.toLowerCase().startsWith(prefix));
  } catch {
    return true;
  }
}
