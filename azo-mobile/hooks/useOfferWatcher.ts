import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { io } from "socket.io-client";
import { API_URL, Ride, getToken, ridesApi } from "../services/api";

/**
 * Surveille la demande en cours du client pour lui montrer, PAR-DESSUS n'importe quel écran, la proposition
 * d'un Spider (statut OFFERED) : il n'a que quelques secondes pour regarder son profil et décider.
 *
 * Trois chemins qui se complètent (voir PROJECT_SUMMARY/DEMANDE_BACKEND_POPUP_PROPOSITION_ZEM.md) :
 *   1. événement temps réel `ride:offered` sur un socket maintenu tant que le client est connecté ;
 *   2. relecture de la course toutes les 3 s tant qu'on la surveille (secours si le serveur n'envoie pas l'événement) ;
 *   3. rattrapage `GET /rides/offers/pending` au démarrage, à la reconnexion et au retour au premier plan.
 *
 * `suppressed` : l'écran de suivi montre déjà la proposition dans sa page, pas de popup en plus.
 */
export function useOfferWatcher(enabled: boolean, suppressed: boolean) {
  const [offer, setOffer] = useState<Ride | null>(null);
  const [watchId, setWatchId] = useState<string | null>(null);

  const check = useCallback(async (rideId: string) => {
    try {
      const ride = await ridesApi.get(rideId);
      if (ride.status === "OFFERED") {
        setOffer((prev) => (prev && prev.id === ride.id ? { ...prev, ...ride } : ride));
        return;
      }
      setOffer((prev) => (prev && prev.id === ride.id ? null : prev));
      // Tant que la demande cherche encore un chauffeur on continue ; sinon (confirmée, terminée, annulée) on arrête
      if (ride.status !== "PENDING") setWatchId((current) => (current === rideId ? null : current));
    } catch {
      // réseau coupé : on réessaie au prochain cycle
    }
  }, []);

  // Rattrapage : une proposition en attente qu'on n'a pas vue arriver (application fermée, hors ligne…)
  const catchUp = useCallback(async () => {
    try {
      const res = await ridesApi.pendingOffers();
      const first = res.offers?.[0];
      if (first?.rideId) {
        setWatchId(first.rideId);
        check(first.rideId);
      }
    } catch {
      // route absente (serveur pas à jour) : la relecture de secours prend le relais
    }
  }, [check]);

  const watchIdRef = useRef(watchId);
  watchIdRef.current = watchId;

  // Relecture de secours toutes les 3 s
  useEffect(() => {
    if (!enabled || suppressed || !watchId) return;
    check(watchId);
    const timer = setInterval(() => check(watchId), 3000);
    return () => clearInterval(timer);
  }, [enabled, suppressed, watchId, check]);

  // Au démarrage de la session
  useEffect(() => {
    if (enabled) catchUp();
  }, [enabled, catchUp]);

  // Retour au premier plan
  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      catchUp();
      if (watchIdRef.current) check(watchIdRef.current);
    });
    return () => sub.remove();
  }, [enabled, catchUp, check]);

  // Temps réel
  useEffect(() => {
    if (!enabled) return;
    const socket = io(API_URL, { transports: ["websocket"], auth: { token: getToken() } });
    socket.on("connect", catchUp);
    socket.on("ride:offered", (payload: { rideId?: string }) => {
      if (!payload?.rideId) return;
      setWatchId(payload.rideId);
      check(payload.rideId);
    });
    socket.on("ride:offer-ended", (payload: { rideId?: string }) => {
      if (payload?.rideId) setOffer((prev) => (prev && prev.id === payload.rideId ? null : prev));
    });
    return () => {
      socket.disconnect();
    };
  }, [enabled, catchUp, check]);

  const dismiss = useCallback(() => setOffer(null), []);

  return { offer: suppressed ? null : offer, dismiss, watch: setWatchId, check };
}
