import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Animated, Easing, Alert } from "react-native";
import OSMMapView, { OSMMarker, type LatLng } from "../components/OSMMapView";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { io } from "socket.io-client";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { API_URL, Ride, RideStatus, VehicleType, errorMessage, getToken, rideApi, walletApi } from "../services/api";
import RideChatModal from "../components/RideChatModal";
import { maskBeninPhone, maskPersonName } from "../utils/phone";
import { getDrivingRoute, type DrivingRoute } from "../services/routing";

type Props = { rideId: string; destinationLabel?: string; onClose: () => void; onFinish?: () => void };
const POLL_MS = 3000;
const ERROR_COLOR = "#B3261B";
const STATUS_TEXT: Record<RideStatus, string> = {
  PENDING: "Recherche d'un chauffeur…",
  MATCHED: "Ton chauffeur arrive",
  ARRIVED: "Ton chauffeur est arrivé",
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
  const [driverPos, setDriverPos] = useState<(LatLng & { heading?: number }) | null>(null);
  const [driverRoute, setDriverRoute] = useState<{ coordinates: LatLng[]; durationMinutes: number; start: LatLng; target: LatLng } | null>(null);
  const [pendingRoute, setPendingRoute] = useState<DrivingRoute | null>(null);
  const [pendingRouteLoading, setPendingRouteLoading] = useState(false);
  const [pendingRouteError, setPendingRouteError] = useState(false);
  const [failures, setFailures] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [walletRefreshError, setWalletRefreshError] = useState<string | null>(null);
  const [walletRefreshing, setWalletRefreshing] = useState(false);

  async function refreshWallet() {
    setWalletRefreshing(true);
    setWalletRefreshError(null);
    try {
      const wallet = await walletApi.get();
      setWalletBalance(wallet.balance);
    } catch (error) {
      setWalletRefreshError(errorMessage(error));
    } finally {
      setWalletRefreshing(false);
    }
  }

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

  useEffect(() => {
    if (ride?.status !== "COMPLETED") return;
    let active = true;
    setWalletRefreshing(true);
    setWalletRefreshError(null);
    walletApi.get()
      .then((wallet) => {
        if (active) setWalletBalance(wallet.balance);
      })
      .catch((error) => {
        if (active) setWalletRefreshError(errorMessage(error));
      })
      .finally(() => {
        if (active) setWalletRefreshing(false);
      });
    return () => { active = false; };
  }, [ride?.id, ride?.status]);

  useEffect(() => {
    const socket = io(API_URL, { transports: ["websocket"], auth: { token: getToken() } });
    socket.on("connect", () => socket.emit("ride:join", { rideId }));
    socket.on("driver:location", (p: { lat: number; lng: number; heading?: number }) =>
      setDriverPos({
        latitude: p.lat,
        longitude: p.lng,
        ...(typeof p.heading === "number" && Number.isFinite(p.heading) ? { heading: p.heading } : {}),
      })
    );
    socket.on("ride:status", (p: { status: RideStatus }) => setRide((r) => (r ? { ...r, status: p.status } : r)));
    return () => { socket.disconnect(); };
  }, [rideId]);

  const origin = ride ? { latitude: ride.originLat, longitude: ride.originLng } : null;
  const destination = ride ? { latitude: ride.destLat, longitude: ride.destLng } : null;
  const target = ride?.status === "MATCHED" || ride?.status === "ARRIVED" ? origin : destination;

  useEffect(() => {
    if (!origin || !destination || ride?.status !== "PENDING") {
      setPendingRoute(null);
      setPendingRouteLoading(false);
      setPendingRouteError(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 10000);
    setPendingRoute(null);
    setPendingRouteLoading(true);
    setPendingRouteError(false);

    getDrivingRoute(origin, destination, controller.signal)
      .then((route) => {
        if (active) setPendingRoute(route);
      })
      .catch(() => {
        if (active) setPendingRouteError(true);
      })
      .finally(() => {
        clearTimeout(timeout);
        if (active) setPendingRouteLoading(false);
      });

    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [origin?.latitude, origin?.longitude, destination?.latitude, destination?.longitude, ride?.status]);

  useEffect(() => {
    if (!driverPos || !target || (ride?.status !== "MATCHED" && ride?.status !== "IN_PROGRESS")) {
      setDriverRoute(null);
      return;
    }
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 10000);
    const timer = setTimeout(() => {
      getDrivingRoute(driverPos, target, controller.signal)
        .then((route) => { if (active) setDriverRoute({ ...route, start: driverPos, target }); })
        .catch(() => { if (active) setDriverRoute(null); })
        .finally(() => clearTimeout(timeout));
    }, 700);
    return () => { active = false; clearTimeout(timer); clearTimeout(timeout); controller.abort(); };
  }, [driverPos?.latitude, driverPos?.longitude, target?.latitude, target?.longitude, ride?.status]);

  const routeStillRelevant = !!(driverRoute && driverPos && target && distanceKm(driverRoute.start, driverPos) < 0.5 && distanceKm(driverRoute.target, target) < 0.05);
  const etaMinutes = ride?.status === "ARRIVED" || ride?.status === "COMPLETED" || ride?.status === "CANCELLED"
    ? null
    : routeStillRelevant ? driverRoute?.durationMinutes ?? null : null;

  const trackingPolyline = useMemo(() => {
    if (ride?.status === "PENDING") return pendingRoute?.coordinates ?? [];
    if (ride?.status === "MATCHED" || ride?.status === "IN_PROGRESS") {
      return routeStillRelevant && driverRoute ? driverRoute.coordinates : [];
    }
    return [];
  }, [driverRoute, pendingRoute, ride?.status, routeStillRelevant]);

  const osmMarkers = useMemo<OSMMarker[]>(() => {
    if (!origin || !destination) return [];
    const list: OSMMarker[] = [
      { id: "origin", coordinate: origin, title: "Départ", color: "green" },
      { id: "destination", coordinate: destination, title: "Destination", color: "red" },
    ];
    if (driverPos) {
      list.push({
        id: "driver",
        coordinate: driverPos,
        title: ride?.driver?.fullName ?? "Chauffeur",
        color: "blue",
        heading: driverPos.heading,
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
  const cancellable = ride.status === "PENDING" || ride.status === "MATCHED" || ride.status === "ARRIVED";
  const paymentLabel = ride.status === "CANCELLED" ? "aucun débit" : done ? "AZƆ̀ Pay (débité)" : "AZƆ̀ Pay (débité à l'arrivée)";

  function handleCancelRide() {
    if (!ride) return;
    Alert.alert("Annuler la course ?", ride.driver ? "Ton chauffeur est prévenu. Aucun montant n'est débité avant le départ." : "Aucun montant n'est débité avant le départ.", [
      { text: "Garder la course", style: "cancel" },
      { text: "Annuler la course", style: "destructive", onPress: async () => {
        setCancelling(true);
        try { setRide(await rideApi.cancel(ride.id)); }
        catch (e) { Alert.alert("Annulation impossible", errorMessage(e)); }
        finally { setCancelling(false); }
      } },
    ]);
  }

  return (
    <View style={styles.root}>
      <OSMMapView
        center={driverPos || origin}
        markers={osmMarkers}
        polyline={trackingPolyline}
        followMarkerId={driverPos && (ride.status === "MATCHED" || ride.status === "ARRIVED" || ride.status === "IN_PROGRESS") ? "driver" : undefined}
      />
      {failures >= 2 && <View style={[styles.offline, { top: insets.top + 8 }]}><MaterialIcons name="wifi-off" size={16} color="#fff" /><Text style={styles.offlineText}>Connexion instable — nouvelle tentative…</Text></View>}
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
        <Text style={styles.status}>{STATUS_TEXT[ride.status]}</Text>
        {searching && <View style={styles.searchRow}><Pulse /><Text style={[styles.muted, { flex: 1 }]}>Nous contactons les chauffeurs proches de toi.{typeof ride.expiresInMinutes === "number" && ride.expiresInMinutes > 0 ? ` Recherche encore ${ride.expiresInMinutes} min : sans chauffeur, la demande est annulée sans aucun débit.` : ""}</Text></View>}
        {searching && pendingRouteLoading && <Text style={styles.muted}>Calcul du trajet routier…</Text>}
        {searching && pendingRouteError && <Text style={styles.errorText}>L’itinéraire routier est momentanément indisponible ; la carte n’affiche pas de ligne approximative.</Text>}
        {ride.expired && <View style={styles.expiredBanner}><MaterialIcons name="search-off" size={18} color={ERROR_COLOR} /><Text style={styles.expiredText}>Aucun chauffeur n'a accepté ta demande : elle a expiré et a été annulée. Aucun montant n'a été débité — tu peux relancer une recherche.</Text></View>}

        {ride.driver && (
          <View style={styles.driverCard}>
            <View style={styles.driverRow}>
              <View style={styles.avatar}><MaterialIcons name="verified-user" size={26} color={colors.primary} /></View>
              <View style={styles.driverInfo}>
                <Text style={styles.driverName} numberOfLines={1}>{maskPersonName(ride.driver.fullName, "Chauffeur AZƆ̀")}</Text>
                <Text style={styles.muted} numberOfLines={1}>{VEHICLE_LABEL[ride.vehicleType]}</Text>
                <Text style={styles.muted} numberOfLines={1}>{maskBeninPhone(ride.driver.phone)}</Text>
              </View>
              {ride.status === "ARRIVED" ? (
                <View style={styles.arrivedBadge}><MaterialIcons name="check-circle" size={16} color={colors.primary} /><Text style={styles.arrivedBadgeText}>Arrivé</Text></View>
              ) : !done && etaMinutes != null ? (
                <View style={styles.eta}><Text style={styles.etaValue}>{etaMinutes}</Text><Text style={styles.etaUnit}>{ride.status === "MATCHED" ? "min pour toi" : "min"}</Text></View>
              ) : null}
            </View>
            <Pressable style={styles.chatBtn} onPress={() => setChatOpen(true)} accessibilityLabel="Ouvrir le chat sécurisé">
              <MaterialIcons name="chat-bubble-outline" size={18} color={colors.primary} />
              <Text style={styles.chatBtnText}>Envoyer un message</Text>
            </Pressable>
          </View>
        )}

        {ride.status === "ARRIVED" && <View style={styles.pinBanner}><MaterialIcons name="shield" size={20} color={colors.primary} /><View style={{ flex: 1 }}><Text style={styles.pinBannerTitle}>{ride.vehicleType.startsWith("ZEM_") ? "Ton Zem est arrivé" : "Ton chauffeur est arrivé"}</Text><Text style={styles.pinBannerSub}>{ride.pickupCode ? "Vérifie qu'il est devant toi, puis donne-lui ce code pour démarrer." : "Le code de sécurité arrive…"}</Text></View>{ride.pickupCode ? <View style={styles.pinCodePill}><Text style={styles.pinCodeText}>{ride.pickupCode}</Text></View> : <ActivityIndicator size="small" color={colors.primary} />}</View>}
        {ride.status === "IN_PROGRESS" && <View style={styles.pinBanner}><MaterialIcons name="verified-user" size={20} color={colors.primary} /><View style={{ flex: 1 }}><Text style={styles.pinBannerTitle}>Code d'arrivée</Text><Text style={styles.pinBannerSub}>{ride.dropCode ? "Garde ce code et donne-le au Zem à destination." : "Le code d'arrivée sera affiché dès que le serveur le fournira."}</Text></View>{ride.dropCode ? <View style={styles.pinCodePill}><Text style={styles.pinCodeText}>{ride.dropCode}</Text></View> : <ActivityIndicator size="small" color={colors.primary} />}</View>}
        <View style={{ gap: 2 }}>{!!destinationLabel && <Text style={styles.muted} numberOfLines={1}>→ {destinationLabel}</Text>}<Text style={styles.price}>{ride.price.toLocaleString("fr-FR")} FCFA · {paymentLabel}</Text></View>
        {done && <View style={styles.paymentSummary}>
          <Text style={styles.paymentTitle}>Paiement AZƆ̀ Pay confirmé</Text>
          <Text style={styles.muted}>Montant payé : {ride.price.toLocaleString("fr-FR")} FCFA</Text>
          {walletBalance !== null ? (
            <Text style={styles.walletBalance}>Nouveau solde : {walletBalance.toLocaleString("fr-FR")} FCFA</Text>
          ) : walletRefreshing ? (
            <View style={styles.walletRefreshRow}><ActivityIndicator size="small" color={colors.primary} /><Text style={styles.muted}>Actualisation du solde…</Text></View>
          ) : (
            <View style={styles.walletRefreshRow}>
              <Text style={styles.errorText}>{walletRefreshError ?? "Le solde n'a pas pu être actualisé."}</Text>
              <Pressable onPress={refreshWallet} disabled={walletRefreshing} style={styles.walletRetry}>
                <Text style={styles.walletRetryText}>Réessayer</Text>
              </Pressable>
            </View>
          )}
        </View>}
        {finished ? <Pressable style={styles.primaryBtn} onPress={done ? (onFinish ?? onClose) : onClose}><Text style={styles.primaryText}>{done ? "Terminer" : ride.expired ? "Relancer une recherche" : "Fermer"}</Text></Pressable> : <><>{cancellable && <Pressable style={styles.cancelBtn} onPress={handleCancelRide} disabled={cancelling}>{cancelling ? <ActivityIndicator size="small" color={ERROR_COLOR} /> : <Text style={styles.cancelText}>Annuler la course</Text>}</Pressable>}</><Pressable style={styles.secondaryBtn} onPress={onClose}><Text style={styles.secondaryText}>Réduire</Text></Pressable></>}
      </View>
      <RideChatModal visible={chatOpen} rideId={ride.id} myRole="CLIENT" peerName={ride.driver?.fullName} peerPhone={ride.driver?.phone} locked={finished} onClose={() => setChatOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: colors.background, padding: spacing.lg },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surfaceContainerLowest, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.md, elevation: 12, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 12, gap: 12 },
  status: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  muted: { ...typography.bodySm, color: colors.onSurfaceVariant },
  expiredBanner: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#FDECEA", padding: spacing.sm, borderRadius: radius.lg },
  expiredText: { ...typography.bodySm, color: ERROR_COLOR, flex: 1 },
  errorText: { ...typography.bodyMd, color: ERROR_COLOR, textAlign: "center" },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  pulseWrap: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  pulse: { position: "absolute", width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary },
  driverCard: { gap: 10, backgroundColor: colors.surfaceContainer, borderRadius: radius.lg, padding: spacing.sm + 2 },
  driverRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  driverInfo: { flex: 1, minWidth: 0 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center" },
  driverName: { ...typography.bodyMd, color: colors.onSurface, fontWeight: "700" },
  chatBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.primaryFixed, borderRadius: radius.full, paddingVertical: 10 },
  chatBtnText: { ...typography.labelMd, color: colors.primary, fontWeight: "800" },
  pinBanner: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.primaryFixed, borderRadius: radius.lg, padding: spacing.sm + 2, borderWidth: 1, borderColor: colors.primary },
  pinBannerTitle: { ...typography.labelMd, color: colors.onSurface, fontWeight: "800" },
  pinBannerSub: { ...typography.bodySm, color: colors.onSurfaceVariant, fontSize: 11 },
  pinCodePill: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 6 },
  pinCodeText: { ...typography.headlineSm, color: "#fff", fontWeight: "800", letterSpacing: 2 },
  paymentSummary: { backgroundColor: colors.primaryFixed, borderRadius: radius.lg, padding: spacing.md, gap: 4 },
  paymentTitle: { ...typography.labelLg, color: colors.onPrimaryFixed, fontWeight: "800" },
  walletBalance: { ...typography.bodyMd, color: colors.onPrimaryFixed, fontWeight: "800" },
  walletRefreshRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  walletRetry: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 7 },
  walletRetryText: { ...typography.labelSm, color: "#fff", fontWeight: "800" },
  eta: { alignItems: "center", backgroundColor: colors.primaryFixed, borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 6 },
  arrivedBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.primaryFixed, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 8 },
  arrivedBadgeText: { ...typography.labelSm, color: colors.primary, fontWeight: "800" },
  etaValue: { ...typography.headlineSm, color: colors.primary, fontWeight: "800" },
  etaUnit: { ...typography.labelSm, color: colors.primary },
  price: { ...typography.bodyMd, color: colors.onSurface, fontWeight: "700" },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, alignItems: "center" },
  primaryText: { ...typography.labelMd, color: "#fff", fontWeight: "800", fontSize: 16 },
  secondaryBtn: { borderRadius: radius.full, paddingVertical: 12, paddingHorizontal: 24, alignItems: "center", borderWidth: 1.5, borderColor: colors.outline },
  secondaryText: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  cancelBtn: { borderRadius: radius.full, paddingVertical: 12, alignItems: "center", borderWidth: 1.5, borderColor: ERROR_COLOR },
  cancelText: { ...typography.labelMd, color: ERROR_COLOR, fontWeight: "700" },
  offline: { position: "absolute", left: spacing.md, right: spacing.md, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: ERROR_COLOR, borderRadius: radius.lg, padding: spacing.sm },
  offlineText: { ...typography.labelMd, color: "#fff" },
});
