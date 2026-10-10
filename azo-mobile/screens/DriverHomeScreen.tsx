import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, TextInput, StyleSheet, Pressable, ScrollView, Switch,
  ActivityIndicator, RefreshControl, Alert, Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { io, Socket } from "socket.io-client";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import {
  API_URL, Ride, VehicleType, errorMessage, getToken, placesApi, providersApi, ridesApi, walletApi,
} from "../services/api";
import { fcfa, relativeDay, VEHICLE_ICON, VEHICLE_LABEL } from "../utils/rideDisplay";
import { tarification } from "../services/tarification";
import { distanceKm, fmtKm } from "../utils/geo";
import RideChatModal from "../components/RideChatModal";
import { maskBeninPhone, maskPersonName } from "../utils/phone";

type Props = { onLogout: () => void; onOpenDossier?: () => void };
type LatLng = { latitude: number; longitude: number };
type GpsStatus = "idle" | "ok" | "denied" | "error";

const POLL_MS = 8000;
const OFFLINE_MSG = "Serveur injoignable — vérifie que le backend tourne et que l'IP dans .env est la bonne.";

const isToday = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
};

export default function DriverHomeScreen({ onLogout, onOpenDossier }: Props) {
  const [online, setOnline] = useState(false);
  const [pending, setPending] = useState<Ride[]>([]);
  const [history, setHistory] = useState<Ride[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [activeRide, setActiveRide] = useState<Ride | null>(null);
  // Véhicule déclaré dans le dossier prestataire : le radar ne présente que les
  // demandes correspondantes (Zem essence ≠ Zem électrique ; Gazelle ≠ Koala ≠ Léopard).
  const [myVehicle, setMyVehicle] = useState<VehicleType | null>(null);
  const [position, setPosition] = useState<LatLng | null>(null);
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>("idle");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [ridePlaces, setRidePlaces] = useState<{ origin?: string; destination?: string }>({});
  const [pendingDestinations, setPendingDestinations] = useState<Record<string, string>>({});
  const [chatOpen, setChatOpen] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [dropCodeInput, setDropCodeInput] = useState("");
  const [dropCodeEntryOpen, setDropCodeEntryOpen] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const pendingDestinationRequestsRef = useRef(new Set<string>());
  const activeRideRef = useRef<Ride | null>(null);
  activeRideRef.current = activeRide;
  // Dernière position connue, lue par le radar : une ref évite de redémarrer le
  // rafraîchissement périodique chaque fois que le GPS bouge (toutes les ~10 s).
  const positionRef = useRef<LatLng | null>(null);
  positionRef.current = position;

  /* ---------- Compte : portefeuille + historique + course en cours ---------- */
  const loadAccount = useCallback(async () => {
    const [walletRes, historyRes] = await Promise.allSettled([walletApi.get(), ridesApi.history()]);
    if (historyRes.status === "fulfilled") {
      setHistory(historyRes.value);
      setActiveRide((current) =>
        current ?? historyRes.value.find((r) => r.status === "MATCHED" || r.status === "ARRIVED" || r.status === "IN_PROGRESS") ?? null
      );
      setOffline(false);
    } else {
      setOffline(true);
    }
    if (walletRes.status === "fulfilled") setBalance(walletRes.value.balance);
  }, []);

  useEffect(() => {
    loadAccount().finally(() => setLoading(false));
  }, [loadAccount]);

  /* Véhicule du dossier prestataire (pour expliquer le filtrage du radar) */
  useEffect(() => {
    let cancelled = false;
    providersApi
      .me()
      .then((dossier) => {
        if (!cancelled) setMyVehicle(dossier?.provider?.activity?.vehicleType ?? null);
      })
      .catch(() => {
        /* dossier illisible : le radar reste utilisable, sans libellé de véhicule */
      });
    return () => { cancelled = true; };
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadAccount(), loadPending().catch(() => undefined)]);
    setRefreshing(false);
  }, [loadAccount]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Courses en attente (Zém Radar) ----------
   * La position du chauffeur est transmise au serveur : il écarte les demandes hors du
   * rayon de recherche (`radar.searchRadiusKm` de la configuration) et les classe de la
   * plus proche à la plus lointaine. Sans GPS, le radar reste utilisable.
   */
  const loadPending = useCallback(async () => {
    const rides = await ridesApi.pending(positionRef.current ?? undefined);
    setPending(rides);
    setOffline(false);
    return rides;
  }, []);

  useEffect(() => {
    if (!online || activeRide) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const rides = await loadPending();
        if (!cancelled) setPending(rides);
      } catch {
        if (!cancelled) setOffline(true);
      }
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [online, activeRide, loadPending]);

  /* ---------- Socket temps réel (position du chauffeur -> client) ---------- */
  useEffect(() => {
    if (!online) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }
    const socket = io(API_URL, {
      transports: ["websocket"],
      auth: { token: getToken() },
    });
    socketRef.current = socket;
    socket.on("connect_error", () => console.warn("Socket AZƆ̀ injoignable :", API_URL));
    // (Re)connexion (coupure réseau, 4G qui bascule…) : on repousse tout de suite la
    // dernière position connue, sinon le curseur du client reste figé jusqu'au prochain GPS.
    socket.on("connect", () => {
      const p = positionRef.current;
      const r = activeRideRef.current;
      if (p && r) socket.emit("driver:location", { rideId: r.id, lat: p.latitude, lng: p.longitude });
    });
    // Une nouvelle demande vient d'être publiée : on rafraîchit le radar tout de suite
    // au lieu d'attendre le prochain cycle (8 s).
    socket.on("ride:new", () => {
      loadPending().catch(() => undefined);
    });
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [online]);

  const emitPosition = useCallback((coords: LatLng, heading?: number | null) => {
    const ride = activeRideRef.current;
    const socket = socketRef.current;
    if (ride && socket?.connected) {
      socket.emit("driver:location", {
        rideId: ride.id,
        lat: coords.latitude,
        lng: coords.longitude,
        // Cap (degrés) : fait pivoter la flèche du curseur côté client, comme Google Maps.
        ...(typeof heading === "number" && Number.isFinite(heading) && heading >= 0 && heading < 360
          ? { heading }
          : {}),
      });
    }
  }, []);

  /* ---------- GPS réel (expo-location) ---------- */
  // Deux profils : course en cours = suivi live du curseur côté client (comme
  // Google Maps) ; sans course = position grossière pour économiser la batterie.
  const hasActiveRide = activeRide != null;
  useEffect(() => {
    if (!online) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;

    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== "granted") { setGpsStatus("denied"); return; }
        setGpsStatus("ok");
        sub = await Location.watchPositionAsync(
          hasActiveRide
            ? { accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 2500 }
            : { accuracy: Location.Accuracy.Balanced, distanceInterval: 25, timeInterval: 10000 },
          (pos) => {
            const coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
            setPosition(coords);
            emitPosition(coords, pos.coords.heading);
          }
        );
        if (cancelled) sub.remove();
      } catch (e) {
        console.warn("GPS error", e);
        setGpsStatus("error");
      }
    })();

    return () => { cancelled = true; sub?.remove(); };
  }, [online, hasActiveRide, emitPosition]);

  // La position bouge aussi quand le socket vient de se connecter : on renvoie la dernière.
  useEffect(() => {
    if (online && activeRide && position) emitPosition(position);
  }, [online, activeRide?.id, position?.latitude, position?.longitude]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Adresses lisibles de la course en cours (best effort) ---------- */
  useEffect(() => {
    if (!activeRide) { setRidePlaces({}); return; }
    let cancelled = false;
    (async () => {
      const [o, d] = await Promise.allSettled([
        placesApi.reverseGeocode(activeRide.originLat, activeRide.originLng),
        placesApi.reverseGeocode(activeRide.destLat, activeRide.destLng),
      ]);
      if (cancelled) return;
      setRidePlaces({
        origin: o.status === "fulfilled" ? o.value.address : undefined,
        destination: d.status === "fulfilled" ? d.value.address : undefined,
      });
    })();
    return () => { cancelled = true; };
  }, [activeRide?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    pending.forEach((ride) => {
      if (pendingDestinations[ride.id] || pendingDestinationRequestsRef.current.has(ride.id)) return;
      pendingDestinationRequestsRef.current.add(ride.id);
      placesApi
        .reverseGeocode(ride.destLat, ride.destLng)
        .then(({ address }) => {
          if (address.trim()) {
            setPendingDestinations((current) => ({ ...current, [ride.id]: address }));
          }
        })
        .catch((error) => {
          console.warn(`La destination de la demande ${ride.id} n'a pas pu être chargée :`, error);
        })
        .finally(() => pendingDestinationRequestsRef.current.delete(ride.id));
    });
  }, [pending, pendingDestinations]);

  /* ---------- Actions ---------- */
  const requests = useMemo(() => {
    const withDistance = pending.map((r) => ({
      ride: r,
      // Distance calculée par le serveur quand il a reçu notre position ; sinon,
      // calcul local (le radar doit rester utilisable sans GPS).
      km:
        typeof r.distanceKm === "number"
          ? r.distanceKm
          : position
            ? distanceKm(position, { latitude: r.originLat, longitude: r.originLng })
            : null,
    }));
    return withDistance.sort((a, b) => (a.km ?? 999) - (b.km ?? 999));
  }, [pending, position]);

  // Rayon de recherche en vigueur (configuration partagée avec le serveur).
  const searchRadiusKm: number = tarification().radar?.searchRadiusKm ?? 0;
  const expiryMinutes: number = tarification().radar?.pendingExpiryMinutes ?? 0;

  const stats = useMemo(() => {
    const done = history.filter((r) => r.status === "COMPLETED");
    const today = done.filter((r) => isToday(r.createdAt));
    const gainsToday = today.reduce((sum, r) => sum + (r.price - (r.commission ?? 0)), 0);
    const rated = done.filter((r) => typeof r.rating === "number");
    const rating = rated.length
      ? rated.reduce((sum, r) => sum + (r.rating ?? 0), 0) / rated.length
      : null;
    const refused = history.filter((r) => r.status === "CANCELLED" && r.driverId).length;
    return { gainsToday, countToday: today.length, rating, refused };
  }, [history]);

  const recent = useMemo(() => history.slice(0, 4), [history]);

  async function handleToggleOnline(value: boolean) {
    if (!value && activeRide) {
      Alert.alert("Course en cours", "Termine ou annule ta course avant de passer hors ligne.");
      return;
    }
    if (value && gpsStatus === "denied") {
      Alert.alert(
        "Localisation refusée",
        "Pour recevoir des courses, autorise la localisation dans les réglages du téléphone."
      );
    }
    setOnline(value);
    if (value) loadPending().catch(() => setOffline(true));
  }

  async function handleAccept(ride: Ride) {
    setBusy(true);
    try {
      const accepted = await ridesApi.accept(ride.id);
      setActiveRide(accepted);
      setPending((list) => list.filter((r) => r.id !== ride.id));
    } catch (e) {
      Alert.alert("Impossible d'accepter", errorMessage(e));
      loadPending().catch(() => undefined); // elle est peut-être déjà prise par un autre
    } finally {
      setBusy(false);
    }
  }

  async function handleArrive() {
    if (!activeRide) return;
    setBusy(true);
    try {
      setActiveRide(await ridesApi.arrive(activeRide.id));
      setPinInput("");
      Alert.alert(
        "Arrivée confirmée",
        "Le client a été averti. Demande-lui le code Bouclier affiché dans son application avant de démarrer."
      );
    } catch (e) {
      // La requête a pu aboutir côté serveur (réseau coupé à la réponse, double appui) :
      // on relit la course avant d'alarmer le chauffeur pour rien.
      try {
        const fresh = await ridesApi.get(activeRide.id);
        if (fresh.status === "ARRIVED" || fresh.status === "IN_PROGRESS") {
          setActiveRide(fresh);
          setPinInput("");
          setBusy(false);
          return;
        }
      } catch {
        // Pas de réseau non plus pour la relecture : on affiche l'erreur d'origine.
      }
      Alert.alert("Impossible de confirmer l'arrivée", errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleStart() {
    if (!activeRide) return;
    const clean = pinInput.replace(/\D/g, "");
    if (clean.length !== 4) {
      Alert.alert(
        "Code Bouclier AZƆ̀ requis",
        "Après avoir signalé ton arrivée, demande au client son code à 4 chiffres."
      );
      return;
    }
    setBusy(true);
    try {
      setActiveRide(await ridesApi.start(activeRide.id, clean));
      setPinInput("");
      setDropCodeInput("");
      setDropCodeEntryOpen(false);
    } catch (e) {
      Alert.alert("Démarrage impossible", errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleRequestDropCode() {
    if (!activeRide || activeRide.status !== "IN_PROGRESS") return;
    setBusy(true);
    try {
      await ridesApi.requestDropCode(activeRide.id);
      setDropCodeInput("");
      setDropCodeEntryOpen(true);
    } catch (e) {
      Alert.alert("Impossible de demander le code", errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function handleComplete() {
    if (!activeRide) return;
    const cleanPin = dropCodeInput.replace(/\D/g, "");
    if (cleanPin.length !== 4) {
      Alert.alert("Code d'arrivée requis", "Demande au client son code d'arrivée à 4 chiffres pour terminer la course.");
      return;
    }
    const gain = activeRide.price;
    Alert.alert(
      "Confirmer l'arrivée à destination ?",
      `Le paiement de ${fcfa(gain)} sera effectué après validation du code.`,
      [
        { text: "Pas encore", style: "cancel" },
        {
          text: "Valider et terminer",
          onPress: async () => {
            setBusy(true);
            try {
              const done = await ridesApi.complete(activeRide.id, cleanPin);
              setActiveRide(null);
              setDropCodeInput("");
              await loadAccount();
              const net = done.price - (done.commission ?? 0);
              Alert.alert("Course terminée 🎉", `+${fcfa(net)} sur ton portefeuille AZƆ̀ Pay.`);
            } catch (e) {
              Alert.alert("Impossible de terminer", errorMessage(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }

  function handleCancel() {
    if (!activeRide) return;
    Alert.alert("Annuler la course ?", "Le client sera prévenu et la course repartira en recherche pour un autre chauffeur.", [
      { text: "Garder la course", style: "cancel" },
      {
        text: "Annuler la course",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            await ridesApi.cancel(activeRide.id);
            setActiveRide(null);
            await loadAccount();
            loadPending().catch(() => undefined);
          } catch (e) {
            Alert.alert("Annulation impossible", errorMessage(e));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  function handleWithdraw() {
    Alert.alert(
      "Retrait Mobile Money",
      "Le retrait automatique vers MTN MoMo / Moov arrive avec le branchement FedaPay. En attendant, ton solde AZƆ̀ Pay est disponible dans l'onglet Portefeuille."
    );
  }

  function handleLogout() {
    Alert.alert("Déconnexion", "Quitter ton espace conducteur ?", [
      { text: "Annuler", style: "cancel" },
      { text: "Se déconnecter", style: "destructive", onPress: onLogout },
    ]);
  }

  const gpsWarning =
    gpsStatus === "denied" ? "Localisation refusée : le client ne verra pas ta position."
    : gpsStatus === "error" ? "GPS indisponible sur ce téléphone."
    : null;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        {onOpenDossier ? (
          <Pressable onPress={onOpenDossier} style={styles.iconButton} accessibilityLabel="Mon dossier">
            <MaterialIcons name="verified-user" size={20} color={colors.primary} />
          </Pressable>
        ) : (
          <View style={{ width: 40 }} />
        )}
        <Text style={styles.headerTitle}>Zém Radar</Text>
        <Pressable onPress={handleLogout} style={styles.iconButton} accessibilityLabel="Se déconnecter">
          <MaterialIcons name="logout" size={20} color={colors.onSurfaceVariant} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={[styles.statusCard, online && { borderColor: colors.primary, borderWidth: 1.5 }]}>
          <View style={styles.statusRow}>
            <View style={[styles.motorcycleIcon, { backgroundColor: online ? colors.primary : colors.outline }]}>
              <MaterialIcons name="two-wheeler" size={26} color={colors.onPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.statusTitle}>{online ? "EN LIGNE · Radar actif" : "Hors ligne"}</Text>
              <Text style={styles.statusSubtitle}>
                {online
                  ? position
                    ? `GPS actif · ${position.latitude.toFixed(4)}, ${position.longitude.toFixed(4)}`
                    : "Recherche de ta position…"
                  : "Appuie ci-dessous pour recevoir des courses"}
              </Text>
            </View>
            <Switch
              value={online}
              onValueChange={handleToggleOnline}
              trackColor={{ true: colors.primaryContainer, false: colors.surfaceContainer }}
              thumbColor="#fff"
            />
          </View>
          <Pressable
            style={[
              styles.giantToggleBtn,
              { backgroundColor: online ? colors.surfaceContainerHigh : colors.primary },
            ]}
            onPress={() => handleToggleOnline(!online)}
          >
            <MaterialIcons
              name={online ? "pause-circle-filled" : "play-circle-filled"}
              size={20}
              color={online ? colors.onSurface : "#fff"}
            />
            <Text
              style={[
                styles.giantToggleText,
                { color: online ? colors.onSurface : "#fff" },
              ]}
            >
              {online ? "PASSER EN PAUSE (HORS LIGNE)" : "PASSER EN LIGNE MAINTENANT"}
            </Text>
          </Pressable>
          {gpsWarning && (
            <View style={styles.warningRow}>
              <MaterialIcons name="location-off" size={16} color={colors.error} />
              <Text style={styles.warningText}>{gpsWarning}</Text>
            </View>
          )}
        </View>

        {offline && (
          <View style={styles.offlineBanner}>
            <MaterialIcons name="cloud-off" size={16} color={colors.tertiary} />
            <Text style={styles.offlineText}>{OFFLINE_MSG}</Text>
          </View>
        )}

        {/* --- Course en cours --- */}
        {activeRide && (
          <View style={styles.activeCard}>
            <View style={styles.activeHeader}>
              <Text style={styles.activeTitle}>
                {activeRide.status === "MATCHED"
                  ? "En route vers le client"
                  : activeRide.status === "ARRIVED"
                    ? "Arrivé au point de prise en charge"
                    : "Course en cours"}
              </Text>
              <View style={styles.pricePill}>
                <Text style={styles.pricePillText}>{fcfa(activeRide.price)}</Text>
              </View>
            </View>

            <Text style={styles.activeVehicle}>
              {VEHICLE_LABEL[activeRide.vehicleType]} · #{activeRide.id.slice(0, 6)}
            </Text>

            <View style={styles.routeRow}>
              <MaterialIcons name="trip-origin" size={16} color={colors.primary} />
              <Text style={styles.routeText} numberOfLines={1}>
                {ridePlaces.origin ?? `${activeRide.originLat.toFixed(4)}, ${activeRide.originLng.toFixed(4)}`}
              </Text>
            </View>
            <View style={styles.routeRow}>
              <MaterialIcons name="place" size={16} color={colors.secondary} />
              <Text style={styles.routeText} numberOfLines={1}>
                {ridePlaces.destination ?? `${activeRide.destLat.toFixed(4)}, ${activeRide.destLng.toFixed(4)}`}
              </Text>
            </View>

            {(activeRide.client?.fullName || activeRide.client?.phone) && (
              <View style={styles.clientRow}>
                <View style={styles.avatar}>
                  <MaterialIcons name="shield" size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.clientName}>
                    {maskPersonName(activeRide.client?.fullName, "Client AZƆ̀")}
                  </Text>
                  <Text style={styles.clientMeta}>
                    {maskBeninPhone(activeRide.client?.phone)} · AZƆ̀ Pay
                  </Text>
                </View>
                <Pressable
                  style={styles.chatPillBtn}
                  onPress={() => setChatOpen(true)}
                  accessibilityLabel="Ouvrir le chat sécurisé"
                >
                  <MaterialIcons name="chat-bubble-outline" size={16} color={colors.primary} />
                  <Text style={styles.chatPillText}>Message</Text>
                </Pressable>
              </View>
            )}

            {activeRide.status === "MATCHED" && (
              <View style={styles.arrivalNotice}>
                <MaterialIcons name="near-me" size={18} color={colors.primary} />
                <Text style={styles.arrivalNoticeText}>
                  Rejoins le point de prise en charge, puis appuie sur « Je suis arrivé ». Le client recevra une notification et te communiquera son code.
                </Text>
              </View>
            )}

            {activeRide.status === "ARRIVED" && (
              <View style={styles.pinBox}>
                <Text style={styles.pinLabel}>
                  Demande le code à 4 chiffres au client avant de démarrer
                </Text>
                <TextInput
                  style={styles.pinInput}
                  value={pinInput}
                  onChangeText={(v) => setPinInput(v.replace(/\D/g, "").slice(0, 4))}
                  placeholder="••••"
                  placeholderTextColor={colors.outline}
                  keyboardType="number-pad"
                  maxLength={4}
                />
              </View>
            )}

            {activeRide.status === "IN_PROGRESS" && dropCodeEntryOpen && (
              <View style={styles.pinBox}>
                <Text style={styles.pinLabel}>
                  À destination, demande le code d’arrivée à 4 chiffres au client
                </Text>
                <TextInput
                  style={styles.pinInput}
                  value={dropCodeInput}
                  onChangeText={(value) => setDropCodeInput(value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="••••"
                  placeholderTextColor={colors.outline}
                  keyboardType="number-pad"
                  maxLength={4}
                  accessibilityLabel="Code d'arrivée du client"
                />
              </View>
            )}

            {busy ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.sm }} />
            ) : activeRide.status === "MATCHED" ? (
              <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                <Pressable style={styles.primaryBtn} onPress={handleArrive}>
                  <MaterialIcons name="near-me" size={20} color="#fff" />
                  <Text style={styles.primaryBtnText}>Je suis arrivé</Text>
                </Pressable>
                <Pressable style={styles.ghostBtn} onPress={handleCancel}>
                  <Text style={styles.ghostBtnText}>Annuler la course</Text>
                </Pressable>
              </View>
            ) : activeRide.status === "ARRIVED" ? (
              <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                <Pressable style={styles.primaryBtn} onPress={handleStart}>
                  <MaterialIcons name="verified-user" size={20} color="#fff" />
                  <Text style={styles.primaryBtnText}>Valider le code & démarrer</Text>
                </Pressable>
                <Pressable style={styles.ghostBtn} onPress={handleCancel}>
                  <Text style={styles.ghostBtnText}>Annuler la course</Text>
                </Pressable>
              </View>
            ) : activeRide.status === "IN_PROGRESS" ? (
              <Pressable
                style={styles.primaryBtn}
                onPress={() => dropCodeEntryOpen ? handleComplete() : handleRequestDropCode()}
              >
                <MaterialIcons name={dropCodeEntryOpen ? "check-circle" : "place"} size={20} color="#fff" />
                <Text style={styles.primaryBtnText}>
                  {dropCodeEntryOpen ? "Valider le code et terminer" : "Arrivé à destination"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        )}

        {/* --- Gains & Objectif journalier --- */}
        <View style={styles.earningsCard}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={styles.earningsLabel}>Gains nets du jour</Text>
            <View style={styles.goalBadge}>
              <MaterialIcons name="emoji-events" size={14} color={colors.primary} />
              <Text style={styles.goalBadgeText}>
                Objectif : {Math.min(100, Math.round((stats.gainsToday / 15000) * 100))}%
              </Text>
            </View>
          </View>
          <Text style={styles.earningsValue}>{fcfa(stats.gainsToday)}</Text>
          <View style={styles.goalTrack}>
            <View
              style={[
                styles.goalFill,
                { width: `${Math.min(100, Math.round((stats.gainsToday / 15000) * 100))}%` },
              ]}
            />
          </View>
          <Text style={styles.progressLabel}>
            {stats.countToday} course{stats.countToday > 1 ? "s" : ""} terminée{stats.countToday > 1 ? "s" : ""}
            {balance !== null ? ` · Solde AZƆ̀ Pay : ${fcfa(balance)}` : " · Objectif 15 000 FCFA"}
          </Text>
        </View>

        <View style={styles.statsGrid}>
          <StatTile icon="local-taxi" value={String(stats.countToday)} label="Courses du jour" />
          <StatTile icon="star" value={stats.rating ? stats.rating.toFixed(2) : "—"} label="Note moyenne" />
          <StatTile icon="cancel" value={String(stats.refused)} label="Annulées" />
        </View>

        <Pressable style={styles.withdrawBtn} onPress={handleWithdraw}>
          <MaterialIcons name="bolt" size={18} color={colors.onPrimary} />
          <Text style={styles.withdrawText}>Retrait Express MoMo</Text>
        </Pressable>

        {/* --- Demandes proches --- */}
        {!activeRide && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Demandes proches</Text>
              {online && pending.length > 0 && (
                <Text style={styles.sectionBadge}>{pending.length}</Text>
              )}
            </View>
            {myVehicle && (
              <View style={styles.radarFilter}>
                <MaterialIcons name={VEHICLE_ICON[myVehicle]} size={16} color={colors.primary} />
                <Text style={styles.radarFilterText}>
                  Radar {VEHICLE_LABEL[myVehicle]} — tu ne vois que ces demandes
                  {searchRadiusKm > 0 ? `, dans un rayon de ${searchRadiusKm} km` : ""}
                  {expiryMinutes > 0 ? `, qui expirent après ${expiryMinutes} min` : ""}.
                </Text>
              </View>
            )}

            {!online ? (
              <Text style={styles.emptyText}>Passe en ligne pour voir les demandes autour de toi.</Text>
            ) : loading ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
            ) : requests.length === 0 ? (
              <Text style={styles.emptyText}>
                {myVehicle
                  ? `Aucune demande « ${VEHICLE_LABEL[myVehicle]} » ${
                      searchRadiusKm > 0 ? `dans un rayon de ${searchRadiusKm} km` : "autour de toi"
                    } pour l'instant. Reste en ligne : la liste se met à jour toute seule.`
                  : "Aucune demande pour l'instant. Reste en ligne : la liste se met à jour toute seule."}
              </Text>
            ) : (
              <View style={{ gap: spacing.sm }}>
                {requests.map(({ ride, km }) => (
                  <View key={ride.id} style={styles.requestCard}>
                    <View style={styles.requestIcon}>
                      <MaterialIcons name={VEHICLE_ICON[ride.vehicleType]} size={22} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.requestTitle}>
                        {VEHICLE_LABEL[ride.vehicleType]} · {fcfa(ride.price)}
                      </Text>
                      <Text style={styles.requestClient} numberOfLines={1}>
                        Client : {maskPersonName(ride.client?.fullName, "Client AZƆ̀")}
                      </Text>
                      <Text style={styles.requestDestination} numberOfLines={2}>
                        Destination : {pendingDestinations[ride.id] ?? `${ride.destLat.toFixed(4)}, ${ride.destLng.toFixed(4)}`}
                      </Text>
                      <Text style={styles.requestMeta}>
                        {km !== null ? `${fmtKm(km)} de toi · ` : ""}
                        {typeof ride.expiresInMinutes === "number" && ride.expiresInMinutes <= 5
                          ? `expire dans ${ride.expiresInMinutes} min · `
                          : ""}
                        demandée {relativeDay(ride.createdAt).toLowerCase()}
                      </Text>
                    </View>
                    <Pressable
                      style={[styles.acceptBtn, busy && styles.acceptBtnDisabled]}
                      onPress={() => handleAccept(ride)}
                      disabled={busy}
                    >
                      <Text style={styles.acceptBtnText}>Accepter</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {/* --- Activité récente --- */}
        <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>Activité récente</Text>
        {recent.length === 0 ? (
          <Text style={styles.emptyText}>Tes courses terminées apparaîtront ici.</Text>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {recent.map((r) => (
              <View key={r.id} style={styles.tripRow}>
                <MaterialIcons name={VEHICLE_ICON[r.vehicleType]} size={18} color={colors.onSurfaceVariant} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.tripText}>
                    Course #{r.id.slice(0, 6)} · {relativeDay(r.createdAt)}
                  </Text>
                  <Text style={styles.tripMeta}>{r.status === "COMPLETED" ? "Payée" : r.status === "CANCELLED" ? "Annulée" : "En cours"}</Text>
                </View>
                <Text style={[styles.tripAmount, r.status !== "COMPLETED" && { color: colors.onSurfaceVariant }]}>
                  {r.status === "COMPLETED" ? `+${fcfa(r.price - (r.commission ?? 0))}` : "—"}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {activeRide && (
        <RideChatModal
          visible={chatOpen}
          rideId={activeRide.id}
          myRole="PROVIDER"
          peerName={activeRide.client?.fullName}
          peerPhone={activeRide.client?.phone}
          onClose={() => setChatOpen(false)}
        />
      )}
    </SafeAreaView>
  );
}

function StatTile({ icon, value, label }: { icon: keyof typeof MaterialIcons.glyphMap; value: string; label: string }) {
  return (
    <View style={styles.statTile}>
      <MaterialIcons name={icon} size={18} color={colors.primary} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { height: 56, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  iconButton: { width: 40, height: 40, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...typography.headlineSm, color: colors.onSurface },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  statusCard: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  motorcycleIcon: { width: 48, height: 48, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  statusTitle: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
  statusSubtitle: { ...typography.bodySm, color: colors.onSurfaceVariant },
  giantToggleBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: radius.full, paddingVertical: 12, marginTop: spacing.sm },
  giantToggleText: { ...typography.labelMd, fontWeight: "800", letterSpacing: 0.4 },
  warningRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm, backgroundColor: colors.errorContainer, borderRadius: radius.md, padding: spacing.sm },
  warningText: { ...typography.labelSm, color: colors.error, flex: 1 },
  offlineBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.tertiaryFixed, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.md },
  offlineText: { ...typography.labelSm, color: colors.onTertiaryFixed, flex: 1 },
  activeCard: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1.5, borderColor: colors.primary, gap: 6 },
  activeHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  activeTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  activeVehicle: { ...typography.bodySm, color: colors.onSurfaceVariant },
  pricePill: { backgroundColor: colors.primaryFixed, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 4 },
  pricePillText: { ...typography.labelMd, color: colors.onPrimaryFixed, fontWeight: "800" },
  routeRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  routeText: { ...typography.bodySm, color: colors.onSurface, flex: 1 },
  clientRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceContainer, borderRadius: radius.lg, padding: spacing.sm, marginTop: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center" },
  clientName: { ...typography.bodyMd, color: colors.onSurface, fontWeight: "700" },
  clientMeta: { ...typography.labelSm, color: colors.onSurfaceVariant },
  callBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  chatPillBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.primaryFixed, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 8 },
  chatPillText: { ...typography.labelMd, color: colors.primary, fontWeight: "800" },
  arrivalNotice: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, backgroundColor: colors.primaryFixed, borderRadius: radius.lg, padding: spacing.sm, marginTop: spacing.xs },
  arrivalNoticeText: { ...typography.bodySm, color: colors.onSurfaceVariant, flex: 1 },
  pinBox: { backgroundColor: colors.surfaceContainerLow, borderRadius: radius.lg, padding: spacing.sm, marginTop: spacing.xs, gap: 6 },
  pinLabel: { ...typography.labelSm, color: colors.onSurfaceVariant, fontWeight: "700" },
  pinInput: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary, paddingHorizontal: 14, paddingVertical: 10, ...typography.headlineSm, color: colors.onSurface, fontWeight: "800", letterSpacing: 6, textAlign: "center" },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, marginTop: spacing.sm },
  primaryBtnText: { ...typography.labelMd, color: "#fff", fontWeight: "800", fontSize: 15 },
  ghostBtn: { alignItems: "center", paddingVertical: 10 },
  ghostBtnText: { ...typography.labelMd, color: colors.error, fontWeight: "700" },
  earningsCard: { backgroundColor: colors.primaryFixed, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  earningsLabel: { ...typography.labelMd, color: colors.onPrimaryFixed, fontWeight: "700" },
  earningsValue: { ...typography.displayLgMobile, color: colors.onPrimaryFixed, marginTop: 2 },
  goalBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#fff", paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full },
  goalBadgeText: { ...typography.labelSm, color: colors.primary, fontWeight: "800" },
  goalTrack: { height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.55)", overflow: "hidden", marginTop: 8, marginBottom: 4 },
  goalFill: { height: "100%", backgroundColor: colors.primary, borderRadius: 4 },
  progressLabel: { ...typography.labelSm, color: colors.onPrimaryFixed, marginTop: 4 },
  statsGrid: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  statTile: { flex: 1, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.sm, alignItems: "center", gap: 2, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  statValue: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  statLabel: { ...typography.labelSm, color: colors.onSurfaceVariant, textAlign: "center" },
  withdrawBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.secondary, borderRadius: radius.md, paddingVertical: 12, marginBottom: spacing.md },
  withdrawText: { ...typography.labelMd, color: colors.onSecondary, fontWeight: "700" },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: spacing.sm, marginTop: spacing.sm },
  sectionTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "700", marginBottom: spacing.sm, marginTop: spacing.sm },
  sectionBadge: { ...typography.labelSm, color: colors.onPrimary, backgroundColor: colors.secondary, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2, fontWeight: "800", overflow: "hidden" },
  radarFilter: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.primaryFixed, borderRadius: radius.md, paddingHorizontal: spacing.sm + 2, paddingVertical: 8, marginBottom: spacing.sm },
  radarFilterText: { ...typography.bodySm, color: colors.primary, fontWeight: "700", flex: 1 },
  emptyText: { ...typography.bodySm, color: colors.onSurfaceVariant, backgroundColor: colors.surfaceContainerLow, borderRadius: radius.md, padding: spacing.md },
  requestCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.md, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  requestIcon: { width: 44, height: 44, borderRadius: radius.full, backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center" },
  requestTitle: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
  requestClient: { ...typography.bodySm, color: colors.onSurface, fontWeight: "600" },
  requestDestination: { ...typography.bodySm, color: colors.onSurfaceVariant },
  requestMeta: { ...typography.bodySm, color: colors.onSurfaceVariant },
  acceptBtn: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: 16, paddingVertical: 10 },
  acceptBtnDisabled: { opacity: 0.5 },
  acceptBtnText: { ...typography.labelMd, color: "#fff", fontWeight: "800" },
  tripRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.md, padding: spacing.md },
  tripText: { ...typography.labelMd, color: colors.onSurface },
  tripMeta: { ...typography.labelSm, color: colors.onSurfaceVariant },
  tripAmount: { ...typography.labelMd, color: colors.primary, fontWeight: "800" },
});
