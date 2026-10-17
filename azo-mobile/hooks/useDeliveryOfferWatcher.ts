import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { io } from "socket.io-client";
import { API_URL, DeliveryOffer, deliveryApi, getToken } from "../services/api";

/**
 * Surveille les propositions de coursiers et livreurs pour les commandes du client : la popup s'affiche PAR-DESSUS
 * n'importe quel écran, le client regarde le profil et décide. Deux chemins qui se complètent :
 *   1. événements temps réel `delivery:offered` / `delivery:offer-ended` sur un socket maintenu tant que le client est connecté ;
 *   2. relecture de `GET /deliveries/offers/pending` au démarrage, au retour au premier plan, à la reconnexion et toutes les 6 s.
 */
export function useDeliveryOfferWatcher(enabled: boolean) {
  const [offer, setOffer] = useState<DeliveryOffer | null>(null);
  const dismissedRef = useRef<Set<string>>(new Set());

  const catchUp = useCallback(async () => {
    try {
      const res = await deliveryApi.pendingOffers();
      const first = res.offers?.find((o) => !dismissedRef.current.has(o.deliveryId)) ?? null;
      setOffer((prev) => {
        if (!first) return prev && res.offers?.some((o) => o.deliveryId === prev.deliveryId) ? prev : null;
        return prev && prev.deliveryId === first.deliveryId ? prev : first;
      });
    } catch {
      // serveur pas à jour ou réseau coupé : on réessaie au prochain cycle
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    catchUp();
    const timer = setInterval(catchUp, 6000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") catchUp();
    });
    const socket = io(API_URL, { transports: ["websocket"], auth: { token: getToken() } });
    socket.on("connect", catchUp);
    socket.on("delivery:offered", (payload: DeliveryOffer) => {
      if (payload?.deliveryId) {
        dismissedRef.current.delete(payload.deliveryId);
        setOffer(payload);
      }
    });
    socket.on("delivery:offer-ended", (payload: { deliveryId?: string }) => {
      if (payload?.deliveryId) setOffer((prev) => (prev && prev.deliveryId === payload.deliveryId ? null : prev));
    });
    return () => {
      clearInterval(timer);
      sub.remove();
      socket.disconnect();
    };
  }, [enabled, catchUp]);

  const dismiss = useCallback(() => {
    setOffer((prev) => {
      if (prev) dismissedRef.current.add(prev.deliveryId);
      return null;
    });
  }, []);

  return { offer, dismiss };
}
