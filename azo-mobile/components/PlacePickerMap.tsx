import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { POPULAR_PLACES } from "../config/quickPlaces";
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
  const [noResult, setNoResult] = useState(false);
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
    setNoResult(false);
    if (next.trim().length < 3) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const found = (await placesApi.search(next.trim())).slice(0, 6);
        setResults(found);
        setNoResult(found.length === 0);
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
      {noResult && results.length === 0 ? <Text style={styles.resultSub}>Quartier introuvable ? Touche la carte pour poser le point exactement, même dans un village reculé.</Text> : null}
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

  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => setKeyboardHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const applyPopular = (p: Place) => {
    const place: Place = { title: p.title, latitude: p.latitude, longitude: p.longitude };
    if (target === "pickup") {
      onPickup(place);
      setTarget("drop");
    } else {
      onDrop(place);
    }
  };

  return (
    <View style={{ gap: spacing.sm }}>
      {/* Aperçu : un appui ouvre la carte plein écran, comme pour commander une course */}
      <View style={styles.map}>
        <OSMMapView center={centerCoord} markers={markers} polyline={route} fitMarkerIds={pickup && drop ? ["pickup", "drop"] : undefined} zoom={15} />
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(true)} accessibilityLabel="Ouvrir la carte" />
        <View style={styles.openChip} pointerEvents="none">
          <MaterialIcons name="open-in-full" size={16} color={colors.primary} />
          <Text style={styles.openChipText}>Choisir sur la carte</Text>
        </View>
      </View>
      <Pressable style={[styles.summary, !pickup && styles.summaryEmpty]} onPress={() => { setTarget("pickup"); setOpen(true); }}>
        <View style={[styles.dot, { backgroundColor: "#2e7d32" }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>{pickupLabel}</Text>
          <Text style={styles.summaryText} numberOfLines={2}>{pickup?.title ?? "Choisir le départ"}</Text>
        </View>
      </Pressable>
      <Pressable style={[styles.summary, !drop && styles.summaryEmpty]} onPress={() => { setTarget("drop"); setOpen(true); }}>
        <View style={[styles.dot, { backgroundColor: "#b3261b" }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>{dropLabel}</Text>
          <Text style={styles.summaryText} numberOfLines={2}>{drop?.title ?? "Choisir la destination"}</Text>
        </View>
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.full}>
          <OSMMapView center={centerCoord} markers={markers} polyline={route} fitMarkerIds={pickup && drop ? ["pickup", "drop"] : undefined} zoom={15} onPress={(c) => setFromCoord(c, target)} />
          <Pressable style={[styles.backBtn, { top: insets.top + 8 }]} onPress={() => setOpen(false)} accessibilityLabel="Retour">
            <MaterialIcons name="arrow-back" size={24} color={colors.onSurface} />
          </Pressable>
          <View style={[styles.pickHint, { top: insets.top + 8 }]}>
            <Text style={styles.pickHintText}>{target === "pickup" ? "Touche la carte pour poser le départ" : "Touche la carte pour poser la destination"}</Text>
          </View>
          <Pressable style={[styles.locateBtnFull, { bottom: keyboardHeight > 0 ? keyboardHeight + 24 : "46%" }]} onPress={locate} accessibilityLabel="Ma position">
            {locating ? <ActivityIndicator size="small" color={colors.primary} /> : <MaterialIcons name="my-location" size={22} color={colors.primary} />}
          </Pressable>
          <View style={[styles.sheet, { bottom: keyboardHeight, paddingBottom: keyboardHeight > 0 ? spacing.sm : insets.bottom + spacing.md, maxHeight: keyboardHeight > 0 ? "85%" : "58%" }]}>
            <View style={styles.sheetHandle} />
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.sheetTitle}>Où allons-nous ?</Text>
              <AddressField label={pickupLabel} place={pickup} onPick={onPickup} active={target === "pickup"} onFocus={() => setTarget("pickup")} />
              <AddressField label={dropLabel} place={drop} onPick={onDrop} active={target === "drop"} onFocus={() => setTarget("drop")} />
              <Text style={styles.popularLabel}>Lieux populaires</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, paddingBottom: 6 }}>
                {POPULAR_PLACES.map((p) => (
                  <Pressable key={p.id} style={styles.popularChip} onPress={() => applyPopular(p)}>
                    <MaterialIcons name="place" size={15} color={colors.primary} />
                    <Text style={styles.popularText}>{p.title}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Pressable style={styles.doneBtn} onPress={() => setOpen(false)}>
                <Text style={styles.doneText}>{pickup && drop ? "Valider les lieux" : "Terminer"}</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
const styles = StyleSheet.create({
  map: { height: 190, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.surfaceContainerLow },
  openChip: { position: "absolute", right: 10, bottom: 10, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fff", paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.full, elevation: 3 },
  openChipText: { ...typography.labelMd, color: colors.primary, fontWeight: "800" },
  summary: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surfaceContainerLow, borderRadius: radius.lg, padding: spacing.md },
  summaryEmpty: { borderWidth: 1.5, borderColor: colors.primary },
  summaryText: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700", marginTop: 2 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  full: { flex: 1, backgroundColor: colors.surface },
  backBtn: { position: "absolute", left: spacing.md, width: 44, height: 44, borderRadius: 22, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", elevation: 4 },
  pickHint: { position: "absolute", left: 72, right: spacing.md, backgroundColor: colors.onSurface, borderRadius: radius.lg, padding: spacing.sm },
  pickHintText: { ...typography.labelMd, color: "#fff", textAlign: "center" },
  locateBtnFull: { position: "absolute", right: spacing.md, width: 48, height: 48, borderRadius: 24, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", elevation: 5 },
  sheet: { position: "absolute", left: 0, right: 0, backgroundColor: colors.surfaceContainerLowest, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: spacing.md, paddingTop: 10, elevation: 12 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.surfaceContainerHigh, alignSelf: "center", marginBottom: 10 },
  sheetTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800", marginBottom: spacing.sm },
  popularLabel: { ...typography.labelSm, color: colors.onSurfaceVariant, textTransform: "uppercase", marginTop: spacing.sm, marginBottom: 6 },
  popularChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.primaryFixed, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.full },
  popularText: { ...typography.labelMd, color: colors.primary, fontWeight: "700", fontSize: 12 },
  doneBtn: { marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: "center" },
  doneText: { ...typography.labelLg, color: colors.onPrimary, fontWeight: "800" },
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
