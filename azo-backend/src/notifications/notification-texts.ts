/**
 * Textes des notifications dans la langue de l'utilisateur (`User.language` : fr, en, es, de).
 *
 * Le serveur compose la notification (titre + corps) au moment de l'envoi : la notification poussée sur le téléphone ET
 * la ligne enregistrée dans la boîte de réception sont donc dans la bonne langue. Les clés (`titleKey`, `bodyKey`)
 * restent enregistrées avec la notification.
 *
 * - Le français reste celui des appels d'envoi (aucun changement pour les utilisateurs francophones).
 * - Une clé inconnue, ou une langue non gérée, retombe sur le texte d'origine.
 * - `{nom}` est remplacé par le paramètre correspondant ; `[[ … {nom} … ]]` n'apparaît que si TOUS les paramètres
 *   qu'il contient sont renseignés (ex. la position dans une alerte SOS).
 */
export type Lang = "fr" | "en" | "es" | "de";
type Pair = { title?: string; body?: string };
type Entry = Record<Lang, Pair>;

const t = (title: string, body = ""): Pair => ({ title, body });

export const NOTIFICATION_TEXTS: Record<string, Entry> = {
  /* ---------- Courses ---------- */
  NOTIFICATION_RIDE_NEW_REQUEST: {
    fr: t("Nouvelle demande de course", "{vehicleLabel} · {price} FCFA — ouvre ton radar pour la prendre."),
    en: t("New ride request", "{vehicleLabel} · {price} FCFA — open your radar to take it."),
    es: t("Nueva solicitud de carrera", "{vehicleLabel} · {price} FCFA — abre tu radar para aceptarla."),
    de: t("Neue Fahrtanfrage", "{vehicleLabel} · {price} FCFA — öffne dein Radar, um sie anzunehmen."),
  },
  NOTIFICATION_RIDE_NO_DRIVER: {
    fr: t("Aucun chauffeur trouvé", "Ta demande est restée {minutes} min sans chauffeur disponible : elle a été annulée. Aucun montant n'a été débité — relance une recherche."),
    en: t("No driver found", "Your request waited {minutes} min without an available driver and was cancelled. Nothing was charged — start a new search."),
    es: t("No se encontró conductor", "Tu solicitud esperó {minutes} min sin conductor disponible y fue cancelada. No se cobró nada — vuelve a buscar."),
    de: t("Kein Fahrer gefunden", "Deine Anfrage wartete {minutes} Min. ohne verfügbaren Fahrer und wurde storniert. Es wurde nichts abgebucht — starte eine neue Suche."),
  },
  NOTIFICATION_RIDE_MATCHED: {
    fr: t("Chauffeur trouvé", "Un chauffeur a accepté ta course et arrive vers toi."),
    en: t("Driver found", "A driver accepted your ride and is on the way."),
    es: t("Conductor encontrado", "Un conductor aceptó tu carrera y va hacia ti."),
    de: t("Fahrer gefunden", "Ein Fahrer hat deine Fahrt angenommen und ist unterwegs zu dir."),
  },
  NOTIFICATION_RIDE_OFFERED: {
    fr: t("Un Spider a accepté ta course", "Touche pour voir son profil — il te reste {s} s."),
    en: t("A Spider accepted your ride", "Tap to see their profile — you have {s} s left."),
    es: t("Un Spider aceptó tu viaje", "Toca para ver su perfil — te quedan {s} s."),
    de: t("Ein Spider hat deine Fahrt angenommen", "Tippe, um sein Profil zu sehen — dir bleiben {s} s."),
  },
  NOTIFICATION_RIDE_APPROVED: {
    fr: t("Le client t'a choisi", "Rejoins le point de prise en charge."),
    en: t("The customer chose you", "Head to the pick-up point."),
    es: t("El cliente te eligió", "Ve al punto de recogida."),
    de: t("Der Kunde hat dich gewählt", "Fahre zum Abholpunkt."),
  },
  NOTIFICATION_RIDE_DECLINED: {
    fr: t("Le client a choisi un autre Spider.", "Tu peux accepter une autre demande."),
    en: t("The customer chose another Spider.", "You can accept another request."),
    es: t("El cliente eligió a otro Spider.", "Puedes aceptar otra solicitud."),
    de: t("Der Kunde hat einen anderen Spider gewählt.", "Du kannst eine andere Anfrage annehmen."),
  },
  NOTIFICATION_RIDE_WITHDRAWN: {
    fr: t("Le Spider a retiré sa proposition.", "Nous cherchons un autre Spider."),
    en: t("The Spider withdrew their offer.", "We are looking for another Spider."),
    es: t("El Spider retiró su propuesta.", "Buscamos otro Spider."),
    de: t("Der Spider hat sein Angebot zurückgezogen.", "Wir suchen einen anderen Spider."),
  },
  NOTIFICATION_RIDE_OFFER_EXPIRED: {
    fr: t("Le client n'a pas répondu à ta proposition.", "Tu peux accepter une autre demande."),
    en: t("The customer did not answer your offer.", "You can accept another request."),
    es: t("El cliente no respondió a tu propuesta.", "Puedes aceptar otra solicitud."),
    de: t("Der Kunde hat nicht auf dein Angebot geantwortet.", "Du kannst eine andere Anfrage annehmen."),
  },
  NOTIFICATION_RIDE_SCHEDULED_OPEN: {
    fr: t("Ta course programmée est ouverte", "Nous cherchons un chauffeur pour l'heure prévue."),
    en: t("Your scheduled ride is open", "We are looking for a driver for the planned time."),
    es: t("Tu carrera programada está abierta", "Buscamos un conductor para la hora prevista."),
    de: t("Deine geplante Fahrt ist geöffnet", "Wir suchen einen Fahrer für die geplante Zeit."),
  },
  NOTIFICATION_ZEM_ARRIVED: {
    fr: t("Ton Spider est arrivé", "Ton chauffeur est au point de prise en charge. Donne-lui le code Bouclier affiché dans l'application pour démarrer."),
    en: t("Your Spider has arrived", "Your driver is at the pick-up point. Give them the Shield code shown in the app to start."),
    es: t("Tu Spider ha llegado", "Tu conductor está en el punto de recogida. Dale el código Escudo que aparece en la aplicación para empezar."),
    de: t("Dein Spider ist da", "Dein Fahrer ist am Abholpunkt. Nenne ihm den in der App angezeigten Schild-Code, um zu starten."),
  },
  NOTIFICATION_DRIVER_ARRIVED: {
    fr: t("Ton chauffeur est arrivé", "Ton chauffeur est au point de prise en charge. Donne-lui le code Bouclier affiché dans l'application pour démarrer."),
    en: t("Your driver has arrived", "Your driver is at the pick-up point. Give them the Shield code shown in the app to start."),
    es: t("Tu conductor ha llegado", "Tu conductor está en el punto de recogida. Dale el código Escudo que aparece en la aplicación para empezar."),
    de: t("Dein Fahrer ist da", "Dein Fahrer ist am Abholpunkt. Nenne ihm den in der App angezeigten Schild-Code, um zu starten."),
  },
  NOTIFICATION_RIDE_STARTED: {
    fr: t("Course démarrée", "Ton chauffeur est en route vers la destination."),
    en: t("Ride started", "Your driver is heading to the destination."),
    es: t("Carrera iniciada", "Tu conductor va hacia el destino."),
    de: t("Fahrt gestartet", "Dein Fahrer ist auf dem Weg zum Ziel."),
  },
  NOTIFICATION_RIDE_DROP_CODE: {
    fr: t("Confirme ton arrivée", "Ton Spider demande le code d'arrivée. Donne-lui le code affiché dans l'application pour confirmer que tu es arrivé."),
    en: t("Confirm your arrival", "Your Spider asks for the arrival code. Give them the code shown in the app to confirm you have arrived."),
    es: t("Confirma tu llegada", "Tu Spider pide el código de llegada. Dale el código que aparece en la aplicación para confirmar que has llegado."),
    de: t("Bestätige deine Ankunft", "Dein Spider fragt nach dem Ankunftscode. Nenne ihm den in der App angezeigten Code, um deine Ankunft zu bestätigen."),
  },
  NOTIFICATION_RIDE_STOP_REQUEST: {
    fr: t("Demande d'arrêt de course", "L'autre participant demande d'arrêter la course ici."),
    en: t("Ride stop request", "The other participant asks to stop the ride here."),
    es: t("Solicitud de detener la carrera", "El otro participante pide detener la carrera aquí."),
    de: t("Anfrage zum Beenden der Fahrt", "Der andere Teilnehmer möchte die Fahrt hier beenden."),
  },
  NOTIFICATION_RIDE_STOP_UPDATED: {
    fr: t("Demande d'arrêt mise à jour"),
    en: t("Stop request updated"),
    es: t("Solicitud de parada actualizada"),
    de: t("Anfrage zum Beenden aktualisiert"),
  },
  NOTIFICATION_RIDE_STOP_ACCEPTED_BODY: {
    fr: t("", "Demande le code d'arrivée au client et saisis-le pour terminer la course."),
    en: t("", "Ask the customer for the arrival code and enter it to finish the ride."),
    es: t("", "Pide al cliente el código de llegada e introdúcelo para terminar la carrera."),
    de: t("", "Frag den Kunden nach dem Ankunftscode und gib ihn ein, um die Fahrt zu beenden."),
  },
  NOTIFICATION_RIDE_STOP_DECLINED_BODY: {
    fr: t("", "L'autre participant a refusé l'arrêt. La course continue."),
    en: t("", "The other participant declined the stop. The ride continues."),
    es: t("", "El otro participante rechazó la parada. La carrera continúa."),
    de: t("", "Der andere Teilnehmer hat das Beenden abgelehnt. Die Fahrt geht weiter."),
  },
  NOTIFICATION_RIDE_STOP_CANCELLED_BODY: {
    fr: t("", "La demande d'arrêt a été annulée."),
    en: t("", "The stop request was cancelled."),
    es: t("", "La solicitud de parada fue cancelada."),
    de: t("", "Die Anfrage zum Beenden wurde zurückgezogen."),
  },
  NOTIFICATION_RIDE_COMPLETED_CLIENT: {
    fr: t("Course terminée", "{amount} FCFA débités de ton portefeuille."),
    en: t("Ride completed", "{amount} FCFA debited from your wallet."),
    es: t("Carrera terminada", "{amount} FCFA descontados de tu monedero."),
    de: t("Fahrt beendet", "{amount} FCFA wurden von deinem Wallet abgebucht."),
  },
  NOTIFICATION_RIDE_COMPLETED_DRIVER: {
    fr: t("Paiement reçu", "Course {amount} FCFA · commission AZƆ̀ {pct} % débitée (−{commission} F) · tu reçois +{driverGain} FCFA."),
    en: t("Payment received", "Ride {amount} FCFA · AZƆ̀ commission {pct}% debited (−{commission} F) · you receive +{driverGain} FCFA."),
    es: t("Pago recibido", "Carrera {amount} FCFA · comisión AZƆ̀ {pct} % descontada (−{commission} F) · recibes +{driverGain} FCFA."),
    de: t("Zahlung erhalten", "Fahrt {amount} FCFA · AZƆ̀-Provision {pct} % abgezogen (−{commission} F) · du erhältst +{driverGain} FCFA."),
  },
  NOTIFICATION_DELIVERY_PAID_COURIER: {
    fr: t("Paiement reçu", "Livraison {amount} FCFA · commission AZƆ̀ {pct} % débitée (−{commission} F) · tu reçois +{net} FCFA."),
    en: t("Payment received", "Delivery {amount} FCFA · AZƆ̀ commission {pct}% debited (−{commission} F) · you receive +{net} FCFA."),
    es: t("Pago recibido", "Entrega {amount} FCFA · comisión AZƆ̀ {pct} % descontada (−{commission} F) · recibes +{net} FCFA."),
    de: t("Zahlung erhalten", "Lieferung {amount} FCFA · AZƆ̀-Provision {pct} % abgezogen (−{commission} F) · du erhältst +{net} FCFA."),
  },
  NOTIFICATION_RIDE_CANCELLED: {
    fr: t("Course annulée"),
    en: t("Ride cancelled"),
    es: t("Carrera cancelada"),
    de: t("Fahrt storniert"),
  },
  NOTIFICATION_RIDE_CANCELLED_BY_CLIENT_BODY: {
    fr: t("", "Le client a annulé la course."),
    en: t("", "The customer cancelled the ride."),
    es: t("", "El cliente canceló la carrera."),
    de: t("", "Der Kunde hat die Fahrt storniert."),
  },
  NOTIFICATION_RIDE_CANCELLED_BY_DRIVER_BODY: {
    fr: t("", "Ton chauffeur a annulé. Recherche d'un nouveau chauffeur…"),
    en: t("", "Your driver cancelled. Looking for a new driver…"),
    es: t("", "Tu conductor canceló. Buscando un nuevo conductor…"),
    de: t("", "Dein Fahrer hat storniert. Wir suchen einen neuen Fahrer…"),
  },

  /* ---------- Pourboire, compte, sécurité ---------- */
  NOTIFICATION_TIP_RECEIVED: {
    fr: t("Pourboire reçu", "{client} t'a envoyé un pourboire de {amount} FCFA."),
    en: t("Tip received", "{client} sent you a tip of {amount} FCFA."),
    es: t("Propina recibida", "{client} te envió una propina de {amount} FCFA."),
    de: t("Trinkgeld erhalten", "{client} hat dir ein Trinkgeld von {amount} FCFA geschickt."),
  },
  NOTIFICATION_PHONE_CHANGED: {
    fr: t("Numéro modifié", "Ton numéro de compte a été changé. Si tu n'es pas à l'origine de ce changement, contacte le support immédiatement."),
    en: t("Number changed", "Your account number was changed. If you did not make this change, contact support immediately."),
    es: t("Número modificado", "El número de tu cuenta fue cambiado. Si no fuiste tú, contacta con asistencia de inmediato."),
    de: t("Nummer geändert", "Die Nummer deines Kontos wurde geändert. Wenn du das nicht warst, kontaktiere sofort den Support."),
  },
  NOTIFICATION_IDENTITY_APPROVED: {
    fr: t("Correction d'identité approuvée", "Tes informations personnelles ont été mises à jour."),
    en: t("Identity correction approved", "Your personal information has been updated."),
    es: t("Corrección de identidad aprobada", "Tu información personal ha sido actualizada."),
    de: t("Identitätskorrektur genehmigt", "Deine persönlichen Daten wurden aktualisiert."),
  },
  NOTIFICATION_IDENTITY_REJECTED: {
    fr: t("Correction d'identité refusée", "Ta demande de correction a été refusée : {reason}"),
    en: t("Identity correction rejected", "Your correction request was rejected: {reason}"),
    es: t("Corrección de identidad rechazada", "Tu solicitud de corrección fue rechazada: {reason}"),
    de: t("Identitätskorrektur abgelehnt", "Deine Korrekturanfrage wurde abgelehnt: {reason}"),
  },

  /* ---------- SOS ---------- */
  NOTIFICATION_SOS_ADMIN_CLIENT: {
    fr: t("🚨 Alerte SOS", "Le client a déclenché l'alerte SOS pendant la course {ref}.[[ Position : {link}]]"),
    en: t("🚨 SOS alert", "The customer triggered the SOS alert during ride {ref}.[[ Location: {link}]]"),
    es: t("🚨 Alerta SOS", "El cliente activó la alerta SOS durante la carrera {ref}.[[ Ubicación: {link}]]"),
    de: t("🚨 SOS-Alarm", "Der Kunde hat während der Fahrt {ref} den SOS-Alarm ausgelöst.[[ Standort: {link}]]"),
  },
  NOTIFICATION_SOS_ADMIN_DRIVER: {
    fr: t("🚨 Alerte SOS", "Le chauffeur a déclenché l'alerte SOS pendant la course {ref}.[[ Position : {link}]]"),
    en: t("🚨 SOS alert", "The driver triggered the SOS alert during ride {ref}.[[ Location: {link}]]"),
    es: t("🚨 Alerta SOS", "El conductor activó la alerta SOS durante la carrera {ref}.[[ Ubicación: {link}]]"),
    de: t("🚨 SOS-Alarm", "Der Fahrer hat während der Fahrt {ref} den SOS-Alarm ausgelöst.[[ Standort: {link}]]"),
  },
  NOTIFICATION_SOS_PEER_CLIENT: {
    fr: t("Alerte de sécurité", "Le client a déclenché une alerte SOS. AZƆ̀ a été prévenu."),
    en: t("Safety alert", "The customer triggered an SOS alert. AZƆ̀ has been notified."),
    es: t("Alerta de seguridad", "El cliente activó una alerta SOS. AZƆ̀ ha sido avisado."),
    de: t("Sicherheitswarnung", "Der Kunde hat einen SOS-Alarm ausgelöst. AZƆ̀ wurde benachrichtigt."),
  },
  NOTIFICATION_SOS_PEER_DRIVER: {
    fr: t("Alerte de sécurité", "Le chauffeur a déclenché une alerte SOS. AZƆ̀ a été prévenu."),
    en: t("Safety alert", "The driver triggered an SOS alert. AZƆ̀ has been notified."),
    es: t("Alerta de seguridad", "El conductor activó una alerta SOS. AZƆ̀ ha sido avisado."),
    de: t("Sicherheitswarnung", "Der Fahrer hat einen SOS-Alarm ausgelöst. AZƆ̀ wurde benachrichtigt."),
  },

  /* ---------- Assistance ---------- */
  NOTIFICATION_SUPPORT_NEW: {
    fr: t("Nouvelle demande d'assistance", "{subject} ({category})"),
    en: t("New support request", "{subject} ({category})"),
    es: t("Nueva solicitud de asistencia", "{subject} ({category})"),
    de: t("Neue Support-Anfrage", "{subject} ({category})"),
  },
  NOTIFICATION_SUPPORT_USER_REPLY: {
    fr: t("Réponse d'un utilisateur", "{subject}"),
    en: t("Reply from a user", "{subject}"),
    es: t("Respuesta de un usuario", "{subject}"),
    de: t("Antwort eines Nutzers", "{subject}"),
  },
  NOTIFICATION_SUPPORT_REPLY: {
    fr: t("Réponse du support AZƆ̀", "{text}"),
    en: t("Reply from AZƆ̀ support", "{text}"),
    es: t("Respuesta del soporte AZƆ̀", "{text}"),
    de: t("Antwort vom AZƆ̀-Support", "{text}"),
  },
  NOTIFICATION_SUPPORT_CLOSED: {
    fr: t("Demande clôturée", "Ta demande « {subject} » a été clôturée."),
    en: t("Request closed", "Your request “{subject}” has been closed."),
    es: t("Solicitud cerrada", "Tu solicitud «{subject}» ha sido cerrada."),
    de: t("Anfrage geschlossen", "Deine Anfrage „{subject}“ wurde geschlossen."),
  },

  /* ---------- Agences ---------- */
  NOTIFICATION_AGENCY_FUND: {
    fr: t("Ton agence a rechargé ton compte", "+{amount} FCFA de l'agence {agency}."),
    en: t("Your agency topped up your account", "+{amount} FCFA from agency {agency}."),
    es: t("Tu agencia recargó tu cuenta", "+{amount} FCFA de la agencia {agency}."),
    de: t("Deine Agentur hat dein Konto aufgeladen", "+{amount} FCFA von der Agentur {agency}."),
  },
  NOTIFICATION_AGENCY_WITHDRAW: {
    fr: t("Ton agence a retiré de l'argent de ton compte", "-{amount} FCFA retirés par l'agence {agency}."),
    en: t("Your agency withdrew money from your account", "-{amount} FCFA withdrawn by agency {agency}."),
    es: t("Tu agencia retiró dinero de tu cuenta", "-{amount} FCFA retirados por la agencia {agency}."),
    de: t("Deine Agentur hat Geld von deinem Konto abgebucht", "-{amount} FCFA von der Agentur {agency} abgebucht."),
  },
  NOTIFICATION_AGENCY_ATTACHED: {
    fr: t("Rattachement à une agence", "Tu as été rattaché à l'agence {agency} (formule {plan})."),
    en: t("Linked to an agency", "You have been linked to agency {agency} ({plan} plan)."),
    es: t("Vinculado a una agencia", "Has sido vinculado a la agencia {agency} (plan {plan})."),
    de: t("Einer Agentur zugeordnet", "Du wurdest der Agentur {agency} zugeordnet (Tarif {plan})."),
  },
  NOTIFICATION_AGENCY_DETACHED: {
    fr: t("Fin du rattachement à une agence", "Tu ne fais plus partie de l'agence {agency}. Tu redeviens indépendant."),
    en: t("Agency link ended", "You are no longer part of agency {agency}. You are independent again."),
    es: t("Fin de la vinculación con una agencia", "Ya no formas parte de la agencia {agency}. Vuelves a ser independiente."),
    de: t("Agentur-Zuordnung beendet", "Du gehörst nicht mehr zur Agentur {agency}. Du bist wieder unabhängig."),
  },
  NOTIFICATION_AGENCY_ACTIVATED: {
    fr: t("Agence activée ✅", "{agency} est active ({plan} · {accounts} comptes · commission {commission} %)."),
    en: t("Agency activated ✅", "{agency} is active ({plan} · {accounts} accounts · commission {commission}%)."),
    es: t("Agencia activada ✅", "{agency} está activa ({plan} · {accounts} cuentas · comisión {commission} %)."),
    de: t("Agentur aktiviert ✅", "{agency} ist aktiv ({plan} · {accounts} Konten · Provision {commission} %)."),
  },
  NOTIFICATION_WALLET_RECHARGED: {
    fr: t("Compte rechargé", "+{amount} FCFA ajoutés à ton portefeuille AZƆ̀ Pay."),
    en: t("Account topped up", "+{amount} FCFA added to your AZƆ̀ Pay wallet."),
    es: t("Cuenta recargada", "+{amount} FCFA añadidos a tu monedero AZƆ̀ Pay."),
    de: t("Konto aufgeladen", "+{amount} FCFA wurden deinem AZƆ̀-Pay-Guthaben gutgeschrieben."),
  },
  NOTIFICATION_WALLET_RECHARGE_FAILED: {
    fr: t("Recharge non aboutie", "Ton paiement n'a pas abouti : aucun montant n'a été ajouté. Tu peux réessayer."),
    en: t("Top-up failed", "Your payment did not go through: nothing was added. You can try again."),
    es: t("Recarga no completada", "Tu pago no se completó: no se añadió nada. Puedes intentarlo de nuevo."),
    de: t("Aufladung fehlgeschlagen", "Deine Zahlung ist nicht durchgegangen: Es wurde nichts gutgeschrieben. Du kannst es erneut versuchen."),
  },
  NOTIFICATION_PROVIDER_DOC_VALID: {
    fr: t("Pièce validée", "{document} a été validée."),
    en: t("Document approved", "{document} has been approved."),
    es: t("Documento validado", "{document} ha sido validado."),
    de: t("Dokument bestätigt", "{document} wurde bestätigt."),
  },
  NOTIFICATION_PROVIDER_DOC_REFUSED: {
    fr: t("Pièce refusée", "{document} a été refusée[[ : {note}]]."),
    en: t("Document rejected", "{document} was rejected[[: {note}]]."),
    es: t("Documento rechazado", "{document} fue rechazado[[: {note}]]."),
    de: t("Dokument abgelehnt", "{document} wurde abgelehnt[[: {note}]]."),
  },
  NOTIFICATION_PROVIDER_REJECTED: {
    fr: t("Dossier refusé", "Ton dossier {type} a été refusé. Motif : {reason}"),
    en: t("Application rejected", "Your {type} application was rejected. Reason: {reason}"),
    es: t("Expediente rechazado", "Tu expediente {type} fue rechazado. Motivo: {reason}"),
    de: t("Antrag abgelehnt", "Dein Antrag {type} wurde abgelehnt. Grund: {reason}"),
  },
  NOTIFICATION_PROVIDER_NEED_INFO: {
    fr: t("Information manquante", "Ton dossier {type} est en attente : {reason}"),
    en: t("Information missing", "Your {type} application is on hold: {reason}"),
    es: t("Información faltante", "Tu expediente {type} está en espera: {reason}"),
    de: t("Angabe fehlt", "Dein Antrag {type} ist in Wartestellung: {reason}"),
  },
  NOTIFICATION_PROVIDER_APPROVED: {
    fr: t("Ton compte prestataire est actif 🎉", "AZƆ̀ a validé ton dossier {type}. Ton espace métier est ouvert."),
    en: t("Your provider account is active 🎉", "AZƆ̀ approved your {type} application. Your business space is open."),
    es: t("Tu cuenta de prestador está activa 🎉", "AZƆ̀ validó tu expediente {type}. Tu espacio profesional está abierto."),
    de: t("Dein Anbieterkonto ist aktiv 🎉", "AZƆ̀ hat deinen Antrag {type} bestätigt. Dein Geschäftsbereich ist geöffnet."),
  },
  NOTIFICATION_PROVIDER_SUSPENDED: {
    fr: t("Compte prestataire suspendu", "Ton accès métier est suspendu. Motif : {reason}"),
    en: t("Provider account suspended", "Your business access is suspended. Reason: {reason}"),
    es: t("Cuenta de prestador suspendida", "Tu acceso profesional está suspendido. Motivo: {reason}"),
    de: t("Anbieterkonto gesperrt", "Dein Geschäftszugang ist gesperrt. Grund: {reason}"),
  },
  NOTIFICATION_PROVIDER_REINSTATED: {
    fr: t("Compte prestataire réactivé", "Ta suspension est levée : ton espace métier est de nouveau accessible."),
    en: t("Provider account reinstated", "Your suspension is lifted: your business space is accessible again."),
    es: t("Cuenta de prestador reactivada", "Se levantó tu suspensión: tu espacio profesional vuelve a estar accesible."),
    de: t("Anbieterkonto reaktiviert", "Deine Sperre ist aufgehoben: Dein Geschäftsbereich ist wieder zugänglich."),
  },
  NOTIFICATION_DELIVERY_ASSIGNED: {
    fr: t("Coursier en route 📦", "Un coursier AZƆ̀ a accepté ta livraison vers {address}. Ouvre l'application pour voir le code de ramassage."),
    en: t("Courier on the way 📦", "An AZƆ̀ courier accepted your delivery to {address}. Open the app to see the pickup code."),
    es: t("Mensajero en camino 📦", "Un mensajero AZƆ̀ aceptó tu entrega a {address}. Abre la aplicación para ver el código de recogida."),
    de: t("Kurier unterwegs 📦", "Ein AZƆ̀-Kurier hat deine Lieferung nach {address} angenommen. Öffne die App, um den Abholcode zu sehen."),
  },
  NOTIFICATION_DELIVERY_PICKED_UP: {
    fr: t("Colis pris en charge ✅", "Le coursier a validé le code de ramassage et se dirige vers {address}. Ouvre l'application pour voir le code de remise."),
    en: t("Parcel picked up ✅", "The courier confirmed the pickup code and is heading to {address}. Open the app to see the handover code."),
    es: t("Paquete recogido ✅", "El mensajero validó el código de recogida y se dirige a {address}. Abre la aplicación para ver el código de entrega."),
    de: t("Paket abgeholt ✅", "Der Kurier hat den Abholcode bestätigt und fährt nach {address}. Öffne die App, um den Übergabecode zu sehen."),
  },
  NOTIFICATION_DELIVERY_DONE: {
    fr: t("Livraison terminée 🎉", "Ton colis à destination de {address} a bien été remis avec le code OTP."),
    en: t("Delivery completed 🎉", "Your parcel to {address} was handed over with the OTP code."),
    es: t("Entrega completada 🎉", "Tu paquete a {address} fue entregado con el código OTP."),
    de: t("Lieferung abgeschlossen 🎉", "Dein Paket nach {address} wurde mit dem OTP-Code übergeben."),
  },
  NOTIFICATION_DELIVERY_CANCELLED: {
    fr: t("Livraison annulée", "Le client a annulé la livraison vers {address}."),
    en: t("Delivery cancelled", "The customer cancelled the delivery to {address}."),
    es: t("Entrega cancelada", "El cliente canceló la entrega a {address}."),
    de: t("Lieferung storniert", "Der Kunde hat die Lieferung nach {address} storniert."),
  },
  NOTIFICATION_DELIVERY_REASSIGN: {
    fr: t("Recherche d'un nouveau coursier", "Le coursier a dû se désister. Ta livraison est reproposée aux coursiers disponibles."),
    en: t("Looking for a new courier", "The courier had to withdraw. Your delivery is offered again to available couriers."),
    es: t("Buscando un nuevo mensajero", "El mensajero tuvo que retirarse. Tu entrega se ofrece de nuevo a los mensajeros disponibles."),
    de: t("Neuer Kurier wird gesucht", "Der Kurier musste absagen. Deine Lieferung wird den verfügbaren Kurieren erneut angeboten."),
  },
  NOTIFICATION_SETTLEMENT_CONFIRM: {
    fr: t("Confirme ton arrivée", "Le Spider indique t'avoir déposé. Confirme dans {minutes} minutes ou signale un problème."),
    en: t("Confirm your arrival", "The driver says they dropped you off. Confirm within {minutes} minutes or report a problem."),
    es: t("Confirma tu llegada", "El conductor indica que te dejó. Confirma en {minutes} minutos o informa de un problema."),
    de: t("Bestätige deine Ankunft", "Der Fahrer meldet, dich abgesetzt zu haben. Bestätige innerhalb von {minutes} Minuten oder melde ein Problem."),
  },
  NOTIFICATION_SETTLEMENT_DISPUTE: {
    fr: t("Course en litige", "Le client a signalé un problème. Le paiement est suspendu."),
    en: t("Ride in dispute", "The customer reported a problem. Payment is on hold."),
    es: t("Carrera en disputa", "El cliente informó de un problema. El pago está suspendido."),
    de: t("Fahrt im Streitfall", "Der Kunde hat ein Problem gemeldet. Die Zahlung ist ausgesetzt."),
  },
};

