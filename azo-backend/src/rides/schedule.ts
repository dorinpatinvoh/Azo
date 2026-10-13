import { BadRequestException } from "@nestjs/common";

/** Course programmée : au plus tôt dans 30 min, au plus tard dans 7 jours. */
export const SCHEDULE_MIN_LEAD_MIN = 30;
export const SCHEDULE_MAX_DAYS = 7;
/** La demande est ouverte aux chauffeurs 15 min avant l'heure de prise en charge souhaitée. */
export const SCHEDULE_RELEASE_LEAD_MIN = 15;

const MINUTE = 60_000;

/** Valide l'heure demandée par le client ; erreur 400 claire sinon. */
export function parseSchedule(raw: string, now: Date = new Date()): Date {
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) throw new BadRequestException("Heure de prise en charge invalide.");
  const leadMin = (at.getTime() - now.getTime()) / MINUTE;
  if (leadMin < SCHEDULE_MIN_LEAD_MIN) {
    throw new BadRequestException(`Une course programmée doit être demandée au moins ${SCHEDULE_MIN_LEAD_MIN} minutes à l'avance.`);
  }
  if (leadMin > SCHEDULE_MAX_DAYS * 24 * 60) {
    throw new BadRequestException(`Tu peux programmer une course jusqu'à ${SCHEDULE_MAX_DAYS} jours à l'avance.`);
  }
  return at;
}

/** Moment où la demande devient visible des chauffeurs. */
export function releaseAt(scheduledAt: Date): Date {
  return new Date(scheduledAt.getTime() - SCHEDULE_RELEASE_LEAD_MIN * MINUTE);
}

type Schedulable = { createdAt: Date; scheduledAt?: Date | null; scheduledReleasedAt?: Date | null };

/** Course programmée pas encore ouverte aux chauffeurs : invisible du radar, jamais expirée. */
export function isWaitingForRelease(ride: Schedulable): boolean {
  return !!ride.scheduledAt && !ride.scheduledReleasedAt;
}

/**
 * Pour une course programmée déjà ouverte, le délai d'attente d'un chauffeur compte à partir de l'ouverture, pas de la
 * création (sinon elle expirerait aussitôt). Pour les autres courses, rien ne change.
 */
export function withReleaseAsCreation<T extends Schedulable>(ride: T): T {
  return ride.scheduledAt && ride.scheduledReleasedAt ? { ...ride, createdAt: ride.scheduledReleasedAt } : ride;
}
