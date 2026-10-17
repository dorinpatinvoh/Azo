import { useEffect } from "react";
import * as Location from "expo-location";
import { deliveryApi } from "../services/api";

/**
 * Envoie la position du client au serveur pendant sa commande de coursier ou de colis confirmée :
 * le coursier ou livreur peut ainsi suivre son déplacement sur sa carte. `deliveryId` à `null` = pas de suivi.
 */
export function useClientTracking(deliveryId: string | null) {
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
          { accuracy: Location.Accuracy.High, distanceInterval: 3, timeInterval: 4000 },
          (pos) => {
            const now = Date.now();
            if (now - lastSent < 3000) return;
            lastSent = now;
            deliveryApi
              .clientLocation(deliveryId, { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy ?? undefined })
              .catch(() => undefined);
          }
        );
        if (cancelled) sub.remove();
      } catch {
        // GPS indisponible : le coursier voit seulement le point de ramassage
      }
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [deliveryId]);
}
