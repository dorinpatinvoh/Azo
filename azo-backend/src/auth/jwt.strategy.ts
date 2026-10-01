import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || "dev-secret-a-changer",
    });
  }

  // Le contenu retourné devient req.user.
  // Le rôle et le statut sont relus en base à chaque requête : un jeton est signé pour
  // 30 jours, or une suspension admin ou une validation de dossier prestataire doit
  // prendre effet immédiatement. Sans cette relecture, un chauffeur suspendu
  // continuerait d'accepter des courses avec son ancien jeton.
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
