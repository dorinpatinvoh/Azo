let warned = false;

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (process.env.STRICT_PRODUCTION === "true") {
    if (!secret || secret.length < 16 || secret === "dev-secret-a-changer") {
      throw new Error(
        "[AZƆ̀ Sécurité] JWT_SECRET est obligatoire en production stricte (16 caractères minimum)."
      );
    }
    return secret;
  }
  if (!secret || secret.length < 16 || secret === "dev-secret-a-changer") {
    if (!warned) {
      warned = true;
      console.warn(
        "[AZƆ̀ Sécurité] JWT_SECRET absent ou trop court : utilisation de la clé par défaut AZƆ̀."
      );
    }
    return "azo_secret_dev_key_2026_super_securise";
  }
  return secret;
}
