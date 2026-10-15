import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Location from "expo-location";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Animated, Easing, Alert, Linking, Share, ScrollView, useWindowDimensions } from "react-native";
import BackButton from "../components/BackButton";
import OSMMapView, { OSMMarker, type LatLng } from "../components/OSMMapView";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { io, type Socket } from "socket.io-client";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { API_URL, Ride, RideStatus, VehicleType, errorMessage, getToken, paidAmount, rideApi, userApi, walletApi } from "../services/api";
import RideChatModal from "../components/RideChatModal";
import RideStopPanel from "../components/RideStopPanel";
import DriverOfferCard from "../components/DriverOfferCard";
import { maskBeninPhone, maskPersonName } from "../utils/phone";
import { getDrivingRoute, getRideRoute, type DrivingRoute } from "../services/routing";
import { useI18n, type MessageKey } from "../i18n";
import { EMERGENCY_NUMBERS } from "../config/emergency";

type Props = { rideId: string; destinationLabel?: string; onClose: () => void; onFinish?: () => void };
const POLL_MS = 3000;
const ERROR_COLOR = "#B3261B";
// Libellés : voir i18n/*.ts (clés live.status.* et veh.* / live.vehicle.*)
const vehicleKey = (v: VehicleType): MessageKey =>
  (v === "ZEM_ESSENCE" || v === "ZEM_ELECTRIC" ? `veh.${v}.label` : `live.vehicle.${v}`) as MessageKey;

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
  const { t, lang, locale } = useI18n();
  const [ride, setRide] = useState<Ride | null>(null);
  const [driverPos, setDriverPos] = useState<(LatLng & { heading?: number }) | null>(null);
  // Ma propre position (le client), affichée sur ma carte et envoyée au Spider avant la prise en charge.
  const [myPos, setMyPos] = useState<LatLng | null>(null);
  const [driverRoute, setDriverRoute] = useState<{ coordinates: LatLng[]; durationMinutes: number; start: LatLng; target: LatLng } | null>(null);
  const [pendingRoute, setPendingRoute] = useState<DrivingRoute | null>(null);
  const [pendingRouteLoading, setPendingRouteLoading] = useState(false);
  const [pendingRouteError, setPendingRouteError] = useState(false);
  // Nouvelle tentative automatique (toutes les 12 s) tant que la recherche de chauffeur dure
  const [pendingRetry, setPendingRetry] = useState(0);
  const [failures, setFailures] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  // « Réduire » : la carte blanche du bas disparaît et la carte occupe tout l'écran ; un bouton la ramène
  const [sheetHidden, setSheetHidden] = useState(false);
  const { height: windowHeight } = useWindowDimensions();
  const [chatOpen, setChatOpen] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [walletRefreshError, setWalletRefreshError] = useState<string | null>(null);
  const [walletRefreshing, setWalletRefreshing] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const lastDriverAtRef = useRef(0);
  // Statut précédent : un Spider déjà assigné qui disparaît (retour en recherche) = il a annulé
  const prevStatusRef = useRef<string | null>(null);

  // Position du Spider reçue par socket, par l'accusé de `ride:join` ou par le suivi périodique.
  // Une position plus ancienne que celle déjà affichée est ignorée (réseau mobile instable :
  // sans cela le curseur recule). En dessous de ~1 m/s (arrêt, demi-tour) le cap GPS n'est
  // pas fiable : la flèche est masquée plutôt que de tourner au hasard.
  const applyDriverLocation = useCallback(
    (p?: { lat?: number; lng?: number; heading?: number; speed?: number; at?: number } | null) => {
      if (!p || typeof p.lat !== "number" || typeof p.lng !== "number" || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
      const at = typeof p.at === "number" ? p.at : Date.now();
      if (at < lastDriverAtRef.current) return;
      lastDriverAtRef.current = at;
      const moving = typeof p.speed !== "number" || p.speed >= 1;
      setDriverPos({
        latitude: p.lat,
        longitude: p.lng,
        ...(moving && typeof p.heading === "number" && Number.isFinite(p.heading) ? { heading: p.heading } : {}),
      });
    },
    []
  );

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
        // Filet de sécurité si le socket tombe : le serveur peut joindre la dernière position.
        applyDriverLocation(r.driverLocation);
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
    const status = ride?.status ?? null;
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (status === "PENDING" && (prev === "MATCHED" || prev === "ARRIVED")) {
      Alert.alert(t("live.driverCancelled.title"), t("live.driverCancelled.body"));
    }
  }, [ride?.status, t]);

  useEffect(() => {
    setSheetHidden(false);
  }, [ride?.status]);

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
    // (Re)connexion : on rejoint la room privée de la course. Le serveur répond
    // `joined: null` s'il refuse (jeton expiré, course d'un autre) : sans cela le client
    // ne reçoit aucune position et rien ne l'explique.
    socketRef.current = socket;
    socket.on("connect", () =>
      socket.emit(
        "ride:join",
        { rideId },
        (res?: { joined?: string | null; driverLocation?: { lat: number; lng: number; heading?: number; speed?: number; at?: number } | null }) => {
          if (!res?.joined) {
            console.warn("Suivi AZƆ̀ : la course n'a pas pu être rejointe, positions non reçues");
            return;
          }
          // Si le serveur conserve la dernière position, le Spider apparaît tout de suite,
          // sans attendre sa prochaine émission.
          applyDriverLocation(res.driverLocation);
        }
      )
    );
    socket.on("driver:location", (p: { lat: number; lng: number; heading?: number; speed?: number; at?: number }) =>
      applyDriverLocation(p)
    );
    socket.on("ride:status", (p: { status: RideStatus }) => setRide((r) => (r ? { ...r, status: p.status } : r)));
    // Course partielle : distance parcourue en direct et demande d'arrêt du Spider.
    socket.on(
      "ride:progress",
      (p: {
        rideId?: string;
        traveledMeters?: number;
        currentPrice?: number;
        finalPrice?: number;
        settledDistanceMeters?: number;
        priceMode?: "FULL" | "PARTIAL" | null;
      }) => {
        if (p?.rideId !== rideId) return;
        // À la fin de la course le serveur envoie le montant réellement débité.
        if (typeof p.finalPrice === "number") {
          setRide((r) => (r ? { ...r, finalPrice: p.finalPrice, settledDistanceMeters: p.settledDistanceMeters, priceMode: p.priceMode } : r));
          return;
        }
        if (typeof p.traveledMeters !== "number") return;
        setRide((r) => (r ? { ...r, traveledMeters: p.traveledMeters, currentPrice: p.currentPrice ?? r.currentPrice } : r));
      }
    );
    socket.on("ride:stop", (p: { rideId?: string; stopRequest?: Ride["stopRequest"] }) => {
      if (p?.rideId !== rideId) return;
      setRide((r) => (r ? { ...r, stopRequest: p.stopRequest ?? null } : r));
    });
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [rideId, applyDriverLocation]);

  // Ma position : suivie dès que la course est active (recherche, approche, trajet) pour l’afficher
  // sur ma carte ; envoyée au Spider SEULEMENT avant la prise en charge (le serveur n’accepte pas
  // `client:location` ensuite : sur la moto, ma position est celle du Spider).
  const trackingSelf =
    ride?.status === "PENDING" || ride?.status === "OFFERED" || ride?.status === "MATCHED" || ride?.status === "ARRIVED" || ride?.status === "IN_PROGRESS";
  const sharingPosition = ride?.status === "MATCHED" || ride?.status === "ARRIVED";
  const sharingRef = useRef(false);
  sharingRef.current = sharingPosition;
  useEffect(() => {
    if (!trackingSelf) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    let last: Location.LocationObject | null = null;
    const send = (pos: Location.LocationObject) => {
      const socket = socketRef.current;
      if (!socket?.connected) return;
      socket.emit("client:location", {
        rideId,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        ts: Date.now(),
        ...(typeof pos.coords.accuracy === "number" ? { accuracy: Math.round(pos.coords.accuracy) } : {}),
        // Cap et vitesse : le Spider voit dans quelle direction je marche. Le serveur ne les relaie pas
        // encore (voir PROJECT_SUMMARY/DEMANDE_BACKEND_SUIVI_TEMPS_REEL.md) : sans effet en attendant.
        ...(typeof pos.coords.heading === "number" && pos.coords.heading >= 0 && pos.coords.heading < 360
          ? { heading: Math.round(pos.coords.heading) }
          : {}),
        ...(typeof pos.coords.speed === "number" && pos.coords.speed >= 0 ? { speed: pos.coords.speed } : {}),
      });
    };
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== "granted" || cancelled) return;
        // Un point par seconde (ou tous les 2 m) : le déplacement se voit en direct sur les deux cartes.
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 2, timeInterval: 1000 },
          (pos) => {
            last = pos;
            setMyPos({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
            if (sharingRef.current) send(pos);
          }
        );
        if (cancelled) sub.remove();
      } catch {
        // Localisation indisponible : pas de point sur ma carte, et le Spider ne voit que le départ choisi.
      }
    })();
    // À l arrêt le GPS n’émet rien : on renvoie la dernière position toutes les 2 s (avant la prise en charge).
    const heartbeat = setInterval(() => { if (last && sharingRef.current) send(last); }, 2000);
    return () => { cancelled = true; sub?.remove(); clearInterval(heartbeat); };
  }, [trackingSelf, rideId]);

  const origin = ride ? { latitude: ride.originLat, longitude: ride.originLng } : null;
  const destination = ride ? { latitude: ride.destLat, longitude: ride.destLng } : null;
  const target = ride?.status === "MATCHED" || ride?.status === "ARRIVED" ? origin : destination;

  useEffect(() => {
    if (!origin || !destination || (ride?.status !== "PENDING" && ride?.status !== "OFFERED")) {
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
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    getDrivingRoute(origin, destination, controller.signal)
      .then((route) => {
        if (active) setPendingRoute(route);
      })
      .catch(() => {
        if (!active) return;
        setPendingRouteError(true);
        retryTimer = setTimeout(() => setPendingRetry((n) => n + 1), 12000);
      })
      .finally(() => {
        clearTimeout(timeout);
        if (active) setPendingRouteLoading(false);
      });

    return () => {
      active = false;
      clearTimeout(timeout);
      if (retryTimer) clearTimeout(retryTimer);
      controller.abort();
    };
  }, [origin?.latitude, origin?.longitude, destination?.latitude, destination?.longitude, ride?.status, pendingRetry]);

  const driverRouteKey = driverPos
    ? `${Math.round(driverPos.latitude / 0.0005)},${Math.round(driverPos.longitude / 0.0005)}`
    : null;
  useEffect(() => {
    if (!driverPos || !target || (ride?.status !== "MATCHED" && ride?.status !== "IN_PROGRESS")) {
      setDriverRoute(null);
      return;
    }
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 10000);
    const timer = setTimeout(() => {
      getRideRoute(rideId, driverPos, target, controller.signal)
        .then((route) => { if (active) setDriverRoute({ ...route, start: driverPos, target }); })
        // Le service OSRM public limite le débit : un échec ne doit pas faire disparaître le
        // tracé (c'est ce qui arrivait pendant un demi-tour). On garde le dernier tracé valide,
        // `routeStillRelevant` le masque s'il ne correspond plus à la position.
        .catch(() => undefined)
        .finally(() => clearTimeout(timeout));
    }, 700);
    return () => { active = false; clearTimeout(timer); clearTimeout(timeout); controller.abort(); };
    // Clé arrondie à ~55 m : l'itinéraire n'est recalculé qu'après un vrai déplacement, pas à
    // chaque point GPS (un demi-tour en déclenchait des dizaines, bien au-delà de la limite d'OSRM).
  }, [driverRouteKey, target?.latitude, target?.longitude, ride?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const routeStillRelevant = !!(driverRoute && driverPos && target && distanceKm(driverRoute.start, driverPos) < 0.5 && distanceKm(driverRoute.target, target) < 0.05);
  const etaMinutes = ride?.status === "ARRIVED" || ride?.status === "COMPLETED" || ride?.status === "CANCELLED"
    ? null
    : routeStillRelevant ? driverRoute?.durationMinutes ?? null : null;

  const trackingPolyline = useMemo(() => {
    if (ride?.status === "PENDING" || ride?.status === "OFFERED") return pendingRoute?.coordinates ?? [];
    if (ride?.status === "MATCHED" || ride?.status === "IN_PROGRESS") {
      return routeStillRelevant && driverRoute ? driverRoute.coordinates : [];
    }
    return [];
  }, [driverRoute, pendingRoute, ride?.status, routeStillRelevant]);

  const osmMarkers = useMemo<OSMMarker[]>(() => {
    if (!origin || !destination) return [];
    const list: OSMMarker[] = [
      { id: "origin", coordinate: origin, title: t("live.marker.origin"), color: "green" },
      { id: "destination", coordinate: destination, title: t("live.marker.dest"), color: "red" },
    ];
    // Avant la prise en charge, je me vois sur la carte ; sur la moto mon point se confond avec celui du Spider.
    if (myPos && ride?.status !== "IN_PROGRESS") {
      list.push({ id: "me", coordinate: myPos, title: t("live.marker.me"), color: "orange" });
    }
    if (driverPos) {
      list.push({
        id: "driver",
        coordinate: driverPos,
        title: ride?.driver?.fullName ?? t("live.marker.driver"),
        color: "blue",
        heading: driverPos.heading,
      });
    }
    return list;
  }, [origin, destination, driverPos, myPos, ride?.status, ride?.driver?.fullName, lang]);

  if (!ride || !origin || !destination) {
    return (
      <View style={[styles.loading, { paddingTop: insets.top }]}>
        {failures >= 2 ? (
          <>
            <MaterialIcons name="wifi-off" size={40} color={ERROR_COLOR} />
            <Text style={styles.errorText}>{lastError}</Text>
            <Pressable style={styles.secondaryBtn} onPress={onClose}><Text style={styles.secondaryText}>{t("common.back")}</Text></Pressable>
          </>
        ) : (
          <>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.muted}>{t("live.loading")}</Text>
          </>
        )}
      </View>
    );
  }

  const done = ride.status === "COMPLETED";
  const scheduledWait = ride.status === "PENDING" && !!ride.scheduledAt && !ride.scheduledReleasedAt;
  const searching = ride.status === "PENDING" && !scheduledWait;
  const finished = done || ride.status === "CANCELLED";
  const cancellable = ride.status === "PENDING" || ride.status === "OFFERED" || ride.status === "MATCHED" || ride.status === "ARRIVED";
  const offered = ride.status === "OFFERED";
  const paymentLabel = ride.status === "CANCELLED" ? t("live.pay.none") : done ? t("live.pay.done") : t("live.pay.arrival");
  const money = (n: number) => n.toLocaleString(locale);

  // SOS : appeler les secours, prévenir AZƆ̀ (avec la position) ou envoyer un SMS à son contact d'urgence
  async function sosAlertAzo() {
    if (!ride) return;
    const here = driverPos ?? myPos;
    try {
      await rideApi.sos(ride.id, here ? { lat: here.latitude, lng: here.longitude } : undefined);
      Alert.alert(t("sos.sentTitle"), t("sos.sent"));
    } catch {
      Alert.alert(t("sos.title"), t("sos.failed"));
    }
  }

  async function sosTextContact() {
    try {
      const me = await userApi.me();
      const phone = me.emergencyContact?.phone;
      if (!phone) {
        Alert.alert(t("sos.title"), t("sos.noContact"));
        return;
      }
      const here = driverPos ?? myPos;
      const body = [
        t("sos.smsBody", { vehicle: ride ? t(vehicleKey(ride.vehicleType)) : "" }),
        here ? t("sos.smsPosition", { link: `https://maps.google.com/?q=${here.latitude},${here.longitude}` }) : "",
      ].filter(Boolean).join("\n");
      await Linking.openURL(`sms:${phone}?body=${encodeURIComponent(body)}`);
    } catch {
      Alert.alert(t("sos.title"), t("sos.noContact"));
    }
  }

  function handleSos() {
    Alert.alert(t("sos.title"), t("sos.body"), [
      { text: t("sos.alertAzo"), onPress: sosAlertAzo },
      { text: t("sos.contact"), onPress: sosTextContact },
      { text: t("sos.police", { number: EMERGENCY_NUMBERS.police }), onPress: () => Linking.openURL(`tel:${EMERGENCY_NUMBERS.police}`) },
      { text: t("sos.fire", { number: EMERGENCY_NUMBERS.fire }), onPress: () => Linking.openURL(`tel:${EMERGENCY_NUMBERS.fire}`) },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  }

  // Partage du trajet : message prêt à envoyer (WhatsApp, SMS…) avec le chauffeur, la destination
  // et un lien vers la position actuelle. C'est une photo de l'instant : le suivi en direct
  // pour les proches demanderait un lien côté serveur.
  async function handleShare() {
    if (!ride?.driver) return;
    const here = driverPos ?? myPos;
    const vehicle = t(vehicleKey(ride.vehicleType));
    const driver = maskPersonName(ride.driver.fullName, t("live.driverDefault"));
    const lines = [
      destinationLabel ? t("share.message", { vehicle, driver, destination: destinationLabel }) : t("share.messageNoDest", { vehicle, driver }),
    ];
    if (here) lines.push(t("share.position", { link: `https://maps.google.com/?q=${here.latitude},${here.longitude}` }));
    try {
      await Share.share({ message: lines.join("\n") });
    } catch {
      // partage annulé ou indisponible : rien à faire
    }
  }

  function handleCancelRide() {
    if (!ride) return;
    Alert.alert(t("live.cancel.title"), ride.driver ? t("live.cancel.withDriver") : t("live.cancel.noDriver"), [
      { text: t("live.cancel.keep"), style: "cancel" },
      { text: t("live.cancel.confirm"), style: "destructive", onPress: async () => {
        setCancelling(true);
        try { setRide(await rideApi.cancel(ride.id)); }
        catch (e) { Alert.alert(t("live.cancel.failed"), errorMessage(e)); }
        finally { setCancelling(false); }
      } },
    ]);
  }

  return (
    <View style={styles.root}>
      <OSMMapView
        center={driverPos || myPos || origin}
        markers={osmMarkers}
        polyline={trackingPolyline}
        // Pendant le trajet la caméra suit le Spider ; avant la prise en charge elle garde le Spider, moi et
        // le point de départ TOUS visibles (elle ne se recadre que si l’un d’eux approche du bord).
        followMarkerId={driverPos && ride.status === "IN_PROGRESS" ? "driver" : undefined}
        fitMarkerIds={ride.status === "MATCHED" || ride.status === "ARRIVED" ? ["driver", "me", "origin"] : undefined}
      />
      {failures >= 2 && <View style={[styles.offline, { top: insets.top + 8 }]}><MaterialIcons name="wifi-off" size={16} color="#fff" /><Text style={styles.offlineText}>{t("live.offline")}</Text></View>}
      {(ride.status === "MATCHED" || ride.status === "ARRIVED" || ride.status === "IN_PROGRESS") && (
        <Pressable style={[styles.sos, { top: insets.top + 8 }]} onPress={handleSos} accessibilityRole="button" accessibilityLabel={t("sos.title")}>
          <MaterialIcons name="warning" size={16} color="#fff" />
          <Text style={styles.sosText}>{t("sos.button")}</Text>
        </Pressable>
      )}
      {sheetHidden ? (
        <>
        <View style={{ position: "absolute", left: 16, top: insets.top + 8 }}>
          <BackButton onPress={onClose} />
        </View>
        {ride.driver && !offered ? (
          <Pressable
            style={[styles.mapFab, { bottom: insets.bottom + spacing.md + 64 }]}
            onPress={() => setChatOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t("live.chatA11y")}
          >
            <MaterialIcons name="chat-bubble-outline" size={24} color={colors.primary} />
          </Pressable>
        ) : null}
        <Pressable
          style={[styles.mapFab, { bottom: insets.bottom + spacing.md }]}
          onPress={() => setSheetHidden(false)}
          accessibilityRole="button"
          accessibilityLabel={t("live.show")}
        >
          <MaterialIcons name="fullscreen-exit" size={28} color={colors.primary} />
        </Pressable>
        </>
      ) : (
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md, maxHeight: Math.round(windowHeight * 0.62) }]}>
        {/* Défilante : pendant le trajet la carte contient davantage (distance, arrêt, message…), rien ne doit sortir de l'écran */}
        <ScrollView contentContainerStyle={{ gap: 12 }} showsVerticalScrollIndicator={false} bounces={false}>
        <Text style={styles.status}>{t(`live.status.${ride.status}` as MessageKey)}</Text>
        {!driverPos && (ride.status === "MATCHED" || ride.status === "ARRIVED" || ride.status === "IN_PROGRESS") && (
          <Text style={styles.muted}>{t("live.driverPos")}</Text>
        )}
        {scheduledWait && ride.scheduledAt && (
          <View style={styles.searchRow}>
            <MaterialIcons name="event" size={22} color={colors.primary} />
            <Text style={[styles.muted, { flex: 1 }]}>
              {t("live.scheduled", {
                date: new Date(ride.scheduledAt).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" }),
                time: new Date(ride.scheduledAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
              })}
            </Text>
          </View>
        )}
        {searching && <View style={styles.searchRow}><Pulse /><Text style={[styles.muted, { flex: 1 }]}>{t("live.searching")}{typeof ride.expiresInMinutes === "number" && ride.expiresInMinutes > 0 ? t("live.searchingMore", { min: ride.expiresInMinutes }) : ""}</Text></View>}
        {searching && pendingRouteLoading && <Text style={styles.muted}>{t("live.routeLoading")}</Text>}
        {searching && pendingRouteError && <Text style={styles.errorText}>{t("live.routeError")}</Text>}
        {ride.expired && <View style={styles.expiredBanner}><MaterialIcons name="search-off" size={18} color={ERROR_COLOR} /><Text style={styles.expiredText}>{t("live.expired")}</Text></View>}

        {offered && <DriverOfferCard ride={ride} onChanged={setRide} />}

        {ride.driver && !offered && (
          <View style={styles.driverCard}>
            <View style={styles.driverRow}>
              <View style={styles.avatar}><MaterialIcons name="verified-user" size={26} color={colors.primary} /></View>
              <View style={styles.driverInfo}>
                <Text style={styles.driverName} numberOfLines={1}>{maskPersonName(ride.driver.fullName, t("live.driverDefault"))}</Text>
                <Text style={styles.muted} numberOfLines={1}>{t(vehicleKey(ride.vehicleType))}</Text>
                <Text style={styles.muted} numberOfLines={1}>{maskBeninPhone(ride.driver.phone)}</Text>
              </View>
              {ride.status === "ARRIVED" ? (
                <View style={styles.arrivedBadge}><MaterialIcons name="check-circle" size={16} color={colors.primary} /><Text style={styles.arrivedBadgeText}>{t("live.arrivedBadge")}</Text></View>
              ) : !done && etaMinutes != null ? (
                <View style={styles.eta}><Text style={styles.etaValue}>{etaMinutes}</Text><Text style={styles.etaUnit}>{ride.status === "MATCHED" ? t("live.etaForYou") : t("live.etaUnit")}</Text></View>
              ) : null}
            </View>
            <Pressable style={styles.chatBtn} onPress={() => setChatOpen(true)} accessibilityLabel={t("live.chatA11y")}>
              <MaterialIcons name="chat-bubble-outline" size={18} color={colors.primary} />
              <Text style={styles.chatBtnText}>{t("live.chatBtn")}</Text>
            </Pressable>
            {!done && (
              <Pressable style={styles.chatBtn} onPress={handleShare} accessibilityRole="button">
                <MaterialIcons name="share" size={18} color={colors.primary} />
                <Text style={styles.chatBtnText}>{t("share.button")}</Text>
              </Pressable>
            )}
          </View>
        )}

        {ride.status === "ARRIVED" && <View style={styles.pinBanner}><MaterialIcons name="shield" size={20} color={colors.primary} /><View style={{ flex: 1 }}><Text style={styles.pinBannerTitle}>{ride.vehicleType.startsWith("ZEM_") ? t("live.arrived.zem") : t("live.arrived.car")}</Text><Text style={styles.pinBannerSub}>{ride.pickupCode ? t("live.pickup.sub") : t("live.pickup.wait")}</Text></View>{ride.pickupCode ? <View style={styles.pinCodePill}><Text style={styles.pinCodeText}>{ride.pickupCode}</Text></View> : <ActivityIndicator size="small" color={colors.primary} />}</View>}
        <RideStopPanel ride={ride} role="CLIENT" onChanged={setRide} />
        {ride.status === "IN_PROGRESS" && <View style={styles.pinBanner}><MaterialIcons name="verified-user" size={20} color={colors.primary} /><View style={{ flex: 1 }}><Text style={styles.pinBannerTitle}>{t("live.drop.title")}</Text><Text style={styles.pinBannerSub}>{ride.dropCode ? t("live.drop.sub") : t("live.drop.wait")}</Text></View>{ride.dropCode ? <View style={styles.pinCodePill}><Text style={styles.pinCodeText}>{ride.dropCode}</Text></View> : <ActivityIndicator size="small" color={colors.primary} />}</View>}
        <View style={{ gap: 2 }}>{!!destinationLabel && <Text style={styles.muted} numberOfLines={1}>→ {destinationLabel}</Text>}<Text style={styles.price}>{money(paidAmount(ride))} FCFA · {paymentLabel}</Text></View>
        {done && <View style={styles.paymentSummary}>
          <Text style={styles.paymentTitle}>{t("live.paid.title")}</Text>
          <Text style={styles.muted}>{t("live.paid.amount", { amount: money(paidAmount(ride)) })}{ride.priceMode === "PARTIAL" ? t("live.paid.partial") : ""}</Text>
          {walletBalance !== null ? (
            <Text style={styles.walletBalance}>{t("live.paid.balance", { amount: money(walletBalance) })}</Text>
          ) : walletRefreshing ? (
            <View style={styles.walletRefreshRow}><ActivityIndicator size="small" color={colors.primary} /><Text style={styles.muted}>{t("live.paid.refreshing")}</Text></View>
          ) : (
            <View style={styles.walletRefreshRow}>
              <Text style={styles.errorText}>{walletRefreshError ?? t("live.paid.refreshFailed")}</Text>
              <Pressable onPress={refreshWallet} disabled={walletRefreshing} style={styles.walletRetry}>
                <Text style={styles.walletRetryText}>{t("common.retry")}</Text>
              </Pressable>
            </View>
          )}
        </View>}
        {finished ? <Pressable style={styles.primaryBtn} onPress={done ? (onFinish ?? onClose) : onClose}><Text style={styles.primaryText}>{done ? t("live.finish") : ride.expired ? t("live.relaunch") : t("common.close")}</Text></Pressable> : <><>{cancellable && <Pressable style={styles.cancelBtn} onPress={handleCancelRide} disabled={cancelling}>{cancelling ? <ActivityIndicator size="small" color={ERROR_COLOR} /> : <Text style={styles.cancelText}>{t("live.cancel.confirm")}</Text>}</Pressable>}</><Pressable style={styles.secondaryBtn} onPress={() => setSheetHidden(true)}><Text style={styles.secondaryText}>{t("live.minimize")}</Text></Pressable></>}
        </ScrollView>
      </View>
      )}
      <RideChatModal visible={chatOpen} rideId={ride.id} myRole="CLIENT" peerName={ride.driver?.fullName} peerPhone={ride.driver?.phone} locked={finished} onClose={() => setChatOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  sos: { position: "absolute", right: 16, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: ERROR_COLOR, borderRadius: 20, paddingHorizontal: 14, height: 38, elevation: 4 },
  sosText: { color: "#fff", fontWeight: "800", fontSize: 14 },
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
  mapFab: { position: "absolute", right: 16, width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceContainerLowest, elevation: 10, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8 },
  showSheet: { position: "absolute", alignSelf: "center", left: "25%", right: "25%", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.full, paddingVertical: 12, elevation: 10, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8 },
  showSheetText: { color: colors.primary, fontWeight: "800", fontSize: 14 },
  secondaryBtn: { borderRadius: radius.full, paddingVertical: 12, paddingHorizontal: 24, alignItems: "center", borderWidth: 1.5, borderColor: colors.outline },
  secondaryText: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  cancelBtn: { borderRadius: radius.full, paddingVertical: 12, alignItems: "center", borderWidth: 1.5, borderColor: ERROR_COLOR },
  cancelText: { ...typography.labelMd, color: ERROR_COLOR, fontWeight: "700" },
  offline: { position: "absolute", left: spacing.md, right: spacing.md, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: ERROR_COLOR, borderRadius: radius.lg, padding: spacing.sm },
  offlineText: { ...typography.labelMd, color: "#fff" },
});
