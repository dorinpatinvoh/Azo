import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || "dev-secret-a-changer",
    });
  }

  // Le contenu retourné devient req.user
  async validate(payload: { sub: string; role: string; phone: string }) {
    return { userId: payload.sub, role: payload.role, phone: payload.phone };
  }
}
