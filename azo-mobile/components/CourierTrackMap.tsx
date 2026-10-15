import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import OSMMapView from "./OSMMapView";
import { deliveryApi, type DeliveryTrack } from "../services/api";

/** Carte en direct du coursier personnel + kilomètres déjà parcourus (affichés au client). */
export default function CourierTrackMap({ deliveryId, perKm }: { deliveryId: string; perKm?: number }) {
  const [track, setTrack] = useState<DeliveryTrack | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      deliveryApi
        .track(deliveryId)
        .then((t) => alive && setTrack(t))
        .catch(() => undefined);
    load();
    const timer = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [deliveryId]);

  const located = track && track.courierLat != null && track.courierLng != null;
  const km = (track?.traveledMeters ?? 0) / 1000;

  return (
    <View style={styles.wrap}>
      {located ? (
        <View style={styles.map}>
          <OSMMapView
            center={{ latitude: track!.courierLat!, longitude: track!.courierLng! }}
            markers={[{ id: "courier", coordinate: { latitude: track!.courierLat!, longitude: track!.courierLng! }, title: "Ton coursier", color: "green" }]}
            followMarkerId="courier"
            zoom={16}
          />
        </View>
      ) : (
        <View style={[styles.map, styles.waiting]}>
          <Text style={styles.waitText}>En attente de la position de ton coursier…</Text>
        </View>
      )}
      <Text style={styles.km}>
        {km.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km parcourus{perKm ? ` · ${perKm.toLocaleString("fr-FR")} F / km` : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  map: { height: 190, borderRadius: radius.lg, overflow: "hidden" },
  waiting: { backgroundColor: colors.surfaceContainerLow, alignItems: "center", justifyContent: "center" },
  waitText: { ...typography.bodySm, color: colors.onSurfaceVariant },
  km: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
});
