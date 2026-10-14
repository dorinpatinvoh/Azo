import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, TextInput, StyleSheet, Pressable, ScrollView, Switch,
  ActivityIndicator, RefreshControl, Alert, Linking, useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { io, Socket } from "socket.io-client";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import {
  API_URL, Ride, VehicleType, errorMessage, getToken, paidAmount, placesApi, providersApi, ridesApi, walletApi,
} from "../services/api";
import { fcfa, relativeDay, VEHICLE_ICON, VEHICLE_LABEL } from "../utils/rideDisplay";
import { tarification } from "../services/tarification";
import { distanceKm, fmtKm } from "../utils/geo";
import { filterFix, snapToPolyline, type FilterState } from "../utils/gpsFilter";
import RideChatModal from "../components/RideChatModal";
import OSMMapView, { type OSMMarker } from "../components/OSMMapView";
import RideStopPanel from "../components/RideStopPanel";
import EarningsCard from "../components/EarningsCard";
import StandingBanner from "../components/StandingBanner";
import PillTabBar, { type PillTabItem } from "../components/PillTabBar";
import RateClientModal from "../components/RateClientModal";
import { tr } from "../i18n";
import { getRideRoute, getTripRoute } from "../services/routing";
import NearbyClientsMap, { clientLabel } from "../components/NearbyClientsMap";
import DriverOfferWaiting from "../components/DriverOfferWaiting";
import { nearbyRadiusKm } from "../config/radar";
import { ApiError } from "../services/api";
import { maskBeninPhone, maskPersonName } from "../utils/phone";

type Props = { onLogout: () => void; onOpenDossier?: () => void; onOpenSupport?: () => void; onOpenWallet?: () => void };

// Barre du bas de l'espace Zem : « Portefeuille » ouvre l'écran AZƆ̀ Pay, les autres onglets restent dans cet écran.
type ZemTab = "home" | "gains" | "activity" | "wallet" | "profile";
const ZEM_TABS: PillTabItem<ZemTab>[] = [
  { id: "home", label: "Accueil", icon: "radio-outline", iconActive: "radio" },
  { id: "gains", label: "Gains", icon: "stats-chart-outline", iconActive: "stats-chart" },
  { id: "activity", label: "Activité", icon: "receipt-outline", iconActive: "receipt" },
  { id: "wallet", label: "AZƆ̀ Pay", icon: "wallet-outline", iconActive: "wallet" },
  { id: "profile", label: "Profil", icon: "person-outline", iconActive: "person" },
];
const ZEM_TITLES: Record<ZemTab, string> = { home: "Zém Radar", gains: "Mes gains", activity: "Mon activité", wallet: "AZƆ̀ Pay", profile: "Mon profil" };
type LatLng = { latitude: number; longitude: number };
type GpsStatus = "idle" | "ok" | "denied" | "error";

const POLL_MS = 8000;
const NO_LINE: { latitude: number; longitude: number }[] = [];
const OFFLINE_MSG = "Serveur injoignable — vérifie que le backend tourne et que l'IP dans .env est la bonne.";

const isToday = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
};

// Issues de proposition déjà annoncées au Zem (évite de répéter l'alerte à chaque réouverture).
const announcedEndings = new Set<string>();

