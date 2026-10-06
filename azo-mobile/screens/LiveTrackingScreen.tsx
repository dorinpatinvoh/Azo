import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Animated, Easing, Linking, Alert } from "react-native";
import OSMMapView, { OSMMarker } from "../components/OSMMapView";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { io } from "socket.io-client";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { API_URL, Ride, RideStatus, VehicleType, errorMessage, getToken, rideApi } from "../services/api";
import RideChatModal from "../components/RideChatModal";
import { maskBeninPhone, maskPersonName, rideSecurityPin } from "../utils/phone";

type Props = { rideId: string; destinationLabel?: string; onClose: () => void; onFinish?: () => void };
type LatLng = { latitude: number; longitude: number };

const POLL_MS = 3000;
const ERROR_COLOR = "#B3261B";
const STATUS_TEXT: Record<RideStatus, string> = {
  PENDING: "Recherche d'un chauffeur…",
  MATCHED: "Ton chauffeur arrive",
  IN_PROGRESS: "Course en cours",
  COMPLETED: "Course terminée",
  CANCELLED: "Course annulée",
};
const VEHICLE_LABEL: Record<VehicleType, string> = {
  ZEM_ESSENCE: "Zem à essence",
  ZEM_ELECTRIC: "Zem électrique",
  GAZELLE: "Gazelle · Voiture",
  KOALA: "Koala · Voiture climatisée",
  LEOPARD: "Léopard · Berline premium climatisée",
};

function distanceKm(a: LatLng, b: LatLng) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(r(b.longitude - a.longitude) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function Pulse() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <View style={styles.pulseWrap}>
      <Animated.View style={[styles.pulse, { opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 2.2] }) }] }]} />
      <MaterialIcons name="search" size={28} color={colors.primary} />
    </View>
  );
}

