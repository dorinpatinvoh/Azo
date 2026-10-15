import { useEffect } from "react";
import * as Location from "expo-location";
import { deliveryApi } from "../services/api";

/**
 * Envoie la position du coursier au serveur pendant une course de coursier personnel (aller vers le client, puis course).
 * Le serveur cumule les kilomètres une fois le colis / le client pris en charge : c'est ce qui sert à calculer le prix final.
 * `deliveryId` à `null` = pas de suivi.
 */
export function useCourierTracking(deliveryId: string | null) {
  useEffect(() => {
    if (!deliveryId) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    let lastSent = 0;
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== "granted" || cancelled) return;
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 5, timeInterval: 4000 },
          (pos) => {
            const now = Date.now();
            if (now - lastSent < 3000) return;
            lastSent = now;
            deliveryApi
              .location(deliveryId, { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy ?? undefined })
              .catch(() => undefined);
          }
        );
        if (cancelled) sub.remove();
      } catch {
        // GPS indisponible : la course continue, le prix retombe sur la distance estimée
      }
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [deliveryId]);
}