export type NotificationParams = Record<string, string | number | boolean | null | undefined>;

/** Remplace `{nom}` par le paramètre ; supprime les segments `[[ … ]]` dont un paramètre est vide ou absent. */
export function interpolate(text: string, params: NotificationParams = {}): string {
  const has = (key: string) => params[key] !== undefined && params[key] !== null && String(params[key]) !== "";
  const withSegments = text.replace(/\[\[(.*?)\]\]/g, (_m, inner: string) => {
    const keys = [...inner.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    return keys.every(has) ? inner : "";
  });
  return withSegments.replace(/\{(\w+)\}/g, (_m, key: string) => (has(key) ? String(params[key]) : ""));
}

/**
 * Titre et corps traduits pour une langue, ou `null` pour ce qui n'a pas de traduction (l'appelant garde alors son texte).
 * Le corps vient de `bodyKey` s'il existe dans le catalogue, sinon du corps de `titleKey`.
 */
export function translateNotification(
  language: string | null | undefined,
  titleKey?: string,
  bodyKey?: string,
  params?: NotificationParams
): { title: string | null; body: string | null } {
  const lang = (["fr", "en", "es", "de"].includes(language ?? "") ? language : null) as Lang | null;
  if (!lang) return { title: null, body: null };
  const titleEntry = titleKey ? NOTIFICATION_TEXTS[titleKey]?.[lang] : undefined;
  const bodyEntry = bodyKey ? NOTIFICATION_TEXTS[bodyKey]?.[lang] : undefined;
  // Un « _BODY » sans entrée propre reprend le corps du message de base (« NOTIFICATION_X_BODY » → « NOTIFICATION_X »)
  const baseKey = bodyKey && bodyKey.endsWith("_BODY") ? bodyKey.slice(0, -5) : undefined;
  const baseEntry = baseKey ? NOTIFICATION_TEXTS[baseKey]?.[lang] : undefined;

  const title = titleEntry?.title ? interpolate(titleEntry.title, params) : null;
  const bodyText = bodyEntry?.body || baseEntry?.body || titleEntry?.body || "";
  const body = bodyText ? interpolate(bodyText, params) : null;
  return { title, body };
}
