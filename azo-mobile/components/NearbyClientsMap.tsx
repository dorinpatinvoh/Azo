import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { Ride } from "../services/api";
import { maskPersonName } from "../utils/phone";
import OSMMapView, { type LatLng, type OSMMarker } from "./OSMMapView";

type Props = {
  position: LatLng | null;
  heading?: number;
  requests: { ride: Ride; km: number | null }[];
  /** Nombre de clients disponibles (donné par le serveur, sinon compté ici). */
  count: number;
  radiusKm: number;
  gpsHint?: string | null;
};

/** Nom affiché sous le point du client : « Kossi A. » (serveur) ou nom masqué par l'application. */
export const clientLabel = (ride: Ride) => ride.client?.displayName || maskPersonName(ride.client?.fullName, "Client AZƆ̀");

/**
 * Carte du Zem « en ligne » : sa position et un point par client qui attend un Zem autour de lui,
 * avec le prénom du client. Le point d'un client est son point de départ demandé (sa position
 * GPS en direct reste privée tant qu'il ne t'a pas choisi).
 */
export default function NearbyClientsMap({ position, heading, requests, count, radiusKm, gpsHint }: Props) {
  const markers = useMemo<OSMMarker[]>(() => {
    const list: OSMMarker[] = requests.map(({ ride }) => ({
      id: ride.id,
      coordinate: { latitude: ride.originLat, longitude: ride.originLng },
      title: clientLabel(ride),
      color: "orange",
    }));
    if (position) list.push({ id: "driver", coordinate: position, title: "Moi", color: "blue", heading });
    return list;
  }, [requests, position, heading]);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.badge}>
          <Text style={styles.badgeValue}>{count}</Text>
        </View>
        <Text style={styles.headerText}>
          {count === 0
            ? `Aucun client disponible dans un rayon de ${radiusKm} km pour l'instant.`
            : count === 1
              ? `1 client disponible à moins de ${radiusKm} km de toi.`
              : `${count} clients disponibles à moins de ${radiusKm} km de toi.`}
        </Text>
      </View>
      <View style={styles.map}>
        <OSMMapView center={position ?? undefined} markers={markers} />
        {!position && !!gpsHint && (
          <View style={styles.hint}>
            <MaterialIcons name="gps-not-fixed" size={14} color={colors.onSurfaceVariant} />
            <Text style={styles.hintText}>{gpsHint}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.surfaceContainer, padding: spacing.sm, marginBottom: spacing.sm },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: 4, paddingBottom: spacing.sm },
  badge: { minWidth: 38, height: 38, paddingHorizontal: 8, borderRadius: 19, backgroundColor: colors.secondaryContainer, alignItems: "center", justifyContent: "center" },
  badgeValue: { ...typography.headlineSm, color: colors.onSecondaryFixed, fontWeight: "800" },
  headerText: { ...typography.labelLg, color: colors.onSurface, flex: 1, fontWeight: "700" },
  map: { height: 230, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.surfaceContainer },
  hint: { position: "absolute", left: 8, bottom: 8, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,0.92)", borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 },
  hintText: { ...typography.labelSm, color: colors.onSurfaceVariant },
});
