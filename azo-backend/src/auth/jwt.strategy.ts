import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "../prisma/prisma.service";
import { getJwtSecret } from "../common/jwt-secret";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      // Accepte l'en-tête Authorization: Bearer <jwt> OU ?token=<jwt> (utile pour les
      // balises <Image> React Native sur Android qui n'envoient pas toujours les headers).
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        ExtractJwt.fromUrlQueryParameter("token"),
      ]),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  // Le rôle et le statut sont relus en base à chaque requête : une suspension admin
  // ou une approbation de dossier prestataire prend effet immédiatement.
  async validate(payload: { sub: string; role: string; phone: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, status: true, phone: true },
    });
    if (!user) throw new UnauthorizedException("Compte introuvable");
    if (user.status === "BLOCKED")
      throw new UnauthorizedException("Compte suspendu par AZƆ̀ : contacte le support");
    return { userId: user.id, role: user.role, phone: user.phone };
  }
}
