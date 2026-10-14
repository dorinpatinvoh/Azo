/**
 * Durée de la session de l'application (jeton JWT). L'utilisateur reste connecté jusqu'à sa déconnexion :
 * le jeton dure longtemps ET se renouvelle tout seul tant que l'application est utilisée
 * (voir SessionRefreshInterceptor). Réglable avec JWT_EXPIRES_DAYS (défaut 365 jours).
 */
const parsed = Number(process.env.JWT_EXPIRES_DAYS);
export const SESSION_DAYS = Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 365;
export const SESSION_EXPIRES_IN = `${SESSION_DAYS}d`;
// Renouvellement dès que la moitié de la durée est écoulée.
export const SESSION_REFRESH_BELOW_SECONDS = Math.floor((SESSION_DAYS * 24 * 3600) / 2);
export const REFRESHED_TOKEN_HEADER = "x-refreshed-token";
