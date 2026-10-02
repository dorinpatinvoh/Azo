let warned = false;

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (process.env.NODE_ENV === "production") {
    if (!secret || secret.length < 16 || secret === "dev-secret-a-changer") {
      throw new Error(
        "[AZƆ̀ Sécurité] JWT_SECRET est obligatoire en production (16 caractères minimum)."
      );
    }
    return secret;
  }
  if (!secret || secret === "dev-secret-a-changer") {
    if (!warned) {
      warned = true;
      console.warn(
        "[AZƆ̀ Sécurité] JWT_SECRET absent de .env : utilisation de la clé de développement locale."
      );
    }
    return "azo_secret_dev_key_2026_super_securise";
  }
  return secret;
}
