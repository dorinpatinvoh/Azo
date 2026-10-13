// Génère i18n/voiceClips.ts : un `require` par enregistrement présent dans assets/voice/<langue>/<message>.mp3.
// Usage : npm run voice:manifest (après avoir déposé de nouveaux enregistrements).
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const voiceDir = path.join(root, "assets", "voice");
const LANGS = ["fon", "yor"];
// Les messages lus pendant l'inscription (nom du fichier sans .mp3) : doit rester aligné sur VOICE_CLIP_IDS (i18n/voice.ts)
const IDS = ["welcome", "hint-on", "step-phone", "step-code", "step-register", "done"];

const lines = [
  "// GÉNÉRÉ par `npm run voice:manifest` à partir des fichiers de assets/voice/<langue>/*.mp3 — ne pas modifier à la main.",
  "export const VOICE_CLIPS: Record<string, Record<string, number>> = {",
];
const found = [];
for (const lang of LANGS) {
  lines.push(`  ${lang}: {`);
  for (const id of IDS) {
    const file = path.join(voiceDir, lang, id + ".mp3");
    if (fs.existsSync(file)) {
      lines.push(`    "${id}": require("../assets/voice/${lang}/${id}.mp3"),`);
      found.push(`${lang}/${id}`);
    }
  }
  lines.push("  },");
}
lines.push("};", "");
fs.writeFileSync(path.join(root, "i18n", "voiceClips.ts"), lines.join("\n"));
console.log(found.length ? `Enregistrements pris en compte (${found.length}) : ${found.join(", ")}` : "Aucun enregistrement trouvé dans assets/voice/.");