export default function DriverHomeScreen({ onLogout, onOpenDossier, onOpenSupport, onOpenWallet }: Props) {
  const [tab, setTab] = useState<ZemTab>("home");
  const [online, setOnline] = useState(false);
  // Course terminée : le Zem note son client (null = rien à noter)
  const [rateTarget, setRateTarget] = useState<{ rideId: string; name: string } | null>(null);
  const [pending, setPending] = useState<Ride[]>([]);
  const [history, setHistory] = useState<Ride[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [activeRide, setActiveRide] = useState<Ride | null>(null);
  // Le Zem a accepté : le client regarde son profil avant de le choisir (statut OFFERED)
  const [offered, setOffered] = useState<Ride | null>(null);
  // Trajet « course » (client -> destination), tracé en pointillés tant que le client n'est pas monté
  const [tripRoute, setTripRoute] = useState<{ rideId: string; coordinates: LatLng[] } | null>(null);
  // Nombre de clients disponibles donné par le serveur (sinon on compte les demandes reçues)
  const [summary, setSummary] = useState<{ count: number; nearestKm: number | null } | null>(null);
  const [summaryTick, setSummaryTick] = useState(0);
  // Véhicule déclaré dans le dossier prestataire : le radar ne présente que les
  // demandes correspondantes (Zem essence ≠ Zem électrique ; Gazelle ≠ Koala ≠ Léopard).
  const [myVehicle, setMyVehicle] = useState<VehicleType | null>(null);
  const [position, setPosition] = useState<LatLng | null>(null);
  // Cap du GPS (degrés) : fait pivoter la flèche de mon curseur sur ma carte.
  const [heading, setHeading] = useState<number | undefined>();
  // Position du client, reçue en direct tant qu'il rejoint le point de départ.
  const [clientPos, setClientPos] = useState<(LatLng & { heading?: number }) | null>(null);
  const lastClientAtRef = useRef(0);
  // Vitesse et précision du dernier point GPS, envoyées avec chaque position.
  const fixRef = useRef<{ speed?: number; accuracy?: number }>({});
  // Dernier point GPS retenu après filtrage (points vagues ou sauts ignorés, arrêt sans tremblement)
  const filterRef = useRef<FilterState | null>(null);
  // Précision (m) du point affiché : dessine le cercle de précision autour de « Moi »
  const [accuracy, setAccuracy] = useState<number | undefined>();

  // Position du client reçue par socket (`client:location`) ou dans l'accusé de `ride:join`
  // (dernière position conservée par le serveur : le client apparaît tout de suite). Une
  // position plus ancienne que celle déjà affichée est ignorée.
  const applyClientLocation = useCallback((p?: { lat?: number; lng?: number; heading?: number; speed?: number; at?: number } | null) => {
    if (typeof p?.lat !== "number" || typeof p?.lng !== "number" || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
    const at = typeof p.at === "number" ? p.at : Date.now();
    if (at < lastClientAtRef.current) return;
    lastClientAtRef.current = at;
    // Cap affiché seulement si le client avance : à l’arrêt le cap GPS n’est pas fiable.
    const moving = typeof p.speed !== "number" || p.speed >= 1;
    const heading = moving && typeof p.heading === "number" && Number.isFinite(p.heading) ? p.heading : undefined;
    setClientPos({ latitude: p.lat, longitude: p.lng, ...(heading !== undefined ? { heading } : {}) });
  }, []);

  const joinRide = useCallback(
    (socket: Socket, rideId: string) => {
      socket.emit("ride:join", { rideId }, (res?: { joined?: string | null; clientLocation?: { lat: number; lng: number; at?: number } | null }) => {
        if (res?.joined) applyClientLocation(res.clientLocation);
      });
    },
    [applyClientLocation]
  );
  // Itinéraire routier vers l'étape en cours (client, puis destination).
  const [driveRoute, setDriveRoute] = useState<{ rideId: string; status: string; coordinates: LatLng[] } | null>(null);
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
  // Carte agrandie : sur une moto on veut voir loin, 240 px est trop petit.
  const [mapExpanded, setMapExpanded] = useState(false);
  const { height: windowHeight } = useWindowDimensions();

  const socketRef = useRef<Socket | null>(null);
  const pendingDestinationRequestsRef = useRef(new Set<string>());
  const activeRideRef = useRef<Ride | null>(null);
  activeRideRef.current = activeRide;
  // Dernière position connue, lue par le radar : une ref évite de redémarrer le
  // rafraîchissement périodique chaque fois que le GPS bouge (toutes les ~10 s).
  const positionRef = useRef<LatLng | null>(null);
  positionRef.current = position;
  const headingRef = useRef<number | undefined>(undefined);
  headingRef.current = heading;

  /* ---------- Compte : portefeuille + historique + course en cours ---------- */
  const loadAccount = useCallback(async () => {
    const [walletRes, historyRes] = await Promise.allSettled([walletApi.get(), ridesApi.history()]);
    if (historyRes.status === "fulfilled") {
      setHistory(historyRes.value);
      setActiveRide((current) =>
        current ?? historyRes.value.find((r) => r.status === "MATCHED" || r.status === "ARRIVED" || r.status === "IN_PROGRESS") ?? null
      );
      setOffered((current) => current ?? historyRes.value.find((r) => r.status === "OFFERED") ?? null);
      setOffline(false);
    } else {
      setOffline(true);
    }
    if (walletRes.status === "fulfilled") setBalance(walletRes.value.balance);
  }, []);

  useEffect(() => {
    loadAccount().finally(() => setLoading(false));
  }, [loadAccount]);

  // Reprise après redémarrage : proposition encore en cours, ou issue de la dernière (le Zem n'est plus rattaché à la course).
  useEffect(() => {
    let cancelled = false;
    ridesApi
      .currentOffer()
      .then(async ({ offer, lastEnded }) => {
        if (cancelled) return;
        if (offer) {
          const ride = await ridesApi.get(offer.rideId);
          if (!cancelled && ride.status === "OFFERED") setOffered((current) => current ?? ride);
        } else if (lastEnded && !announcedEndings.has(lastEnded.rideId)) {
          announcedEndings.add(lastEnded.rideId);
          if (lastEnded.outcome !== "approved") endOfferRef.current(lastEnded.rideId, lastEnded.outcome);
        }
      })
      .catch(() => undefined); // route absente (ancien serveur) ou réseau : le reste du flux couvre ces cas
    return () => { cancelled = true; };
  }, []);

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
   * rayon de recherche (`radar.searchRadiusKm` de la configuration) et les classent de la demande la plus
   * récente à la plus ancienne. Sans GPS, le radar reste utilisable.
   */
  const loadPending = useCallback(async () => {
    const rides = await ridesApi.pending(positionRef.current ?? undefined, nearbyRadiusKm());
    setPending(rides);
    setOffline(false);
    return rides;
  }, []);

  // La proposition est terminée sans que le client ait choisi ce Zem : on libère l'écran et on explique.
  const endOfferRef = useRef<(id: string, outcome?: string | null) => void>(() => undefined);
  const endOffer = useCallback(
    (id: string, outcome?: string | null) => {
      setOffered((current) => (current && current.id === id ? null : current));
      const message =
        outcome === "declined" ? "Le client a choisi un autre Zem."
        : outcome === "withdrawn" ? "Tu as retiré ta proposition."
        : outcome === "cancelled" ? "Le client a annulé sa demande."
        : outcome === "expired" ? "Le client n'a pas répondu à temps."
        : "Le client a choisi un autre Zem ou n'a pas répondu à temps.";
      Alert.alert("Proposition terminée", message + " Tu peux accepter une autre demande.");
      loadPending().catch(() => undefined);
    },
    [loadPending]
  );
  endOfferRef.current = endOffer;


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

  /* ---------- Nombre de clients disponibles (résumé du serveur, repli : comptage local) ---------- */
  const summaryKey = position ? `${position.latitude.toFixed(2)},${position.longitude.toFixed(2)}` : null;
  useEffect(() => {
    if (!online || activeRide || offered || !positionRef.current) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    const load = () => {
      const here = positionRef.current;
      if (!here) return;
      ridesApi
        .pendingSummary(here, nearbyRadiusKm())
        .then((value) => { if (!cancelled) setSummary({ count: value.count, nearestKm: value.nearestKm }); })
        // Route absente (serveur pas encore à jour) : on compte les demandes reçues
        .catch(() => { if (!cancelled) setSummary(null); });
    };
    load();
    const timer = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [online, activeRide, offered, summaryKey, summaryTick]); // eslint-disable-line react-hooks/exhaustive-deps

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
      // Sans `ride:join`, le Zem ne reçoit rien de la room de la course (position du client).
      if (r) joinRide(socket, r.id);
      if (p && r) socket.emit("driver:location", { rideId: r.id, lat: p.latitude, lng: p.longitude, ts: Date.now() });
    });
    socket.on("client:location", (p: { lat?: number; lng?: number; heading?: number; speed?: number; at?: number }) => applyClientLocation(p));
    // Une nouvelle demande vient d'être publiée : on rafraîchit le radar tout de suite
    // au lieu d'attendre le prochain cycle (8 s).
    socket.on("ride:new", () => {
      loadPending().catch(() => undefined);
      setSummaryTick((n) => n + 1);
    });
    // Une demande a quitté le radar (prise par un autre Zem, annulée, expirée) : son point disparaît.
    // Fin de la proposition du Zem / choix du client (voir DEMANDE_BACKEND_FIN_PROPOSITION_ZEM.md)
    // Le client a ouvert la popup : l'écran d'attente du Zem le dit
    socket.on("ride:offer-seen", (p: { rideId?: string; at?: string }) => {
      if (!p?.rideId) return;
      setOffered((prev) => (prev && prev.id === p.rideId ? { ...prev, offerSeenAt: p.at ?? new Date().toISOString() } : prev));
    });
    socket.on("ride:offer-ended", (p: { rideId?: string; outcome?: string }) => {
      if (p?.rideId) endOffer(p.rideId, p.outcome ?? null);
    });
    socket.on("ride:offer-approved", async (p: { rideId?: string }) => {
      if (!p?.rideId) return;
      try {
        const fresh = await ridesApi.get(p.rideId);
        setOffered(null);
        setActiveRide(fresh);
      } catch {
        // la relecture toutes les 3 s prendra le relais
      }
    });
    // Le client annule la course déjà acceptée : on la retire et on prévient tout de suite
    socket.on("ride:cancelled", (p: { rideId?: string }) => {
      if (!p?.rideId || p.rideId !== activeRideRef.current?.id) return;
      setActiveRide(null);
      loadPending().catch(() => undefined);
      Alert.alert("Course annulée", "Le client a annulé la course. Tu peux accepter une autre demande.");
    });
    socket.on("ride:removed", () => {
      loadPending().catch(() => undefined);
      setSummaryTick((n) => n + 1);
    });
    // Course partielle : distance parcourue en direct et demande d'arrêt du client.
    socket.on("ride:progress", (p: { rideId?: string; traveledMeters?: number; currentPrice?: number }) => {
      if (p?.rideId !== activeRideRef.current?.id || typeof p.traveledMeters !== "number") return;
      setActiveRide((r) => (r ? { ...r, traveledMeters: p.traveledMeters, currentPrice: p.currentPrice ?? r.currentPrice } : r));
    });
    socket.on("ride:stop", (p: { rideId?: string; stopRequest?: Ride["stopRequest"] }) => {
      if (p?.rideId !== activeRideRef.current?.id) return;
      setActiveRide((r) => (r ? { ...r, stopRequest: p.stopRequest ?? null } : r));
    });
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [online, endOffer]);

  // Pendant la course, on relit son état toutes les 3 s : le client peut avoir demandé ou
  // accepté l'arrêt, ce qui termine la course sans action du Zem. Filet si le socket tombe.
  useEffect(() => {
    if (!online || !activeRide || !["MATCHED", "ARRIVED", "IN_PROGRESS"].includes(activeRide.status)) return;
    const id = activeRide.id;
    let cancelled = false;
    const tick = async () => {
      try {
        const fresh = await ridesApi.get(id);
        if (cancelled) return;
        if (fresh.status === "COMPLETED" || fresh.status === "CANCELLED") {
          setActiveRide(null);
          await loadAccount();
          Alert.alert(
            fresh.status === "COMPLETED" ? "Course terminée" : "Course annulée",
            fresh.status === "COMPLETED"
              ? "Le paiement a été effectué sur ton portefeuille AZƆ̀ Pay."
              : "Le client a annulé la course. Tu peux accepter une autre demande."
          );
          return;
        }
        setActiveRide((prev) => (prev && prev.id === id ? { ...prev, ...fresh } : prev));
      } catch {
        // Réseau coupé : on réessaie au prochain cycle.
      }
    };
    const timer = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [online, activeRide?.id, activeRide?.status, loadAccount]);

  // Filet de sécurité : le délai est dépassé depuis 12 s et le serveur n'a toujours rien changé (serveur
  // en retard, coupure) — on libère l'écran au lieu de rester bloqué sur « 0 s ».
  useEffect(() => {
    if (!offered?.offerExpiresAt) return;
    const ends = Date.parse(offered.offerExpiresAt);
    if (Number.isNaN(ends)) return;
    const id = offered.id;
    const timer = setTimeout(() => endOffer(id, "expired"), Math.max(0, ends - Date.now()) + 12000);
    return () => clearTimeout(timer);
  }, [offered?.id, offered?.offerExpiresAt, endOffer]);

  // Proposition envoyée : on relit la course toutes les 3 s jusqu'à la décision du client.
  useEffect(() => {
    if (!offered) return;
    const id = offered.id;
    let cancelled = false;
    const tick = async () => {
      try {
        const fresh = await ridesApi.get(id);
        if (cancelled) return;
        if (fresh.status === "OFFERED") {
          setOffered((prev) => (prev && prev.id === id ? { ...prev, ...fresh } : prev));
          return;
        }
        if (fresh.status === "MATCHED" || fresh.status === "ARRIVED" || fresh.status === "IN_PROGRESS") {
          setOffered(null);
          setActiveRide(fresh);
        } else {
          endOffer(id, fresh.offerOutcome ?? (fresh.status === "CANCELLED" ? "cancelled" : null));
        }
      } catch (e) {
        // Le serveur répond 403/404 au Zem dont la proposition est terminée (il n'est plus rattaché à la
        // course) : ce n'est PAS une coupure réseau. Avant, ce cas était ignoré et l'écran restait figé.
        if (!cancelled && e instanceof ApiError && (e.status === 403 || e.status === 404)) endOffer(id, null);
        // Autre erreur (réseau coupé) : on réessaie au prochain cycle.
      }
    };
    const timer = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [offered?.id, endOffer]);

  const emitPosition = useCallback((coords: LatLng, heading?: number | null) => {
    const ride = activeRideRef.current;
    const socket = socketRef.current;
    if (ride && socket?.connected) {
      socket.emit("driver:location", {
        rideId: ride.id,
        lat: coords.latitude,
        lng: coords.longitude,
        // Horodatage d'émission : permet d'ignorer une position arrivée en retard.
        ts: Date.now(),
        ...(typeof fixRef.current.speed === "number" ? { speed: fixRef.current.speed } : {}),
        ...(typeof fixRef.current.accuracy === "number" ? { accuracy: Math.round(fixRef.current.accuracy) } : {}),
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
    if (!online) { filterRef.current = null; return; }
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;

    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== "granted") { setGpsStatus("denied"); return; }
        setGpsStatus("ok");
        // Premier point tout de suite : dernier point connu (instantané), puis un vrai point GPS précis.
        const showFirst = (pos: Location.LocationObject) => {
          if (cancelled || filterRef.current) return;
          const f = filterFix(null, { ...pos.coords, timestamp: pos.timestamp });
          if (!f) return;
          filterRef.current = f;
          setPosition({ latitude: f.latitude, longitude: f.longitude });
          setAccuracy(f.accuracy);
        };
        Location.getLastKnownPositionAsync({ maxAge: 60000, requiredAccuracy: 100 }).then((p) => { if (p) showFirst(p); }).catch(() => undefined);
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).then(showFirst).catch(() => undefined);
        sub = await Location.watchPositionAsync(
          hasActiveRide
            ? { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 1, timeInterval: 1000 }
            : { accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 3000 },
          (pos) => {
            // Filtrage : un point vague ou aberrant ne déplace plus le curseur
            const kept = filterFix(filterRef.current, { ...pos.coords, timestamp: pos.timestamp });
            if (!kept) return;
            filterRef.current = kept;
            setAccuracy(kept.accuracy);
            const coords = { latitude: kept.latitude, longitude: kept.longitude };
            const h = pos.coords.heading;
            const s = pos.coords.speed;
            // Vitesse GPS négative = inconnue. En dessous de ~1 m/s (arrêt, demi-tour) le cap
            // GPS n'est pas fiable : on le masque plutôt que d'afficher une flèche qui tourne.
            const speed = typeof s === "number" && Number.isFinite(s) && s >= 0 ? s : undefined;
            const reliableHeading =
              typeof h === "number" && Number.isFinite(h) && h >= 0 && h < 360 && (speed === undefined || speed >= 1);
            fixRef.current = { speed, accuracy: pos.coords.accuracy ?? undefined };
            setPosition(coords);
            setHeading(reliableHeading ? h : undefined);
            emitPosition(coords, reliableHeading ? h : undefined);
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

  // Le GPS n'émet que si le Zem a bougé d'au moins 5 m : à l'arrêt (il attend le client,
  // feu rouge), plus rien ne partait et le client ne voyait aucune position. Pendant une
  // course on renvoie donc la dernière position connue toutes les 2 s.
  useEffect(() => {
    if (!online || !activeRide?.id) return;
    const timer = setInterval(() => {
      const p = positionRef.current;
      if (p) emitPosition(p, headingRef.current);
    }, 2000);
    return () => clearInterval(timer);
  }, [online, activeRide?.id, emitPosition]);

  // Nouvelle course : on oublie la position du client de la précédente et on rejoint la room
  // de la nouvelle (le socket est déjà connecté quand la course est acceptée).
  useEffect(() => {
    lastClientAtRef.current = 0;
    // Le serveur renvoie la dernière position du client dans la course (MATCHED / ARRIVED) : le point
    // reste visible après un redémarrage de l'application, sans attendre le prochain envoi du client.
    setClientPos(
      activeRide &&
        (activeRide.status === "MATCHED" || activeRide.status === "ARRIVED") &&
        typeof activeRide.clientLat === "number" &&
        typeof activeRide.clientLng === "number"
        ? { latitude: activeRide.clientLat, longitude: activeRide.clientLng }
        : null
    );
    const socket = socketRef.current;
    if (activeRide?.id && socket?.connected) joinRide(socket, activeRide.id);
  }, [activeRide?.id, joinRide]);

  /* ---------- Carte du Zem : son déplacement, le client, la destination ---------- */
  // Étape en cours : vers le client tant qu'il n'est pas monté, puis vers la destination.
  const routeTarget = useMemo<LatLng | null>(() => {
    if (!activeRide) return null;
    if (activeRide.status === "MATCHED") return { latitude: activeRide.originLat, longitude: activeRide.originLng };
    if (activeRide.status === "IN_PROGRESS") return { latitude: activeRide.destLat, longitude: activeRide.destLng };
    return null;
  }, [activeRide?.id, activeRide?.status, activeRide?.originLat, activeRide?.originLng, activeRide?.destLat, activeRide?.destLng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clé arrondie à ~100 m : l'itinéraire public (OSRM) n'est recalculé qu'après un vrai
  // déplacement, pas à chaque point GPS.
  const routeKey = position ? `${position.latitude.toFixed(3)},${position.longitude.toFixed(3)}` : null;
  useEffect(() => {
    const ride = activeRideRef.current;
    const from = positionRef.current;
    if (!ride || !routeTarget || !from) {
      setDriveRoute(null);
      return;
    }
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 10000);
    const timer = setTimeout(() => {
      getRideRoute(ride.id, from, routeTarget, controller.signal)
        .then((route) => { if (active) setDriveRoute({ rideId: ride.id, status: ride.status, coordinates: route.coordinates }); })
        .catch(() => { /* on garde le tracé précédent : OSRM public peut être indisponible */ })
        .finally(() => clearTimeout(timeout));
    }, 500);
    return () => { active = false; clearTimeout(timer); clearTimeout(timeout); controller.abort(); };
  }, [routeKey, routeTarget?.latitude, routeTarget?.longitude, activeRide?.id, activeRide?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // La carte montre TOUJOURS trois choses : ma position, le client (sa position en direct, sinon le
  // point de départ demandé, étiqueté à son nom) et l'arrivée.
  const mapMarkers = useMemo<OSMMarker[]>(() => {
    if (!activeRide) return [];
    const who = clientLabel(activeRide);
    const beforePickup = activeRide.status === "MATCHED" || activeRide.status === "ARRIVED";
    const liveClient = !!clientPos && beforePickup;
    const list: OSMMarker[] = [
      {
        id: "origin",
        coordinate: { latitude: activeRide.originLat, longitude: activeRide.originLng },
        title: beforePickup && !liveClient ? `${who} · Départ` : "Départ",
        color: "green",
      },
      { id: "destination", coordinate: { latitude: activeRide.destLat, longitude: activeRide.destLng }, title: "Arrivée", color: "red" },
    ];
    // Le client n'est montré en direct que tant qu'il rejoint le point de départ : une fois sur la
    // moto, sa position est celle du Zem.
    if (liveClient && clientPos) {
      list.push({ id: "client", coordinate: clientPos, title: who, color: "orange", heading: clientPos.heading });
    }
    // Curseur accroché à la route (≤ 25 m du tracé) : il suit la chaussée, pas le bruit du GPS
    if (position) {
      const onRoad = driveRoute && activeRide && driveRoute.rideId === activeRide.id && driveRoute.status === activeRide.status ? snapToPolyline(position, driveRoute.coordinates) : position;
      list.push({ id: "driver", coordinate: onRoad, title: "Moi", color: "blue", heading, accuracy });
    }
    return list;
  }, [driveRoute, accuracy, activeRide?.id, activeRide?.status, activeRide?.originLat, activeRide?.originLng, activeRide?.destLat, activeRide?.destLng, activeRide?.client?.displayName, activeRide?.client?.fullName, position, heading, clientPos]); // eslint-disable-line react-hooks/exhaustive-deps

  // Le tracé n'est montré que s'il correspond à la course et à l'étape en cours.
  const mapPolyline = useMemo<LatLng[]>(
    () =>
      driveRoute && activeRide && driveRoute.rideId === activeRide.id && driveRoute.status === activeRide.status
        ? driveRoute.coordinates
        : [],
    [driveRoute, activeRide?.id, activeRide?.status] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Suite du trajet (client -> destination) en pointillés, tant que le client n'est pas monté.
  useEffect(() => {
    const ride = activeRideRef.current;
    if (!ride || (ride.status !== "MATCHED" && ride.status !== "ARRIVED")) {
      setTripRoute(null);
      return;
    }
    const controller = new AbortController();
    let active = true;
    getTripRoute(
      ride.id,
      { latitude: ride.originLat, longitude: ride.originLng },
      { latitude: ride.destLat, longitude: ride.destLng },
      controller.signal
    )
      .then((route) => { if (active) setTripRoute({ rideId: ride.id, coordinates: route.coordinates }); })
      .catch(() => { /* pas de tracé en pointillés : les points restent visibles */ });
    return () => { active = false; controller.abort(); };
  }, [activeRide?.id, activeRide?.status]);
  const tripPolyline = useMemo<LatLng[]>(
    () =>
      tripRoute && activeRide && tripRoute.rideId === activeRide.id && (activeRide.status === "MATCHED" || activeRide.status === "ARRIVED")
        ? tripRoute.coordinates
        : NO_LINE,
    [tripRoute, activeRide?.id, activeRide?.status] // eslint-disable-line react-hooks/exhaustive-deps
  );

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
    // L'ordre est celui du serveur : de la demande la plus récente à la plus ancienne
    return withDistance.filter((item) => item.km === null || item.km <= nearbyRadiusKm());
  }, [pending, position]);

  // Rayon de recherche en vigueur (configuration partagée avec le serveur).
  const searchRadiusKm: number = nearbyRadiusKm();
  const expiryMinutes: number = tarification().radar?.pendingExpiryMinutes ?? 0;
  // Nombre de clients disponibles : celui du serveur, sinon les demandes reçues dans le rayon
  const nearbyCount = summary?.count ?? requests.length;

  const stats = useMemo(() => {
    const done = history.filter((r) => r.status === "COMPLETED");
    const today = done.filter((r) => isToday(r.createdAt));
    const gainsToday = today.reduce((sum, r) => sum + (paidAmount(r) - (r.commission ?? 0)), 0);
    const rated = done.filter((r) => typeof r.rating === "number");
    const rating = rated.length
      ? rated.reduce((sum, r) => sum + (r.rating ?? 0), 0) / rated.length
      : null;
    const refused = history.filter((r) => r.status === "CANCELLED" && r.driverId).length;
    return { gainsToday, countToday: today.length, rating, refused };
  }, [history]);

  const recent = useMemo(() => history.slice(0, 4), [history]);

  async function handleToggleOnline(value: boolean) {
    if (!value && (activeRide || offered)) {
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
      setPending((list) => list.filter((r) => r.id !== ride.id));
      // Le serveur demande la confirmation du client (OFFERED) ; sinon la course démarre tout de suite.
      if (accepted.status === "OFFERED") setOffered(accepted);
      else setActiveRide(accepted);
    } catch (e) {
      Alert.alert("Impossible d'accepter", errorMessage(e));
      loadPending().catch(() => undefined); // elle est peut-être déjà prise par un autre
    } finally {
      setBusy(false);
    }
  }

  async function handleWithdrawOffer() {
    if (!offered) return;
    setBusy(true);
    try {
      await ridesApi.withdrawOffer(offered.id);
      setOffered(null);
      loadPending().catch(() => undefined);
    } catch (e) {
      Alert.alert("Annulation impossible", errorMessage(e));
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

  // Arrêt accepté par le client : plus besoin d'« Arrivé à destination », on demande directement le code.
  const stopAccepted = activeRide?.status === "IN_PROGRESS" && activeRide.stopRequest?.accepted === true;
  useEffect(() => {
    if (stopAccepted) setDropCodeEntryOpen(true);
  }, [stopAccepted]);

  function handleComplete() {
    if (!activeRide) return;
    const cleanPin = dropCodeInput.replace(/\D/g, "");
    if (cleanPin.length !== 4) {
      Alert.alert("Code d'arrivée requis", "Demande au client son code d'arrivée à 4 chiffres pour terminer la course.");
      return;
    }
    const gain = stopAccepted && typeof activeRide.stopRequest?.price === "number" ? activeRide.stopRequest.price : activeRide.price;
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
              const finishedName = clientLabel(activeRide);
              setActiveRide(null);
              setRateTarget({ rideId: done.id ?? activeRide.id, name: finishedName });
              setDropCodeInput("");
              await loadAccount();
              const net = paidAmount(done) - (done.commission ?? 0);
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

  // Une course ou une proposition en cours ramène sur l'accueil : c'est là que le Zem agit
  useEffect(() => {
    if (activeRide || offered) setTab("home");
  }, [activeRide?.id, offered?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{ZEM_TITLES[tab]}</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {tab === "home" && (
        <>
        <StandingBanner />

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

            <View style={[styles.liveMap, mapExpanded && { height: Math.round(windowHeight * 0.62) }]}>
              <OSMMapView
                center={position ?? { latitude: activeRide.originLat, longitude: activeRide.originLng }}
                markers={mapMarkers}
                polyline={mapPolyline}
                secondaryPolyline={tripPolyline}
                // La caméra garde TOUT visible : moi, le client, le départ et l'arrivée avant la prise en
                // charge ; moi et l'arrivée pendant la course (elle ne se recadre que si un point approche du bord).
                fitMarkerIds={
                  activeRide.status === "MATCHED" || activeRide.status === "ARRIVED"
                    ? ["driver", "client", "origin", "destination"]
                    : ["driver", "destination"]
                }
              />
              {!position && (
                <View style={styles.liveMapHint}>
                  <Text style={styles.liveMapHintText}>
                    {gpsStatus === "denied" ? "Active la localisation pour voir ta position" : "Recherche de ta position GPS…"}
                  </Text>
                </View>
              )}
              <Pressable
                style={styles.liveMapExpand}
                onPress={() => setMapExpanded((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={mapExpanded ? "Réduire la carte" : "Agrandir la carte"}
              >
                <MaterialIcons name={mapExpanded ? "fullscreen-exit" : "fullscreen"} size={22} color={colors.primary} />
              </Pressable>
            </View>

            <RideStopPanel ride={activeRide} role="DRIVER" onChanged={setActiveRide} />

            <View style={styles.routeRow}>
              <MaterialIcons name="trip-origin" size={16} color={colors.primary} />
              <Text style={styles.routeText} numberOfLines={1}>
                {activeRide.originLabel ?? ridePlaces.origin ?? `${activeRide.originLat.toFixed(4)}, ${activeRide.originLng.toFixed(4)}`}
              </Text>
            </View>
            <View style={styles.routeRow}>
              <MaterialIcons name="place" size={16} color={colors.secondary} />
              <Text style={styles.routeText} numberOfLines={1}>
                {activeRide.destLabel ?? ridePlaces.destination ?? `${activeRide.destLat.toFixed(4)}, ${activeRide.destLng.toFixed(4)}`}
              </Text>
            </View>

            {(activeRide.client?.fullName || activeRide.client?.phone) && (
              <View style={styles.clientRow}>
                <View style={styles.avatar}>
                  <MaterialIcons name="shield" size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.clientName}>
                    {clientLabel(activeRide)}
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
                  {stopAccepted
                    ? "Arrêt accepté : demande son code d’arrivée à 4 chiffres au client"
                    : "À destination, demande le code d’arrivée à 4 chiffres au client"}
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

        </>
        )}

        {tab === "gains" && (
        <>
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

        <EarningsCard refreshKey={history.length} />

        <View style={styles.statsGrid}>
          <StatTile icon="local-taxi" value={String(stats.countToday)} label="Courses du jour" />
          <StatTile icon="star" value={stats.rating ? stats.rating.toFixed(2) : "—"} label="Note moyenne" />
          <StatTile icon="cancel" value={String(stats.refused)} label="Annulées" />
        </View>

        <Pressable style={styles.withdrawBtn} onPress={handleWithdraw}>
          <MaterialIcons name="bolt" size={18} color={colors.onPrimary} />
          <Text style={styles.withdrawText}>Retrait Express MoMo</Text>
        </Pressable>

        </>
        )}

        {tab === "home" && (
        <>
        {/* --- Proposition envoyée : le client regarde ton profil avant de te choisir --- */}
        {!activeRide && offered && <DriverOfferWaiting ride={offered} busy={busy} onWithdraw={handleWithdrawOffer} position={position} heading={heading} />}

        {/* --- Demandes proches --- */}
        {!activeRide && !offered && (
          <>
            {online && (
              <NearbyClientsMap
                position={position}
                heading={heading}
                accuracy={accuracy}
                requests={requests}
                count={nearbyCount}
                radiusKm={nearbyRadiusKm()}
                gpsHint={gpsStatus === "denied" ? "Active la localisation pour voir ta position" : "Recherche de ta position GPS…"}
              />
            )}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Demandes proches</Text>
              {online && nearbyCount > 0 && (
                <Text style={styles.sectionBadge}>{nearbyCount}</Text>
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
                        Client : {clientLabel(ride)}
                      </Text>
                      {ride.client && typeof ride.client.rides === "number" ? (
                        <Text style={styles.requestMeta} numberOfLines={1}>
                          {ride.client.rides === 0 && !ride.client.ratedCount
                            ? tr("cr.new")
                            : ride.client.rating != null
                              ? tr("cr.stats", { rating: ride.client.rating.toFixed(1), count: ride.client.ratedCount ?? 0, rides: ride.client.rides })
                              : tr("cr.noRating", { rides: ride.client.rides })}
                        </Text>
                      ) : null}
                      <Text style={styles.requestDestination} numberOfLines={2}>
                        Destination : {ride.destLabel ?? pendingDestinations[ride.id] ?? `${ride.destLat.toFixed(4)}, ${ride.destLng.toFixed(4)}`}
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

        </>
        )}

        {tab === "activity" && (
        <>
        {/* --- Activité récente --- */}
        <Text style={styles.sectionTitle}>Activité récente</Text>
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
                  {r.status === "COMPLETED" ? `+${fcfa(paidAmount(r) - (r.commission ?? 0))}` : "—"}
                </Text>
              </View>
            ))}
          </View>
        )}
        </>
        )}

        {tab === "profile" && (
          <View style={{ gap: spacing.sm }}>
            {myVehicle ? (
              <View style={styles.profileRow}>
                <MaterialIcons name={VEHICLE_ICON[myVehicle]} size={22} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.profileRowTitle}>Mon véhicule</Text>
                  <Text style={styles.profileRowSub}>{VEHICLE_LABEL[myVehicle]}</Text>
                </View>
              </View>
            ) : null}
            {onOpenDossier ? (
              <Pressable style={styles.profileRow} onPress={onOpenDossier} accessibilityRole="button">
                <MaterialIcons name="verified-user" size={22} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.profileRowTitle}>Mon dossier</Text>
                  <Text style={styles.profileRowSub}>Pièces, statut de validation</Text>
                </View>
                <MaterialIcons name="chevron-right" size={22} color={colors.onSurfaceVariant} />
              </Pressable>
            ) : null}
            {onOpenSupport ? (
              <Pressable style={styles.profileRow} onPress={onOpenSupport} accessibilityRole="button">
                <MaterialIcons name="support-agent" size={22} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.profileRowTitle}>Assistance</Text>
                  <Text style={styles.profileRowSub}>Écrire à l'équipe AZƆ̀</Text>
                </View>
                <MaterialIcons name="chevron-right" size={22} color={colors.onSurfaceVariant} />
              </Pressable>
            ) : null}
            <Pressable style={styles.profileRow} onPress={handleLogout} accessibilityRole="button">
              <MaterialIcons name="logout" size={22} color={colors.error} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.profileRowTitle, { color: colors.error }]}>Se déconnecter</Text>
              </View>
            </Pressable>
          </View>
        )}
      </ScrollView>

      <PillTabBar
        items={ZEM_TABS}
        active={tab}
        onNavigate={(next) => {
          if (next === "wallet") onOpenWallet?.();
          else setTab(next);
        }}
      />

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

      {/* Notation du client : hors du bloc « course active », la course vient de se terminer */}
      <RateClientModal
        visible={!!rateTarget}
        clientName={rateTarget?.name ?? ""}
        onSkip={() => setRateTarget(null)}
        onRate={async (stars) => {
          const target = rateTarget;
          setRateTarget(null);
          if (!target) return;
          try {
            await ridesApi.rateClient(target.rideId, stars);
            Alert.alert(tr("cr.thanks"));
          } catch (e) {
            Alert.alert(tr("cr.failed"), errorMessage(e));
          }
        }}
      />
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
  liveMap: { height: 240, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surfaceContainer, marginVertical: spacing.sm },
  liveMapExpand: { position: "absolute", left: 8, top: 8, width: 38, height: 38, borderRadius: 19, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", elevation: 4 },
  liveMapHint: { position: "absolute", left: 8, right: 8, bottom: 8, backgroundColor: "rgba(255,255,255,0.92)", borderRadius: radius.sm, paddingVertical: 6, paddingHorizontal: 10 },
  liveMapHintText: { ...typography.labelSm, color: colors.onSurfaceVariant, textAlign: "center" },
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
  profileRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.md, padding: spacing.md },
  profileRowTitle: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
  profileRowSub: { ...typography.bodySm, color: colors.onSurfaceVariant },
  tripRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.md, padding: spacing.md },
  tripText: { ...typography.labelMd, color: colors.onSurface },
  tripMeta: { ...typography.labelSm, color: colors.onSurfaceVariant },
  tripAmount: { ...typography.labelMd, color: colors.primary, fontWeight: "800" },
});
