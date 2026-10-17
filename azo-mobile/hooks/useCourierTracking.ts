import { useEffect } from "react";
import * as Location from "expo-location";
import { deliveryApi } from "../services/api";

/**
 * Envoie la position du coursier ou du livreur au serveur pendant sa mission (aller vers le client, puis mission).
 * Le serveur cumule les kilomètres une fois le colis / le client pris en charge, avec la vitesse mesurée par le téléphone
 * (comme pour une course simple) : c'est ce qui sert à calculer le prix final d'un coursier personnel.
 * `onProgress` reçoit les mètres parcourus renvoyés par le serveur, pour un compteur en direct. `deliveryId` à `null` = pas de suivi.
 */
export function useCourierTracking(deliveryId: string | null, onProgress?: (traveledMeters: number) => void) {
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
          { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 1, timeInterval: 1500 },
          (pos) => {
            const now = Date.now();
            if (now - lastSent < 1500) return;
            lastSent = now;
            const speed = typeof pos.coords.speed === "number" && pos.coords.speed >= 0 ? pos.coords.speed : undefined;
            deliveryApi
              .location(deliveryId, {
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracy: pos.coords.accuracy ?? undefined,
                ...(speed !== undefined ? { speed } : {}),
              })
              .then((r) => {
                if (!cancelled && typeof r?.traveledMeters === "number") onProgress?.(r.traveledMeters);
              })
              .catch(() => undefined);
          }
        );
        if (cancelled) sub.remove();
      } catch {
        // GPS indisponible : la mission continue, le prix retombe sur la distance estimée
      }
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveryId]);
}
