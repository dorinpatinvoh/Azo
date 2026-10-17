import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { deliveryApi } from "../services/api";

/**
 * Commande de colis ou de coursier du client déjà confirmée (coursier en route ou en mission) : renvoie son identifiant pour que
 * la position du client soit partagée avec le coursier, quel que soit l'écran affiché. Relecture toutes les 15 s et au retour au premier plan.
 */
export function useActiveClientDelivery(enabled: boolean): string | null {
  const [id, setId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await deliveryApi.mine();
      const active = list.find((d) => d.status === "MATCHED" || d.status === "IN_PROGRESS");
      setId(active ? active.id : null);
    } catch {
      // réseau coupé : on garde l'état précédent
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setId(null);
      return;
    }
    refresh();
    const timer = setInterval(refresh, 15000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [enabled, refresh]);

  return id;
}
