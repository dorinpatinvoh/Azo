import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";
import { ProvidersModule } from "../providers/providers.module";

@Global()
@Module({
  imports: [
    PassportModule,
    // Pour ouvrir un brouillon de dossier prestataire à l'inscription (sans accorder de rôle).
    ProvidersModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || "dev-secret-a-changer",
      signOptions: { expiresIn: "30d" },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [JwtModule],
})
export class AuthModule {}
