"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const express_1 = require("express");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.enableCors(); // autorise l'app mobile à appeler l'API
    // Augmente la taille maximale des corps JSON pour accepter les photos KYC en base64
    // (contourne le bug multipart de React Native Android sur certains téléphones).
    app.use((0, express_1.json)({ limit: "15mb" }));
    app.use((0, express_1.urlencoded)({ extended: true, limit: "15mb" }));
    app.useGlobalPipes(new common_1.ValidationPipe({ whitelist: true, transform: true }));
    const port = process.env.PORT || 3000;
    await app.listen(port, "0.0.0.0");
    console.log(`AZƆ̀ API démarrée sur http://0.0.0.0:${port} (accessible depuis le Wi-Fi)`);
}
bootstrap();
//# sourceMappingURL=main.js.map