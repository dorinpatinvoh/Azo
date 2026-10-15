import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as Location from "expo-location";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import OSMMapView, { type LatLng, type OSMMarker } from "./OSMMapView";
import { getDrivingRoute } from "../services/routing";
import { Place, placesApi } from "../services/api";

const COTONOU: LatLng = { latitude: 6.3703, longitude: 2.3912 };

type Target = "pickup" | "drop";

type Props = {
  pickup: Place | null;
  drop: Place | null;
  onPickup: (p: Place | null) => void;
  onDrop: (p: Place | null) => void;
  pickupLabel?: string;
  dropLabel?: string;
  /** Distance de route (km) entre le départ et la destination, `null` tant qu'elle n'est pas connue. */
  onRouteKm?: (km: number | null) => void;
};

/** Champ d'adresse avec suggestions ; renvoie un lieu avec coordonnées. */
function AddressField({ label, place, onPick, active, onFocus }: { label: string; place: Place | null; onPick: (p: Place | null) => void; active: boolean; onFocus: () => void }) {
  const [text, setText] = useState(place?.title ?? "");
  const [results, setResults] = useState<Place[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // le lieu peut être posé depuis la carte ou par « ma position » : le champ suit
  useEffect(() => {
    if (place) setText(place.title);
  }, [place]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  function onChange(next: string) {
    setText(next);
    onPick(null);
    if (timer.current) clearTimeout(timer.current);
    if (next.trim().length < 3) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        setResults((await placesApi.search(next.trim())).slice(0, 5));
      } catch {
        setResults([]);
      }
    }, 350);
  }

  return (
    <View style={[styles.field, active && styles.fieldActive]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.fieldInput}
        value={text}
        onChangeText={onChange}
        onFocus={onFocus}
        placeholder="Rechercher une adresse ou toucher la carte"
        placeholderTextColor={colors.outline}
      />
      {results.map((p, i) => (
        <Pressable
          key={`${p.title}-${i}`}
          style={styles.result}
          onPress={() => {
            setText(p.title);
            setResults([]);
            onPick(p);
          }}
        >
          <MaterialIcons name="place" size={18} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.resultTitle} numberOfLines={1}>{p.title}</Text>
            {p.subtitle ? <Text style={styles.resultSub} numberOfLines={1}>{p.subtitle}</Text> : null}
          </View>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * Carte + champs « Départ » / « Destination » : on tape une adresse, on touche la carte, ou on utilise sa position GPS.
 * Le départ est rempli automatiquement avec la position du téléphone.
 */
export default function PlacePickerMap({ pickup, drop, onPickup, onDrop, pickupLabel = "Point de départ", dropLabel = "Destination", onRouteKm }: Props) {
  const [target, setTarget] = useState<Target>("pickup");
  const [locating, setLocating] = useState(false);
  const [me, setMe] = useState<LatLng | null>(null);
  const autoDone = useRef(false);

  const setFromCoord = useCallback(
    async (coord: LatLng, which: Target) => {
      let title = "Position choisie sur la carte";
      try {
        const r = await placesApi.reverseGeocode(coord.latitude, coord.longitude);
        if (r.address) title = r.address;
      } catch {
        // on garde le libellé par défaut : les coordonnées suffisent pour le prix et le suivi
      }
      const place: Place = { title, latitude: coord.latitude, longitude: coord.longitude };
      if (which === "pickup") {
        onPickup(place);
        setTarget("drop");
      } else {
        onDrop(place);
      }
    },
    [onPickup, onDrop]
  );

  const locate = useCallback(async () => {
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") return;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coord = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      setMe(coord);
      await setFromCoord(coord, "pickup");
    } catch {
      // GPS indisponible : on peut toujours taper l'adresse ou toucher la carte
    } finally {
      setLocating(false);
    }
  }, [setFromCoord]);

  // Départ = position actuelle, dès l'ouverture
  useEffect(() => {
    if (autoDone.current || pickup) return;
    autoDone.current = true;
    locate();
  }, [pickup, locate]);

  // Itinéraire routier entre le départ et la destination, dès que les deux sont connus
  const [route, setRoute] = useState<LatLng[] | undefined>(undefined);
  useEffect(() => {
    if (!pickup || !drop) {
      setRoute(undefined);
      onRouteKm?.(null);
      return;
    }
    const controller = new AbortController();
    getDrivingRoute({ latitude: pickup.latitude, longitude: pickup.longitude }, { latitude: drop.latitude, longitude: drop.longitude }, controller.signal)
      .then((r) => {
        setRoute(r.coordinates);
        onRouteKm?.(r.distanceKm);
      })
      .catch(() => {
        setRoute(undefined);
        onRouteKm?.(null);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup?.latitude, pickup?.longitude, drop?.latitude, drop?.longitude]);

  const markers: OSMMarker[] = [];
  if (me) markers.push({ id: "me", coordinate: me, title: "Ma position", color: "blue" });
  if (pickup) markers.push({ id: "pickup", coordinate: { latitude: pickup.latitude, longitude: pickup.longitude }, title: "Départ", color: "green" });
  if (drop) markers.push({ id: "drop", coordinate: { latitude: drop.latitude, longitude: drop.longitude }, title: "Destination", color: "red" });

  const center = (target === "drop" ? drop : pickup) ?? pickup ?? drop ?? me ?? COTONOU;
  const centerCoord: LatLng = "latitude" in center ? { latitude: center.latitude, longitude: center.longitude } : COTONOU;

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.map}>
        <OSMMapView center={centerCoord} markers={markers} polyline={route} fitMarkerIds={pickup && drop ? ["pickup", "drop"] : undefined} zoom={15} onPress={(c) => setFromCoord(c, target)} />
        <Pressable style={styles.locateBtn} onPress={locate} accessibilityLabel="Ma position">
          {locating ? <ActivityIndicator size="small" color={colors.primary} /> : <MaterialIcons name="my-location" size={22} color={colors.primary} />}
        </Pressable>
      </View>

      <AddressField label={pickupLabel} place={pickup} onPick={onPickup} active={target === "pickup"} onFocus={() => setTarget("pickup")} />
      <AddressField label={dropLabel} place={drop} onPick={onDrop} active={target === "drop"} onFocus={() => setTarget("drop")} />
    </View>
  );
}

const styles = StyleSheet.create({
  map: { height: 260, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.surfaceContainerLow },
  locateBtn: { position: "absolute", right: 10, bottom: 10, width: 44, height: 44, borderRadius: 22, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", elevation: 3 },
  targetRow: { flexDirection: "row", gap: spacing.sm },
  targetChip: { flex: 1, paddingVertical: 8, paddingHorizontal: 6, borderRadius: radius.full, backgroundColor: colors.surfaceContainerLow, alignItems: "center" },
  targetChipActive: { backgroundColor: colors.primary },
  targetText: { ...typography.labelSm, color: colors.onSurfaceVariant, fontWeight: "700", textAlign: "center" },
  targetTextActive: { color: colors.onPrimary },
  field: { backgroundColor: colors.surfaceContainerLow, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1.5, borderColor: "transparent" },
  fieldActive: { borderColor: colors.primary },
  fieldLabel: { ...typography.labelSm, color: colors.outline, textTransform: "uppercase" },
  fieldInput: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700", paddingVertical: 6 },
  result: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.surfaceContainerHigh },
  resultTitle: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  resultSub: { ...typography.bodySm, color: colors.onSurfaceVariant },
});
