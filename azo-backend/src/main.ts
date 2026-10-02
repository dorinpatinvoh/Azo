import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { json, urlencoded } from "express";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors(); // autorise l'app mobile à appeler l'API

  // Augmente la taille maximale des corps JSON pour accepter les photos KYC en base64
  // (contourne le bug multipart de React Native Android sur certains téléphones).
  app.use(json({ limit: "15mb" }));
  app.use(urlencoded({ extended: true, limit: "15mb" }));

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = process.env.PORT || 3000;

  await app.listen(port, "0.0.0.0");

  console.log(`AZƆ̀ API démarrée sur http://0.0.0.0:${port} (accessible depuis le Wi-Fi)`);
}
bootstrap();
