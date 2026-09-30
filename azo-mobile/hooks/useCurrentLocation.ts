import { useCallback, useEffect, useState } from "react";
import * as Location from "expo-location";
import { errorMessage, placesApi } from "../services/api";

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
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
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
