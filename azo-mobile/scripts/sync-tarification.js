#!/usr/bin/env node
/**
 * Synchronise la configuration tarifaire du backend vers l'application mobile.
 *
 * Source unique de vérité : azo-backend/src/pricing/tarification.json
 * Copie mobile (barème hors ligne) : azo-mobile/config/tarification.json
 *
 *   npm run sync:tarification   (depuis azo-mobile)
 */
const fs = require("fs");
const path = require("path");

const source = path.join(__dirname, "..", "..", "azo-backend", "src", "pricing", "tarification.json");
const target = path.join(__dirname, "..", "config", "tarification.json");

if (!fs.existsSync(source)) {
  console.error(`✖ Configuration introuvable : ${source}`);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(source, "utf8"));
config._notes = config._notes || {};
config._notes.copie =
  "Copie synchronisée depuis azo-backend/src/pricing/tarification.json — ne pas modifier ici : lancer `npm run sync:tarification`.";

fs.writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, "utf8");
console.log(`✔ Configuration tarifaire synchronisée vers ${path.relative(process.cwd(), target)}`);
