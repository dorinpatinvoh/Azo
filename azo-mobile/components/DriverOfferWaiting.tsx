import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { Ride } from "../services/api";
import { offerExpirySeconds } from "../config/radar";
import { clientLabel } from "./NearbyClientsMap";
import OSMMapView, { type LatLng, type OSMMarker } from "./OSMMapView";

type Props = { ride: Ride; busy: boolean; onWithdraw: () => void; position?: LatLng | null; heading?: number };

/**
 * Le Speeder a appuyé sur « Accepter » : le client regarde son profil avant de le choisir. Cet écran
 * affiche le compte à rebours et permet de retirer sa proposition. La course démarre dès que le
 * client confirme ; sinon la demande repart sur les radars.
 */
export default function DriverOfferWaiting({ ride, busy, onWithdraw, position, heading }: Props) {
  const [now, setNow] = useState(Date.now());
  const fallbackEnd = useRef(Date.now() + offerExpirySeconds() * 1000);
  const endsAt = useMemo(() => {
    const parsed = ride.offerExpiresAt ? Date.parse(ride.offerExpiresAt) : NaN;
    return Number.isNaN(parsed) ? fallbackEnd.current : parsed;
  }, [ride.offerExpiresAt]);
  const secondsLeft = Math.max(0, Math.ceil((endsAt - now) / 1000));

  // Sur la carte : le point de départ du client (à son nom), l'arrivée et ma position
  const markers = useMemo<OSMMarker[]>(() => {
    const list: OSMMarker[] = [
      { id: "origin", coordinate: { latitude: ride.originLat, longitude: ride.originLng }, title: `${clientLabel(ride)} · Départ`, color: "green" },
      { id: "destination", coordinate: { latitude: ride.destLat, longitude: ride.destLng }, title: "Arrivée", color: "red" },
    ];
    if (position) list.push({ id: "driver", coordinate: position, title: "Moi", color: "blue", heading });
    return list;
  }, [ride.originLat, ride.originLng, ride.destLat, ride.destLng, ride.client?.displayName, ride.client?.fullName, position, heading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <ActivityIndicator color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Proposition envoyée</Text>
          <Text style={styles.text}>
            {ride.offerSeenAt === null
              ? `En attente que ${clientLabel(ride)} ouvre l'application…`
              : `${clientLabel(ride)} regarde ton profil avant de te choisir. Reste sur cet écran.`}
          </Text>
        </View>
        <View style={[styles.timer, secondsLeft <= 10 && { backgroundColor: colors.errorContainer }]}>
          <MaterialIcons name="timer" size={14} color={secondsLeft <= 10 ? colors.error : colors.primary} />
          <Text style={[styles.timerText, secondsLeft <= 10 && { color: colors.error }]}>{secondsLeft} s</Text>
        </View>
      </View>
      <View style={styles.map}>
        <OSMMapView
          center={position ?? { latitude: ride.originLat, longitude: ride.originLng }}
          markers={markers}
          fitMarkerIds={["driver", "origin", "destination"]}
        />
      </View>
      <Pressable style={[styles.withdraw, busy && { opacity: 0.6 }]} onPress={onWithdraw} disabled={busy} accessibilityRole="button">
        <Text style={styles.withdrawText}>Annuler ma proposition</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.primaryFixed, borderRadius: radius.xl, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { ...typography.headlineSm, color: colors.onSurface },
  text: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  timer: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 5 },
  timerText: { ...typography.labelMd, color: colors.primary, fontWeight: "800" },
  map: { height: 210, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.surfaceContainer },
  withdraw: { height: 42, borderRadius: radius.full, backgroundColor: colors.surfaceContainerLowest, alignItems: "center", justifyContent: "center" },
  withdrawText: { ...typography.labelLg, color: colors.error, fontWeight: "700" },
});
