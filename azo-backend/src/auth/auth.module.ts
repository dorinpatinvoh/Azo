import { ReferralsModule } from "../referrals/referrals.module";
import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";
import { ProvidersModule } from "../providers/providers.module";
import { getJwtSecret } from "../common/jwt-secret";
import { SESSION_EXPIRES_IN } from "./session";
import { SessionRefreshInterceptor } from "./session-refresh.interceptor";

@Global()
@Module({
  imports: [
    PassportModule,
    ProvidersModule,
    ReferralsModule,
    JwtModule.register({
      secret: getJwtSecret(),
      signOptions: { expiresIn: SESSION_EXPIRES_IN },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, { provide: APP_INTERCEPTOR, useClass: SessionRefreshInterceptor }],
  exports: [JwtModule],
})
export class AuthModule {}
