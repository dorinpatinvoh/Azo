import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";
import { ProvidersModule } from "../providers/providers.module";
import { getJwtSecret } from "../common/jwt-secret";

@Global()
@Module({
  imports: [
    PassportModule,
    ProvidersModule,
    JwtModule.register({
      secret: getJwtSecret(),
      signOptions: { expiresIn: "30d" },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [JwtModule],
})
export class AuthModule {}
