/**
 * Texte de la notification poussée « un Zem a accepté ta course », dans la langue du client
 * (`User.language`). `{s}` = secondes restantes pour décider.
 */
const TEXTS: Record<string, { title: string; body: string }> = {
  fr: { title: "Un Zem a accepté ta course", body: "Touche pour voir son profil — il te reste {s} s." },
  en: { title: "A Zem accepted your ride", body: "Tap to see their profile — you have {s} s left." },
  es: { title: "Un Zem aceptó tu viaje", body: "Toca para ver su perfil — te quedan {s} s." },
  de: { title: "Ein Zem hat deine Fahrt angenommen", body: "Tippe, um sein Profil zu sehen — dir bleiben {s} s." },
};

export function offerPushText(language: string | null | undefined, seconds: number): { title: string; body: string } {
  const text = TEXTS[language ?? "fr"] ?? TEXTS.fr;
  return { title: text.title, body: text.body.replace("{s}", String(Math.max(0, Math.round(seconds)))) };
}
