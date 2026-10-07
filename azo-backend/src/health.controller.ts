import { Controller, Get } from "@nestjs/common";

/**
 * Sonde de disponibilité AZƆ̀ — `GET /health` (et `GET /` qui y renvoie).
 *
 * Elle sert à répondre en une seule requête à trois questions :
 *   1. **le serveur est-il actif ?** — s'il répond, il est réveillé ;
 *   2. **quelle version tourne ?** — `commit` et `branche` sont renseignés
 *      automatiquement par Render (`RENDER_GIT_COMMIT`, `RENDER_GIT_BRANCH`) :
 *      en production, ils indiquent le commit réellement déployé ;
 *   3. **depuis quand ?** — `uptimeSeconds` retombe à zéro après un redéploiement
 *      ou un réveil, ce qui permet de repérer un redémarrage.
 *
 * Aucune authentification : la sonde ne révèle ni donnée client, ni secret.
 */
@Controller()
export class HealthController {
  @Get()
  root() {
    return {
      service: "AZƆ̀ API",
      status: "ok",
      health: "/health",
      pricing: "/pricing",
    };
  }

  @Get("health")
  health() {
    return {
      status: "ok",
      service: "azo-backend",
      commit: process.env.RENDER_GIT_COMMIT ?? null,
      branche: process.env.RENDER_GIT_BRANCH ?? null,
      environnement: process.env.NODE_ENV ?? "development",
      uptimeSeconds: Math.round(process.uptime()),
      heure: new Date().toISOString(),
    };
  }
}