export default function LiveTrackingScreen({ rideId, destinationLabel, onClose, onFinish }: Props) {
  const insets = useSafeAreaInsets();
  const [ride, setRide] = useState<Ride | null>(null);
  const [driverPos, setDriverPos] = useState<LatLng | null>(null);
  const [failures, setFailures] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  /* Statut + infos chauffeur : polling séquentiel (pas de chevauchement) */
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await rideApi.get(rideId);
        if (cancelled) return;
        setRide(r);
        setFailures(0);
        setLastError(null);
        if (r.status === "COMPLETED" || r.status === "CANCELLED") return;
      } catch (e) {
        if (cancelled) return;
        setFailures((f) => f + 1);
        setLastError(errorMessage(e));
      }
      timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [rideId]);

  /* Position du chauffeur en direct (socket.io de ton backend) */
  useEffect(() => {
    const socket = io(API_URL, {
      transports: ["websocket"],
      auth: { token: getToken() },
    });
    socket.on("connect", () => socket.emit("ride:join", { rideId }));
    socket.on("driver:location", (p: { lat: number; lng: number }) =>
      setDriverPos({ latitude: p.lat, longitude: p.lng })
    );
    socket.on("ride:status", (p: { status: RideStatus }) =>
      setRide((r) => (r ? { ...r, status: p.status } : r))
    );
    return () => { socket.disconnect(); };
  }, [rideId]);

  const origin = ride ? { latitude: ride.originLat, longitude: ride.originLng } : null;
  const destination = ride ? { latitude: ride.destLat, longitude: ride.destLng } : null;
  const target = ride?.status === "MATCHED" ? origin : destination;

  const etaMinutes = useMemo(() => {
    if (!driverPos || !target || ride?.status === "COMPLETED") return null;
    return Math.max(1, Math.ceil(((distanceKm(driverPos, target) * 1.3) / 25) * 60));
  }, [driverPos, target?.latitude, target?.longitude, ride?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const osmMarkers = useMemo<OSMMarker[]>(() => {
    if (!origin || !destination) return [];
    const list: OSMMarker[] = [
      { coordinate: origin, title: "Départ", color: "green" },
      { coordinate: destination, title: "Destination", color: "red" },
    ];
    if (driverPos) {
      list.push({
        coordinate: driverPos,
        title: ride?.driver?.fullName ?? "Chauffeur",
        color: "blue",
      });
    }
    return list;
  }, [origin, destination, driverPos, ride?.driver?.fullName]);

  if (!ride || !origin || !destination) {
    return (
      <View style={[styles.loading, { paddingTop: insets.top }]}>
        {failures >= 2 ? (
          <>
            <MaterialIcons name="wifi-off" size={40} color={ERROR_COLOR} />
            <Text style={styles.errorText}>{lastError}</Text>
            <Pressable style={styles.secondaryBtn} onPress={onClose}><Text style={styles.secondaryText}>Retour</Text></Pressable>
          </>
        ) : (
          <>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.muted}>Chargement de ta course…</Text>
          </>
        )}
      </View>
    );
  }

  const done = ride.status === "COMPLETED";
  const searching = ride.status === "PENDING";
  const finished = done || ride.status === "CANCELLED";
  // On ne peut annuler que tant que la course n'a pas démarré : après le départ,
  // le client paie le trajet (le backend refuse toute annulation en IN_PROGRESS).
  const cancellable = ride.status === "PENDING" || ride.status === "MATCHED";
  const paymentLabel =
    ride.status === "CANCELLED" ? "aucun débit"
    : done ? "AZƆ̀ Pay (débité)"
    : "AZƆ̀ Pay (débité à l'arrivée)";

  function handleCancelRide() {
    if (!ride) return;
    Alert.alert(
      "Annuler la course ?",
      ride.driver
        ? "Ton chauffeur est prévenu. Aucun montant n'est débité avant le départ."
        : "Aucun montant n'est débité avant le départ.",
      [
        { text: "Garder la course", style: "cancel" },
        {
          text: "Annuler la course",
          style: "destructive",
          onPress: async () => {
            setCancelling(true);
            try {
              const updated = await rideApi.cancel(ride.id);
              setRide(updated);
            } catch (e) {
              Alert.alert("Annulation impossible", errorMessage(e));
            } finally {
              setCancelling(false);
            }
          },
        },
      ]
    );
  }

  return (
    <View style={styles.root}>
      <OSMMapView
        center={driverPos || origin}
        markers={osmMarkers}
        polyline={driverPos && target ? [driverPos, target] : [origin, destination]}
      />

      {failures >= 2 && (
        <View style={[styles.offline, { top: insets.top + 8 }]}>
          <MaterialIcons name="wifi-off" size={16} color="#fff" />
          <Text style={styles.offlineText}>Connexion instable — nouvelle tentative…</Text>
        </View>
      )}

      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
        <Text style={styles.status}>{STATUS_TEXT[ride.status]}</Text>

        {searching && (
          <View style={styles.searchRow}>
            <Pulse />
            <Text style={[styles.muted, { flex: 1 }]}>Nous contactons les chauffeurs proches de toi.</Text>
          </View>
        )}

        {ride.driver && (
          <View style={styles.driverCard}>
            <View style={styles.avatar}>
              <MaterialIcons name="verified-user" size={26} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.driverName}>
                {maskPersonName(ride.driver.fullName, "Chauffeur AZƆ̀")}
              </Text>
              <Text style={styles.muted}>
                {VEHICLE_LABEL[ride.vehicleType]} · {maskBeninPhone(ride.driver.phone)}
              </Text>
            </View>
            <Pressable
              style={styles.chatBtn}
              onPress={() => setChatOpen(true)}
              accessibilityLabel="Ouvrir le chat sécurisé"
            >
              <MaterialIcons name="chat-bubble-outline" size={18} color={colors.primary} />
              <Text style={styles.chatBtnText}>Message</Text>
            </Pressable>
            {!done && etaMinutes != null && (
              <View style={styles.eta}>
                <Text style={styles.etaValue}>{etaMinutes}</Text>
                <Text style={styles.etaUnit}>min</Text>
              </View>
            )}
          </View>
        )}

        {ride.status === "MATCHED" && (
          <View style={styles.pinBanner}>
            <MaterialIcons name="shield" size={20} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.pinBannerTitle}>Code Bouclier AZƆ̀ (à donner au chauffeur)</Text>
              <Text style={styles.pinBannerSub}>
                Vérifie qu'il tape ces 4 chiffres avant de monter
              </Text>
            </View>
            <View style={styles.pinCodePill}>
              <Text style={styles.pinCodeText}>{rideSecurityPin(ride.id)}</Text>
            </View>
          </View>
        )}

        <View style={{ gap: 2 }}>
          {!!destinationLabel && <Text style={styles.muted} numberOfLines={1}>→ {destinationLabel}</Text>}
          <Text style={styles.price}>
            {ride.price.toLocaleString("fr-FR")} FCFA · {paymentLabel}
          </Text>
        </View>

        {finished ? (
          // Course terminée -> notation ; course annulée -> simple fermeture (rien à noter).
          <Pressable style={styles.primaryBtn} onPress={done ? (onFinish ?? onClose) : onClose}>
            <Text style={styles.primaryText}>{done ? "Terminer" : "Fermer"}</Text>
          </Pressable>
        ) : (
          <>
            {cancellable && (
              <Pressable style={styles.cancelBtn} onPress={handleCancelRide} disabled={cancelling}>
                {cancelling
                  ? <ActivityIndicator size="small" color={ERROR_COLOR} />
                  : <Text style={styles.cancelText}>Annuler la course</Text>}
              </Pressable>
            )}
            <Pressable style={styles.secondaryBtn} onPress={onClose}><Text style={styles.secondaryText}>Réduire</Text></Pressable>
          </>
        )}
      </View>

      <RideChatModal
        visible={chatOpen}
        rideId={ride.id}
        myRole="CLIENT"
        peerName={ride.driver?.fullName}
        peerPhone={ride.driver?.phone}
        locked={finished}
        onClose={() => setChatOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: colors.background, padding: spacing.lg },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surfaceContainerLowest, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.md, elevation: 12, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 12, gap: 12 },
  status: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  muted: { ...typography.bodySm, color: colors.onSurfaceVariant },
  errorText: { ...typography.bodyMd, color: ERROR_COLOR, textAlign: "center" },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  pulseWrap: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  pulse: { position: "absolute", width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary },
  driverCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surfaceContainer, borderRadius: radius.lg, padding: spacing.sm + 2 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center" },
  driverName: { ...typography.bodyMd, color: colors.onSurface, fontWeight: "700" },
  callBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  chatBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.primaryFixed, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 8 },
  chatBtnText: { ...typography.labelMd, color: colors.primary, fontWeight: "800" },
  pinBanner: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.primaryFixed, borderRadius: radius.lg, padding: spacing.sm + 2, borderWidth: 1, borderColor: colors.primary },
  pinBannerTitle: { ...typography.labelMd, color: colors.onSurface, fontWeight: "800" },
  pinBannerSub: { ...typography.bodySm, color: colors.onSurfaceVariant, fontSize: 11 },
  pinCodePill: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 6 },
  pinCodeText: { ...typography.headlineSm, color: "#fff", fontWeight: "800", letterSpacing: 2 },
  eta: { alignItems: "center", backgroundColor: colors.primaryFixed, borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 6 },
  etaValue: { ...typography.headlineSm, color: colors.primary, fontWeight: "800" },
  etaUnit: { ...typography.labelSm, color: colors.primary },
  price: { ...typography.bodyMd, color: colors.onSurface, fontWeight: "700" },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: "center" },
  primaryText: { ...typography.labelMd, color: "#fff", fontWeight: "800", fontSize: 16 },
  secondaryBtn: { borderRadius: radius.full, paddingVertical: 12, paddingHorizontal: 24, alignItems: "center", borderWidth: 1.5, borderColor: colors.outline },
  secondaryText: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  cancelBtn: { borderRadius: radius.full, paddingVertical: 12, alignItems: "center", borderWidth: 1.5, borderColor: ERROR_COLOR },
  cancelText: { ...typography.labelMd, color: ERROR_COLOR, fontWeight: "700" },
  driverMarker: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff" },
  offline: { position: "absolute", left: spacing.md, right: spacing.md, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: ERROR_COLOR, borderRadius: radius.lg, padding: spacing.sm },
  offlineText: { ...typography.labelMd, color: "#fff" },
});
