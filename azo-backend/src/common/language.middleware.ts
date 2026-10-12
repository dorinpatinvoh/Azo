import { Injectable, NestMiddleware } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { SUPPORTED_LANGUAGES } from "./registration-profile";

/**
 * Résout la langue à utiliser pour la requête et l'attache à `req.lang`.
 *
 * Priorité :
 *   1. `user.language` (si l'utilisateur est authentifié et a une langue stockée)
 *   2. En-tête `Accept-Language` (valeur exacte : fr | en | es | de)
 *   3. Défaut : `fr`
 *
 * Le middleware s'exécute APRÈS le JwtAuthGuard (dans le lifecycle NestJS, les
 * middlewares Express s'exécutent avant les guards — on ne peut donc pas lire
 * `user.language` depuis la base ici). On pose donc uniquement l'en-tête comme
 * fallback pré-auth, et on expose un helper `getRequestLang` que les services
 * peuvent appeler s'ils ont besoin de la langue.
 */
@Injectable()
export class LanguageMiddleware implements NestMiddleware {
  use(req: Request & { lang?: string }, _res: Response, next: NextFunction) {
    const header = req.headers["accept-language"];
    const fromHeader =
      typeof header === "string" ? header.split(",")[0].trim().slice(0, 2).toLowerCase() : null;

    req.lang =
      fromHeader && (SUPPORTED_LANGUAGES as readonly string[]).includes(fromHeader) ? fromHeader : "fr";
    next();
  }
}

/**
 * Extrait la langue d'une requête Express enrichie par `LanguageMiddleware`.
 * Si `userLanguage` est fourni (lu depuis la DB après auth), il a la priorité.
 */
export function resolveLanguage(req: { lang?: string }, userLanguage?: string | null): string {
  if (userLanguage && (SUPPORTED_LANGUAGES as readonly string[]).includes(userLanguage)) {
    return userLanguage;
  }
  return req.lang ?? "fr";
}
