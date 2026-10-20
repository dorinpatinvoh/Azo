import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { json, urlencoded } from "express";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/http-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // CORS : l'application mobile n'est pas concernée (appels natifs). Pour les sites web (console administrateur), CORS_ORIGINS liste les
  // adresses autorisées, séparées par des virgules (ex. https://admin.angidsnpro.com) ; absente, tout site est accepté (comportement historique).
  const origins = (process.env.CORS_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  app.enableCors(origins.length ? { origin: origins } : undefined);

  // Augmente la taille maximale des corps JSON pour accepter les photos KYC en base64
  // (contourne le bug multipart de React Native Android sur certains téléphones).
  // `rawBody` : corps brut conservé pour vérifier la signature des webhooks FedaPay (HMAC sur le texte exact reçu).
  app.use(json({ limit: "15mb", verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
  app.use(urlencoded({ extended: true, limit: "15mb" }));

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Enrichit toutes les réponses d'erreur HTTP avec un champ `code` stable (ex. "WALLET_INSUFFICIENT")
  // que le mobile peut utiliser pour afficher le message traduit dans la langue de l'utilisateur.
  app.useGlobalFilters(new HttpExceptionFilter());

  const port = process.env.PORT || 3000;

  await app.listen(port, "0.0.0.0");

  console.log(`AZƆ̀ API démarrée sur http://0.0.0.0:${port} (accessible depuis le Wi-Fi)`);
}
bootstrap();
