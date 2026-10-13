#!/usr/bin/env node
/**
 * Synchronise la copie embarquée du barème (`config/tarification.json`) depuis la source
 * unique du backend (`azo-backend/src/pricing/tarification.json`).
 *
 *   npm run sync:tarification
 *
 * L'application lit le barème du serveur (`GET /pricing`) quand il répond, et se rabat sur
 * cette copie hors ligne : si elle est périmée, l'affichage hors ligne montre d'anciens prix.
 * À relancer à chaque changement de tarif côté backend, puis à recommiter le fichier.
 */
const fs = require("fs");
const path = require("path");

const source = path.join(__dirname, "..", "..", "azo-backend", "src", "pricing", "tarification.json");
const target = path.join(__dirname, "..", "config", "tarification.json");

if (!fs.existsSync(source)) {
  console.error(`✖ Source introuvable : ${source}\n  Le dépôt complet (azo-backend + azo-mobile) est nécessaire.`);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(source, "utf8"));
config._notes = {
  ...(config._notes ?? {}),
  copie:
    "Copie synchronisée depuis azo-backend/src/pricing/tarification.json — ne pas modifier ici : lancer `npm run sync:tarification`.",
};

const next = `${JSON.stringify(config, null, 2)}\n`;
const previous = fs.existsSync(target) ? fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") : "";

if (previous === next) {
  console.log("✔ Barème déjà à jour : aucune modification.");
} else {
  fs.writeFileSync(target, next);
  console.log("✔ Barème synchronisé : azo-mobile/config/tarification.json mis à jour.");
}
