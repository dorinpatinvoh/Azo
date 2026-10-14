import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Observable, from, mergeMap } from "rxjs";
import { REFRESHED_TOKEN_HEADER, SESSION_REFRESH_BELOW_SECONDS } from "./session";

/**
 * Session glissante : quand le jeton de l'utilisateur a dépassé la moitié de sa durée, la réponse porte un jeton
 * tout neuf dans l'en-tête `X-Refreshed-Token`. L'application le mémorise : un utilisateur qui se sert de l'application
 * n'a jamais à se reconnecter, sauf s'il se déconnecte lui-même.
 */
@Injectable()
export class SessionRefreshInterceptor implements NestInterceptor {
  constructor(private readonly jwt: JwtService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();
    const user = req?.user as { userId?: string; role?: string; phone?: string; exp?: number } | undefined;
    if (!user?.userId || typeof user.exp !== "number") return next.handle();
    const remaining = user.exp - Math.floor(Date.now() / 1000);
    if (remaining >= SESSION_REFRESH_BELOW_SECONDS) return next.handle();
    return next.handle().pipe(
      mergeMap((data) =>
        from(
          this.jwt
            .signAsync({ sub: user.userId, role: user.role, phone: user.phone })
            .then((token) => {
              res?.setHeader?.(REFRESHED_TOKEN_HEADER, token);
              return data;
            })
            // Renouvellement impossible : la réponse part quand même, l'ancien jeton reste valable.
            .catch(() => data)
        )
      )
    );
  }
}
