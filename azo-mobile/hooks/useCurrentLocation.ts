import { useCallback, useEffect, useState } from "react";
import * as Location from "expo-location";
import { errorMessage, placesApi } from "../services/api";

/**
 * Position la plus PRÉCISE possible : le mode « équilibré » s'appuie sur le Wi-Fi et les antennes et se trompe de plusieurs dizaines de mètres.
 * On accepte le dernier point connu s'il est récent (30 s) et précis (30 m), sinon on écoute le GPS jusqu'à 7 s et on garde le meilleur point
 * (arrêt dès qu'il est précis à 20 m).
 */
async function bestFix(): Promise<Location.LocationObject> {
  const quick = await Location.getLastKnownPositionAsync({ maxAge: 30_000, requiredAccuracy: 30 }).catch(() => null);
  if (quick) return quick;
  const best = await new Promise<Location.LocationObject | null>((resolve) => {
    let found: Location.LocationObject | null = null;
    let sub: Location.LocationSubscription | null = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      sub?.remove();
      resolve(found);
    };
    Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 500, distanceInterval: 0 }, (pos) => {
      if (!found || (pos.coords.accuracy ?? 999) < (found.coords.accuracy ?? 999)) found = pos;
      if ((pos.coords.accuracy ?? 999) <= 20) finish();
    })
      .then((s) => {
        sub = s;
        if (done) s.remove();
      })
      .catch(finish);
    setTimeout(finish, 7000);
  });
  return best ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }));
}

export type GpsStatus = "loading" | "ready" | "denied" | "error";

export function useCurrentLocation() {
  const [status, setStatus] = useState<GpsStatus>("loading");
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canAskAgain, setCanAskAgain] = useState(true);

  const refresh = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      setCanAskAgain(perm.canAskAgain);
      if (perm.status !== "granted") {
        setStatus("denied");
        return;
      }
      if (!(await Location.hasServicesEnabledAsync())) {
        setStatus("error");
        setError("Le GPS est désactivé. Active la localisation de ton téléphone.");
        return;
      }
      const pos = await bestFix();
      const c = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      setCoords(c);
      setAddress(null);
      setStatus("ready");
      try {
        const r = await placesApi.reverseGeocode(c.latitude, c.longitude);
        setAddress(r.address);
      } catch {
        setAddress("Ma position actuelle"); // le GPS marche même si le géocodage échoue
      }
    } catch (e) {
      setStatus("error");
      setError(errorMessage(e) || "Impossible d'obtenir ta position.");
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { status, coords, address, error, canAskAgain, refresh };
}
