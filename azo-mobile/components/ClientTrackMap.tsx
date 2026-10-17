import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import OSMMapView, { type OSMMarker } from "./OSMMapView";
import { deliveryApi, type DeliveryTrack } from "../services/api";

type Props = {
  deliveryId: string;
  /** Point de ramassage, toujours affiché même si le client ne partage pas encore sa position. */
  pickup?: { latitude: number; longitude: number } | null;
  /** Ma propre position (coursier). */
  me?: { latitude: number; longitude: number } | null;
};

/** Carte du coursier : où se trouve son client (position envoyée par son téléphone), le point de ramassage et lui-même. */
export default function ClientTrackMap({ deliveryId, pickup, me }: Props) {
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

  const client = track && track.clientLat != null && track.clientLng != null ? { latitude: track.clientLat, longitude: track.clientLng } : null;
  const center = client ?? pickup ?? me ?? null;
  if (!center) return null;
  const markers: OSMMarker[] = [
    ...(client ? [{ id: "client", coordinate: client, title: "Ton client", color: "green" } as OSMMarker] : []),
    ...(pickup ? [{ id: "pickup", coordinate: pickup, title: "Ramassage", color: "orange" } as OSMMarker] : []),
    ...(me ? [{ id: "me", coordinate: me, title: "Moi", color: "blue" } as OSMMarker] : []),
  ];
  return (
    <View style={styles.wrap}>
      <View style={styles.map}>
        <OSMMapView center={center} zoom={15} markers={markers} followMarkerId={client ? "client" : undefined} />
      </View>
      <Text style={styles.note}>{client ? "Ton client est suivi en direct." : "En attente de la position de ton client…"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  map: { height: 190, borderRadius: radius.lg, overflow: "hidden" },
  note: { ...typography.bodySm, color: colors.onSurfaceVariant },
});
