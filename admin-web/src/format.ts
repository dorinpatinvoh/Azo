export const fcfa = (n: number | null | undefined) => `${(n ?? 0).toLocaleString("fr-FR")} F`;

export const dateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export const dateOnly = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

/** « +2290197000042 » → « +229 01 97 00 00 42 » */
export function phone(p: string | null | undefined): string {
  if (!p) return "—";
  const digits = p.replace(/\D/g, "");
  const local = digits.startsWith("229") && digits.length > 8 ? digits.slice(3) : digits;
  if (!p.startsWith("+") && !digits.startsWith("229")) return p; // numéro masqué ou déjà mis en forme
  return `+229 ${local.replace(/(\d{2})(?=\d)/g, "$1 ").trim()}`;
}

export const km = (n: number | null | undefined) => (n == null ? "—" : `${n.toLocaleString("fr-FR", { maximumFractionDigits: 3 })} km`);

export const TYPE_LABEL: Record<string, string> = { DRIVER: "Speeder", COURIER: "Coursier / livreur", AGENCY: "Agence", ARTISAN: "Artisan" };

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Brouillon",
  SUBMITTED: "Déposé",
  UNDER_REVIEW: "En examen",
  NEED_INFO: "Information demandée",
  APPROVED: "Validé",
  REJECTED: "Refusé",
  SUSPENDED: "Suspendu",
};
export const STATUS_TONE: Record<string, string> = {
  DRAFT: "grey",
  SUBMITTED: "warn",
  UNDER_REVIEW: "warn",
  NEED_INFO: "orange",
  APPROVED: "ok",
  REJECTED: "err",
  SUSPENDED: "err",
};

export const VEHICLE_LABEL: Record<string, string> = {
  ZEM_ESSENCE: "Speeder moto à essence",
  ZEM_ELECTRIC: "Speeder moto électrique",
  ZEM_TRICYCLE: "Speeder tricycle",
  GAZELLE: "Gazelle (voiture)",
  KOALA: "Koala (voiture climatisée)",
  LEOPARD: "Léopard (berline premium)",
};

export const EVENT_LABEL: Record<string, string> = {
  CREATED: "Dossier ouvert",
  UPDATED: "Dossier mis à jour",
  SUBMITTED: "Dossier déposé",
  DOCUMENT_ADDED: "Pièce ajoutée",
  DOCUMENT_VALIDATED: "Pièce validée",
  DOCUMENT_REJECTED: "Pièce refusée",
  REVIEW_STARTED: "Examen commencé",
  INFO_REQUESTED: "Information demandée",
  APPROVED: "Dossier validé",
  REJECTED: "Dossier refusé",
  SUSPENDED: "Compte suspendu",
  REINSTATED: "Compte rétabli",
};

/** Nom de la catégorie d'un prestataire : Speeder, coursier personnel, livreur express ou agence. */
export function providerKind(p: { type: string; activity: { categoryId: string | null } }): string {
  if (p.type === "COURIER") return p.activity.categoryId === "COURSIER_PERSONNEL" ? "Coursier personnel" : "Livreur express";
  return TYPE_LABEL[p.type] ?? p.type;
}
