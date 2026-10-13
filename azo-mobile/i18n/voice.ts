// Assistance vocale : lecture à voix haute par la synthèse vocale DU TÉLÉPHONE (expo-speech).
// Aucun serveur, aucun fichier audio : la voix et ses langues dépendent donc de ce que le
// téléphone a installé (le français et l'anglais sont presque toujours présents ; l'espagnol et
// l'allemand peuvent demander de télécharger les données vocales dans les réglages Android).
import * as Speech from "expo-speech";
import { languageInfo, type LangCode } from "./languages";

/** Lit `text` dans la langue choisie, en coupant ce qui était en cours de lecture. */
export function speak(text: string, lang: LangCode, onDone?: () => void): void {
  const message = text.trim();
  if (!message) return;
  Speech.stop();
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
