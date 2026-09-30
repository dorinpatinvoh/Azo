import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors(); // autorise l'app mobile à appeler l'API
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  
  const port = process.env.PORT || 3000;

  // CORRECTION : Ajouter '0.0.0.0' pour écouter sur toutes les interfaces réseau (Wi-Fi local)
  await app.listen(port, "0.0.0.0");
  
  console.log(`AZƆ̀ API démarrée sur http://0.0.0.0:${port} (accessible depuis le Wi-Fi)`);
}
bootstrap();
