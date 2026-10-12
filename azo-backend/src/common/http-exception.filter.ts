import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { Request, Response } from "express";

/**
 * Filtre d'exception global AZƆ̀.
 *
 * Enrichit toutes les réponses d'erreur HTTP avec un champ `code` stable que le
 * mobile peut utiliser pour afficher le message traduit dans la langue de l'utilisateur.
 * Le champ `message` reste en français comme secours.
 *
 * Format de sortie :
 *   { "statusCode": 400, "code": "WALLET_INSUFFICIENT", "message": "Solde insuffisant" }
 *
 * Si l'exception transporte déjà un objet `{ code, message }`, le `code` fourni est
 * conservé tel quel (ex. RegistrationCompleteGuard : code "REGISTRATION_REQUIRED").
 */
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const raw = exception.getResponse();

    const message =
      typeof raw === "string"
        ? raw
        : typeof raw === "object" && raw !== null && "message" in raw
          ? Array.isArray((raw as any).message)
            ? (raw as any).message.join("; ")
            : String((raw as any).message)
          : exception.message;

    const existingCode =
      typeof raw === "object" && raw !== null && "code" in raw ? String((raw as any).code) : undefined;

    const code = existingCode ?? inferErrorCode(status, message);

    response.status(status).json({ statusCode: status, code, message });
  }
}

/**
 * Déduit un code d'erreur stable à partir du statut HTTP et du message français.
 * Les codes retournés sont ceux demandés en priorité dans la spécification mobile.
 */
function inferErrorCode(status: number, message: string): string {
  const m = message.toLowerCase();

  // --- Wallet ---
  if (m.includes("solde insuffisant") || m.includes("insuffisant")) return "WALLET_INSUFFICIENT";
  if (m.includes("montant trop faible")) return "WALLET_AMOUNT_TOO_LOW";
  if (m.includes("montant invalide")) return "WALLET_INVALID_AMOUNT";

  // --- Courses ---
  if (m.includes("course introuvable")) return "RIDE_NOT_FOUND";
  if (m.includes("course déjà prise")) return "RIDE_ALREADY_TAKEN";
  if (m.includes("course en cours") && m.includes("déjà")) return "RIDE_DRIVER_BUSY";
  if (m.includes("course ne peut plus être annulée")) return "RIDE_CANCEL_FORBIDDEN";
  if (m.includes("code bouclier") && m.includes("incorrect")) return "RIDE_PICKUP_CODE_INVALID";
  if (m.includes("code d'arrivée incorrect")) return "RIDE_DROP_CODE_INVALID";
  if (m.includes("demande d'abord le code d'arrivée")) return "RIDE_DROP_CODE_MISSING";
  if (m.includes("pas assez de solde") && m.includes("course")) return "RIDE_CLIENT_INSUFFICIENT_BALANCE";
  if (m.includes("loin de la destination")) return "RIDE_DRIVER_NOT_AT_DESTINATION";
  if (m.includes("position du chauffeur") && m.includes("précise")) return "RIDE_DRIVER_LOCATION_IMPRECISE";
  if (m.includes("statut de la course a changé")) return "RIDE_STATUS_CHANGED";
  if (m.includes("demande d'arrêt est déjà en attente")) return "RIDE_STOP_REQUEST_PENDING";
  if (m.includes("demande d'arrêt a expiré")) return "RIDE_STOP_REQUEST_EXPIRED";
  if (m.includes("aucune demande d'arrêt")) return "RIDE_STOP_REQUEST_NONE";
  if (m.includes("arrêt anticipé est disponible uniquement")) return "RIDE_STOP_REQUEST_NOT_IN_PROGRESS";
  if (m.includes("l'itinéraire routier")) return "RIDE_ROUTE_UNAVAILABLE";
  if (m.includes("itinéraire n'est plus disponible")) return "RIDE_ROUTE_EXPIRED";
  if (m.includes("agence non activée")) return "AGENCY_NOT_ACTIVATED";
  if (m.includes("seul un chauffeur en route")) return "RIDE_ARRIVE_FORBIDDEN";
  if (m.includes("démarrage est interdit")) return "RIDE_START_FORBIDDEN";
  if (m.includes("code d'arrivée ne peut être demandé")) return "RIDE_DROP_CODE_FORBIDDEN";
  if (m.includes("seul l'autre participant peut accepter")) return "RIDE_STOP_REQUEST_SELF_ACCEPT";
  if (m.includes("seul l'auteur peut annuler")) return "RIDE_STOP_REQUEST_CANCEL_FORBIDDEN";
  if (m.includes("seul l'autre participant peut refuser")) return "RIDE_STOP_REQUEST_DECLINE_FORBIDDEN";

  // --- OTP / Auth ---
  if (m.includes("code invalide ou expiré")) return "OTP_INVALID_OR_EXPIRED";
  if (m.includes("code incorrect") && m.includes("essai")) return "OTP_WRONG_CODE";
  if (m.includes("trop de tentatives erronées")) return "OTP_TOO_MANY_ATTEMPTS";
  if (m.includes("trop de demandes de code")) return "OTP_TOO_MANY_REQUESTS";
  if (m.includes("numéro béninois invalide") || m.includes("numéro à 10 chiffres commence")) return "PHONE_INVALID";
  if (m.includes("compte suspendu")) return "ACCOUNT_BLOCKED";

  // --- Inscription / NPI ---
  if (m.includes("npi est déjà utilisé")) return "NPI_ALREADY_USED";
  if (m.includes("npi doit contenir")) return "NPI_INVALID_FORMAT";
  if (m.includes("inscription est déjà terminée") || m.includes("profil inscrit ne peut plus")) return "REGISTRATION_ALREADY_DONE";
  if (m.includes("trop de tentatives d'inscription")) return "REGISTRATION_TOO_MANY_ATTEMPTS";
  if (m.includes("compte introuvable")) return "USER_NOT_FOUND";
  if (m.includes("langue non supportée")) return "LANGUAGE_UNSUPPORTED";

  // --- Générique selon le statut HTTP ---
  if (status === HttpStatus.UNAUTHORIZED) return "UNAUTHORIZED";
  if (status === HttpStatus.FORBIDDEN) return "FORBIDDEN";
  if (status === HttpStatus.NOT_FOUND) return "NOT_FOUND";
  if (status === HttpStatus.CONFLICT) return "CONFLICT";
  if (status === HttpStatus.TOO_MANY_REQUESTS) return "TOO_MANY_REQUESTS";
  if (status === HttpStatus.SERVICE_UNAVAILABLE) return "SERVICE_UNAVAILABLE";
  return "INTERNAL_ERROR";
}
