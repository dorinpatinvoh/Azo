import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { FONT } from "../theme/fontNormalize";
import { API_URL, Delivery, deliveryApi, errorMessage, getToken, providersApi, userApi, walletApi, type UserProfile } from "../services/api";
import { io } from "socket.io-client";
import ClientTrackMap from "../components/ClientTrackMap";
import TripDistanceBanner from "../components/TripDistanceBanner";
import { fmtTraveled } from "../utils/geo";
import { formatBeninPhoneDisplay, maskBeninPhone, maskPersonName } from "../utils/phone";
import RideChatModal from "../components/RideChatModal";
import { useCourierTracking } from "../hooks/useCourierTracking";
import * as Location from "expo-location";
import OSMMapView, { type OSMMarker } from "../components/OSMMapView";
import PillTabBar, { type PillTabItem } from "../components/PillTabBar";
import Avatar from "../components/Avatar";
import AvatarSheet from "../components/AvatarSheet";
import LanguageSheet from "../components/LanguageSheet";
import { useAvatar } from "../utils/avatar";
import { commissionNotice, VEHICLE_LABEL } from "../utils/rideDisplay";
import PhoneSupportBanner from "../components/PhoneSupportBanner";
import { languageInfo, useI18n } from "../i18n";
import { displayName, initials } from "./ProfileScreen";
import { BrandAlert } from "../components/BrandAlert";
import { useProfilePhotoReminder } from "../hooks/useProfilePhotoReminder";

type Props = {
  onLogout: () => void;
  onOpenDossier?: () => void;
  onOpenSupport?: () => void;
  onOpenWallet?: () => void;
  /** Informations personnelles : nom, e-mail, contact d'urgence, numéro, photo, langue (écran partagé). */
  onOpenInfo?: () => void;
  onOpenNotifications?: () => void;
};

const POLL_MS = 8000;
const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} F`;

const PACKAGE_META: Record<string, { label: string; icon: keyof typeof MaterialIcons.glyphMap }> = {
  doc: { label: "Document / Pli express", icon: "drafts" },
  small: { label: "Petit colis (< 5 kg)", icon: "shopping-bag" },
  medium: { label: "Colis moyen (< 15 kg)", icon: "inventory-2" },
  personal: { label: "Coursier personnel (Courses & Achats)", icon: "directions-run" },
};

const isToday = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );
};

// Barre du bas : « AZƆ̀ Pay » ouvre le portefeuille, les autres onglets restent dans cet écran.
export type CourierTab = "home" | "gains" | "history" | "wallet" | "profile";
export const COURIER_TABS: PillTabItem<CourierTab>[] = [
  { id: "home", label: "Missions", icon: "bicycle-outline", iconActive: "bicycle" },
  { id: "gains", label: "Gains", icon: "stats-chart-outline", iconActive: "stats-chart" },
  { id: "history", label: "Historique", icon: "receipt-outline", iconActive: "receipt" },
  { id: "wallet", label: "AZƆ̀ Pay", icon: "wallet-outline", iconActive: "wallet" },
  { id: "profile", label: "Profil", icon: "person-outline", iconActive: "person" },
];
const COURIER_TITLES: Record<CourierTab, string> = { home: "Mes missions", gains: "Mes gains", history: "Historique", wallet: "AZƆ̀ Pay", profile: "Mon profil" };

// Garde l'onglet et l'état en ligne quand on ouvre une autre page (portefeuille, informations…)
/** Retient l'onglet choisi depuis la barre du bas de l'écran AZƆ̀ Pay. */
export function rememberCourierTab(tab: string) {
  if (tab === "home" || tab === "gains" || tab === "history" || tab === "profile") rememberedCourier.tab = tab;
}
const rememberedCourier: { tab: CourierTab; online: boolean } = { tab: "home", online: true };
export default function CourierHomeScreen({ onLogout, onOpenDossier, onOpenSupport, onOpenWallet, onOpenInfo, onOpenNotifications }: Props) {
  const { lang } = useI18n();
  const avatarUri = useAvatar();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [langOpen, setLangOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const { ensurePhoto } = useProfilePhotoReminder(() => setAvatarOpen(true));
  useEffect(() => {
    userApi.me().then(setUser).catch(() => undefined);
  }, []);
  const [tab, setTab] = useState<CourierTab>(rememberedCourier.tab === "wallet" ? "home" : rememberedCourier.tab);
  useEffect(() => {
    rememberedCourier.tab = tab;
  }, [tab]);
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [tab]);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (tab === "home") return false;
      setTab("home");
      return true;
    });
    return () => sub.remove();
  }, [tab]);
  const [online, setOnline] = useState(rememberedCourier.online);
  useEffect(() => {
    rememberedCourier.online = online;
  }, [online]);
  const [pending, setPending] = useState<Delivery[]>([]);
  // Spécialité et véhicule du dossier : on voit ainsi quelles missions sont attendues (coursier personnel ou colis express)
  const [activityLine, setActivityLine] = useState<string | null>(null);
  useEffect(() => {
    providersApi
      .me()
      .then((me) => {
        const a = me.provider?.activity;
        if (!a) return;
        const kind = a.categoryId === "COURSIER_PERSONNEL" ? "Coursier personnel" : "Livreur express";
        const veh = a.vehicleType ? VEHICLE_LABEL[a.vehicleType] : null;
        setActivityLine(veh ? `${kind} · ${veh}` : kind);
      })
      .catch(() => undefined);
  }, []);
  // Position du coursier : sert à ne montrer que les missions dans un rayon de 20 km
  const [myPos, setMyPos] = useState<{ latitude: number; longitude: number } | null>(null);
  const [history, setHistory] = useState<Delivery[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [otpInput, setOtpInput] = useState("");
  const [simBannerCode, setSimBannerCode] = useState<string | null>(null);
  const [simBannerSec, setSimBannerSec] = useState<number>(0);
  const [chatOpen, setChatOpen] = useState(false);

  const activeDelivery = useMemo(
    () => history.find((d) => d.status === "MATCHED" || d.status === "IN_PROGRESS") ?? null,
    [history]
  );

  // Proposition envoyée, en attente de la décision du client (il regarde ton profil)
  const offeredDelivery = useMemo(() => history.find((d) => d.status === "OFFERED") ?? null, [history]);
  const [offerNow, setOfferNow] = useState(Date.now());
  useEffect(() => {
    if (!offeredDelivery) return;
    const t = setInterval(() => setOfferNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [offeredDelivery?.id]);

  // Coursier personnel : le GPS suit la mission pour calculer les kilomètres réellement parcourus
  // Distance parcourue en direct (renvoyée par le serveur à chaque position envoyée)
  const [liveMeters, setLiveMeters] = useState<number | null>(null);
  useEffect(() => setLiveMeters(null), [activeDelivery?.id, activeDelivery?.status]);
  useCourierTracking(activeDelivery && ["MATCHED", "IN_PROGRESS"].includes(activeDelivery.status) ? activeDelivery.id : null, setLiveMeters);
  const doneMeters = Math.max(liveMeters ?? 0, activeDelivery?.traveledMeters ?? 0);
  // Coursier personnel : c'est une course (on accompagne un client), pas une livraison de colis
  const personalMission = activeDelivery?.mode === "PERSONAL";

  const currentSimCode = useMemo(() => {
    if (!activeDelivery) return null;
    // Seul le code de ramassage / de départ peut s'afficher (en simulation) ; le code de remise ne vient jamais chez le coursier : le destinataire le lui donne
    const raw = activeDelivery.status === "MATCHED" ? activeDelivery.pickupCode : null;
    return raw && /^\d{4}$/.test(raw) ? raw : null;
  }, [activeDelivery]);

  function showSimCodeFor5Seconds(code: string | null) {
    if (!code) return;
    setSimBannerCode(code);
    setSimBannerSec(5);
  }

  useEffect(() => {
    if (currentSimCode) {
      showSimCodeFor5Seconds(currentSimCode);
    }
  }, [currentSimCode, activeDelivery?.status]);

  useEffect(() => {
    if (!simBannerCode) return;
    const t = setInterval(() => {
      setSimBannerSec((prev) => {
        if (prev <= 1) {
          clearInterval(t);
          setSimBannerCode(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [simBannerCode]);

  const loadAccount = useCallback(async () => {
    let near: { latitude: number; longitude: number } | undefined;
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status === "granted") {
        const pos = (await Location.getLastKnownPositionAsync({ maxAge: 60000 })) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
        near = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setMyPos(near);
      }
    } catch {
      // sans GPS, on liste toutes les missions
    }
    const [wRes, hRes, pRes] = await Promise.allSettled([
      walletApi.get(),
      deliveryApi.courierHistory(),
      deliveryApi.pending(near),
    ]);
    if (wRes.status === "fulfilled") setBalance(wRes.value.balance);
    if (hRes.status === "fulfilled") setHistory(hRes.value);
    if (pRes.status === "fulfilled") setPending(pRes.value);
  }, []);

  useEffect(() => {
    loadAccount().finally(() => setLoading(false));
  }, [loadAccount]);

  useEffect(() => {
    if (!online) return;
    // Pendant qu'une proposition attend la décision du client, on relit toutes les 3 s pour passer à la carte dès son accord
    const timer = setInterval(() => {
      loadAccount().catch(() => undefined);
    }, offeredDelivery ? 3000 : POLL_MS);
    return () => clearInterval(timer);
  }, [online, loadAccount, !!offeredDelivery]);

  // Temps réel : le client a choisi ce coursier, ou la proposition est terminée (refusée, expirée, annulée)
  useEffect(() => {
    if (!online) return;
    const socket = io(API_URL, { transports: ["websocket"], auth: { token: getToken() } });
    const refresh = () => loadAccount().catch(() => undefined);
    socket.on("delivery:offer-approved", refresh);
    socket.on("delivery:offer-ended", refresh);
    return () => {
      socket.disconnect();
    };
  }, [online, loadAccount]);

  async function onRefresh() {
    setRefreshing(true);
    await loadAccount();
    setRefreshing(false);
  }

  const stats = useMemo(() => {
    const done = history.filter((d) => d.status === "COMPLETED");
    const today = done.filter((d) => isToday(d.createdAt));
    const gainsToday = today.reduce(
      (sum, d) => sum + (d.price - (d.commission ?? Math.round(d.price * 0.15))),
      0
    );
    const gainsTotal = done.reduce((sum, d) => sum + (d.price - (d.commission ?? Math.round(d.price * 0.15))), 0);
    return { gainsToday, gainsTotal, todayCount: today.length, totalCount: done.length };
  }, [history]);

  async function handleAccept(id: string) {
    setBusy(true);
    try {
      await deliveryApi.accept(id, myPos ?? undefined);
      setOtpInput("");
      await loadAccount();
      BrandAlert.alert("Proposition envoyée", "Le client regarde ton profil et a quelques secondes pour te choisir. Tu passes à la carte dès son accord.");
    } catch (e) {
      BrandAlert.alert("Mission indisponible", errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleWithdraw() {
    if (!offeredDelivery) return;
    setBusy(true);
    try {
      await deliveryApi.withdrawOffer(offeredDelivery.id);
      await loadAccount();
    } catch (e) {
      BrandAlert.alert("Action impossible", errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  // Coursier personnel : « Je suis arrivé » (le client est prévenu et donne son code de départ), comme un Speeder sur une course simple
  async function handleArrive() {
    if (!activeDelivery) return;
    setBusy(true);
    try {
      await deliveryApi.arrive(activeDelivery.id);
      await loadAccount();
      BrandAlert.alert("Arrivée signalée ✅", "Ton client a été prévenu. Demande-lui son code de départ à 4 chiffres, puis appuie sur « Démarrer la course ».");
    } catch (e) {
      BrandAlert.alert("Impossible de confirmer l'arrivée", errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmOtp() {
    if (!activeDelivery) return;
    const clean = otpInput.replace(/\D/g, "");
    if (clean.length !== 4) {
      BrandAlert.alert("Code à 4 chiffres", personalMission ? "Saisis le code à 4 chiffres donné par ton client." : "Saisis le code à 4 chiffres fourni par le client ou le destinataire.");
      return;
    }
    setBusy(true);
    try {
      if (activeDelivery.status === "MATCHED") {
        await deliveryApi.confirmPickup(activeDelivery.id, clean);
        setOtpInput("");
        await loadAccount();
        BrandAlert.alert(
          personalMission ? "Course démarrée ✅" : "Ramassage validé ✅",
          personalMission
            ? "Les kilomètres comptent à partir de maintenant. Quand vous avez terminé, demande à ton client le code de fin à 4 chiffres."
            : "Colis pris en charge ! Dirige-toi vers l'adresse de livraison et demande le code de remise à 4 chiffres au destinataire."
        );
      } else {
        // Le prix final (coursier personnel : kilomètres réellement parcourus) vient de la réponse du serveur
        const done = await deliveryApi.confirmDelivery(activeDelivery.id, clean);
        setOtpInput("");
        await loadAccount();
        const gross = done.price ?? activeDelivery.price;
        const commission = done.commission ?? Math.round(gross * 0.15);
        BrandAlert.alert(
          personalMission ? "Course terminée 🎉" : "Livraison terminée 🎉",
          commissionNotice(gross, commission, done.phoneCommission ?? 0)
        );
      }
    } catch (e) {
      BrandAlert.alert("Code invalide", errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function handleCancelMission() {
    if (!activeDelivery) return;
    BrandAlert.alert(
      personalMission ? "Annuler cette course" : "Annuler cette mission",
      personalMission ? "Veux-tu vraiment te désister ? La réservation sera reproposée aux autres coursiers." : "Veux-tu vraiment te désister ? La mission sera reproposée aux autres coursiers.",
      [
        { text: "Continuer la mission", style: "cancel" },
        {
          text: "Se désister",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await deliveryApi.cancel(activeDelivery.id);
              setOtpInput("");
              await loadAccount();
            } catch (e) {
              BrandAlert.alert("Impossible d'annuler", errorMessage(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }

  function confirmExit() {
    BrandAlert.alert("Espace Coursier & Livreur", "Que souhaites-tu faire ?", [
      { text: "Annuler", style: "cancel" },
      ...(onOpenDossier ? [{ text: "Mon dossier KYC", onPress: onOpenDossier }] : []),
      {
        text: "Se déconnecter",
        style: "destructive",
        onPress: () => {
          rememberedCourier.tab = "home";
          rememberedCourier.online = true;
          onLogout();
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      {/* Barre d'application : photo, titre de l'onglet, état en ligne, notifications */}
      <View style={styles.cbBar}>
        <Pressable onPress={() => setTab("profile")} accessibilityRole="button" accessibilityLabel="Mon profil">
          <Avatar uri={avatarUri} initials={initials(user)} size={44} fontSize={16} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.cbTitle} numberOfLines={1}>
            {tab === "home" && user?.firstName ? `Bonjour, ${user.firstName}` : COURIER_TITLES[tab]}
          </Text>
          <View style={styles.cbStatus}>
            <View style={[styles.cbDot, { backgroundColor: online ? colors.primary : colors.outline }]} />
            <Text style={styles.cbStatusText}>{online ? "En ligne · missions actives" : "Hors ligne"}</Text>
          </View>
        </View>
        <Switch
          value={online}
          onValueChange={(value) => {
            // Photo de profil obligatoire pour recevoir des missions
            if (value && !ensurePhoto()) return;
            setOnline(value);
          }}
          trackColor={{ false: colors.surfaceContainerHigh, true: colors.primaryFixed }}
          thumbColor={online ? colors.primary : colors.outline}
        />
        {onOpenNotifications ? (
          <Pressable onPress={onOpenNotifications} style={styles.cbBell} accessibilityRole="button" accessibilityLabel="Notifications">
            <MaterialIcons name="notifications-none" size={22} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.muted}>Chargement de tes missions…</Text>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
          keyboardShouldPersistTaps="handled"
        >
          <PhoneSupportBanner />
          {tab === "home" && (
          <>
          {/* Mission en cours (double OTP) */}
          {activeDelivery ? (
            <View style={styles.activeCard}>
              <View style={styles.activeHeader}>
                <View style={styles.activeBadge}>
                  <MaterialIcons name={personalMission ? "directions-run" : "local-shipping"} size={16} color="#fff" />
                  <Text style={styles.activeBadgeText}>
                    {activeDelivery.status === "MATCHED"
                      ? personalMission ? (activeDelivery.courierArrivedAt ? "ÉTAPE 1/2 · ARRIVÉ · CODE DE DÉPART" : "ÉTAPE 1/2 · REJOINS TON CLIENT") : "ÉTAPE 1/2 · ALLER AU RAMASSAGE"
                      : personalMission ? "ÉTAPE 2/2 · COURSE EN COURS" : "ÉTAPE 2/2 · EN LIVRAISON"}
                  </Text>
                </View>
                <Text style={styles.activePrice}>
                  Net :{" "}
                  {fcfa(
                    activeDelivery.price -
                      (activeDelivery.commission ?? Math.round(activeDelivery.price * 0.15))
                  )}
                </Text>
              </View>

              <Text style={styles.packageTitle}>
                {personalMission ? "Course personnelle" : PACKAGE_META[activeDelivery.packageType]?.label ?? "Mission de livraison"}
              </Text>

              {/* Barre de progression visuelle en 3 étapes */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginVertical: 4 }}>
                <View
                  style={{
                    flex: 1,
                    paddingVertical: 6,
                    paddingHorizontal: 8,
                    borderRadius: radius.md,
                    backgroundColor: colors.primary,
                    alignItems: "center",
                  }}
                >
                  <Text style={{ ...typography.labelSm, color: "#fff", fontFamily: FONT.extrabold, fontSize: 10 }}>
                    {personalMission ? "1. Rejoindre" : "1. Ramassage"}
                  </Text>
                </View>
                <MaterialIcons name="chevron-right" size={16} color={colors.primary} />
                <View
                  style={{
                    flex: 1,
                    paddingVertical: 6,
                    paddingHorizontal: 8,
                    borderRadius: radius.md,
                    backgroundColor:
                      activeDelivery.status === "IN_PROGRESS"
                        ? colors.primary
                        : colors.surfaceContainerLow,
                    alignItems: "center",
                  }}
                >
                  <Text
                    style={{
                      ...typography.labelSm,
                      color: activeDelivery.status === "IN_PROGRESS" ? "#fff" : colors.onSurfaceVariant,
                      fontWeight: "800",
                      fontSize: 10,
                    }}
                  >
                    {personalMission ? "2. En course" : "2. En route"}
                  </Text>
                </View>
                <MaterialIcons name="chevron-right" size={16} color={colors.outline} />
                <View
                  style={{
                    flex: 1,
                    paddingVertical: 6,
                    paddingHorizontal: 8,
                    borderRadius: radius.md,
                    backgroundColor: colors.surfaceContainerLow,
                    alignItems: "center",
                  }}
                >
                  <Text style={{ ...typography.labelSm, color: colors.onSurfaceVariant, fontFamily: FONT.bold, fontSize: 10 }}>
                    {personalMission ? "3. Fin" : "3. Encaissement"}
                  </Text>
                </View>
              </View>

              <View style={styles.routeBox}>
                <View style={styles.routeStep}>
                  <MaterialIcons name="trip-origin" size={16} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.routeLabel}>{personalMission ? "Rendez-vous avec ton client" : "Ramassage (Expéditeur)"}</Text>
                    <Text style={styles.routeAddress}>{activeDelivery.pickupAddress}</Text>
                  </View>
                </View>
                <View style={styles.routeDivider} />
                <View style={styles.routeStep}>
                  <MaterialIcons name="place" size={16} color={colors.secondary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.routeLabel}>{personalMission ? "Destination" : "Remise (Destinataire)"}</Text>
                    <Text style={styles.routeAddress}>{personalMission ? "À convenir avec ton client pendant la course" : activeDelivery.dropAddress}</Text>
                  </View>
                </View>
              </View>

              {personalMission && activeDelivery.bookedUntil ? (
                <Text style={styles.routeLabel}>
                  Réservé jusqu'au {new Date(activeDelivery.bookedUntil).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </Text>
              ) : null}

              {/* Où est le client : sa position est partagée pendant la mission, comme sur une course simple */}
              <ClientTrackMap
                deliveryId={activeDelivery.id}
                pickup={activeDelivery.pickupLat != null && activeDelivery.pickupLng != null ? { latitude: activeDelivery.pickupLat, longitude: activeDelivery.pickupLng } : null}
                me={myPos}
              />

              {activeDelivery.status === "IN_PROGRESS" ? (
                <TripDistanceBanner
                  title="Distance parcourue"
                  remaining={fmtTraveled(doneMeters / 1000)}
                  sub={activeDelivery.mode === "PERSONAL" ? "Prix final : base + kilomètres réellement parcourus" : "Compteur depuis le ramassage"}
                />
              ) : null}

              {activeDelivery.client ? (
                <View style={styles.clientRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.clientName}>
                      {maskPersonName(activeDelivery.client.fullName, "Client AZƆ̀")}
                    </Text>
                    <Text style={styles.clientPhone}>
                      {maskBeninPhone(activeDelivery.client.phone)} · Numéro protégé
                    </Text>
                  </View>
                  <Pressable
                    style={styles.callBtn}
                    onPress={() => setChatOpen(true)}
                  >
                    <MaterialIcons name="chat-bubble-outline" size={18} color="#fff" />
                    <Text style={styles.callBtnText}>Message</Text>
                  </Pressable>
                </View>
              ) : null}

              {/* Coursier personnel, avant l'arrivée : « Je suis arrivé » d'abord, le code de départ ensuite */}
              {personalMission && activeDelivery.status === "MATCHED" && !activeDelivery.courierArrivedAt ? (
                <View style={styles.otpBox}>
                  <Text style={styles.otpTitle}>Rejoins ton client</Text>
                  <Text style={styles.muted}>
                    Rejoins le point de rendez-vous, puis appuie sur « Je suis arrivé ». Ton client recevra une notification et te donnera son code de départ.
                  </Text>
                  <Pressable style={[styles.otpConfirmBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={handleArrive}>
                    {busy ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <MaterialIcons name="where-to-vote" size={18} color="#fff" />
                        <Text style={styles.otpConfirmText}>Je suis arrivé</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              ) : (
              /* Saisie du code OTP de ramassage ou de remise */
              <View style={styles.otpBox}>
                {simBannerCode ? (
                  <Pressable
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      backgroundColor: "#14291D",
                      borderRadius: radius.md,
                      padding: spacing.sm,
                    }}
                    onPress={() => setOtpInput(simBannerCode)}
                  >
                    <Text style={{ ...typography.labelMd, color: "#fff", fontFamily: FONT.bold }}>
                      💬 Code client (simulation) :{" "}
                      <Text style={{ color: "#52FF9B", fontFamily: FONT.extrabold, letterSpacing: 2 }}>
                        {simBannerCode}
                      </Text>
                    </Text>
                    <Text style={{ ...typography.labelSm, color: "#8CF0B4", fontFamily: FONT.extrabold }}>
                      {simBannerSec}s
                    </Text>
                  </Pressable>
                ) : currentSimCode ? (
                  <Pressable onPress={() => showSimCodeFor5Seconds(currentSimCode)}>
                    <Text style={{ ...typography.labelSm, color: colors.primary, fontFamily: FONT.bold }}>
                      Afficher le code client de simulation pendant 5s
                    </Text>
                  </Pressable>
                ) : null}
                <Text style={styles.otpTitle}>
                  {activeDelivery.status === "MATCHED"
                    ? personalMission ? "Code de départ (4 chiffres donnés par ton client)" : "Code de ramassage (4 chiffres de l'expéditeur)"
                    : personalMission ? "Code de fin de course (4 chiffres donnés par ton client)" : "Code de remise finale (4 chiffres du destinataire)"}
                </Text>
                <View style={styles.otpRow}>
                  <TextInput
                    style={styles.otpInput}
                    value={otpInput}
                    onChangeText={(v) => setOtpInput(v.replace(/\D/g, "").slice(0, 4))}
                    placeholder="••••"
                    placeholderTextColor={colors.outline}
                    keyboardType="number-pad"
                    maxLength={4}
                  />
                  <Pressable
                    style={[styles.otpConfirmBtn, busy && { opacity: 0.6 }]}
                    disabled={busy}
                    onPress={handleConfirmOtp}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <MaterialIcons name="verified" size={18} color="#fff" />
                        <Text style={styles.otpConfirmText}>
                          {activeDelivery.status === "MATCHED"
                            ? personalMission ? "Démarrer la course" : "Valider ramassage"
                            : personalMission ? "Terminer la course" : "Livrer & encaisser"}
                        </Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </View>
              )}

              {activeDelivery.status === "MATCHED" ? (
                <Pressable style={styles.cancelLink} onPress={handleCancelMission} disabled={busy}>
                  <Text style={styles.cancelLinkText}>{personalMission ? "Se désister de cette course" : "Se désister de cette mission"}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {/* Ma proposition attend la décision du client */}
          {offeredDelivery && !activeDelivery ? (
            <View style={styles.offerWaiting}>
              <View style={styles.offerWaitingTop}>
                <MaterialIcons name="hourglass-top" size={22} color={colors.primary} />
                <Text style={styles.offerWaitingTitle}>En attente du client</Text>
                <Text style={styles.offerWaitingSec}>
                  {Math.max(0, Math.ceil((Date.parse(offeredDelivery.offerExpiresAt ?? "") - offerNow) / 1000)) || 0} s
                </Text>
              </View>
              <Text style={styles.offerWaitingText} numberOfLines={2}>
                {offeredDelivery.offerSeenAt ? "Le client regarde ton profil…" : "Ta proposition est envoyée au client."}
              </Text>
              <Text style={styles.offerWaitingText} numberOfLines={1}>De : {offeredDelivery.pickupAddress}</Text>
              <Text style={styles.offerWaitingText} numberOfLines={1}>Vers : {offeredDelivery.dropAddress}</Text>
              <Pressable style={[styles.offerWithdraw, busy && { opacity: 0.55 }]} onPress={handleWithdraw} disabled={busy} accessibilityRole="button">
                <Text style={styles.offerWithdrawText}>Retirer ma proposition</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Missions disponibles */}
          <View style={styles.sectionHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>Missions à moins de 20 km ({pending.length})</Text>
              {activityLine ? <Text style={styles.activityLine}>{activityLine}</Text> : null}
            </View>
            <Pressable onPress={onRefresh}>
              <Text style={styles.refreshLink}>Actualiser</Text>
            </Pressable>
          </View>

          {online && myPos ? (
            <View style={{ height: 210, borderRadius: radius.lg, overflow: "hidden", marginBottom: spacing.sm }}>
              <OSMMapView
                center={myPos}
                zoom={13}
                markers={[
                  { id: "me", coordinate: myPos, title: "Moi", color: "blue" } as OSMMarker,
                  ...pending
                    .filter((m) => m.pickupLat != null && m.pickupLng != null)
                    .map((m): OSMMarker => ({ id: m.id, coordinate: { latitude: m.pickupLat as number, longitude: m.pickupLng as number }, title: "Mission", color: "orange" })),
                ]}
              />
            </View>
          ) : null}

          {!online ? (
            <View style={styles.emptyCard}>
              <MaterialIcons name="pause-circle-outline" size={34} color={colors.outline} />
              <Text style={styles.emptyTitle}>Tu es hors ligne</Text>
              <Text style={styles.muted}>
                Active l'interrupteur en haut à droite pour voir et accepter les missions
                autour de toi.
              </Text>
            </View>
          ) : pending.length === 0 ? (
            <View style={styles.emptyCard}>
              <MaterialIcons name="inventory-2" size={34} color={colors.outline} />
              <Text style={styles.emptyTitle}>Aucune mission en attente</Text>
              <Text style={styles.muted}>
                Les nouvelles missions de ton activité s'affichent ici
                automatiquement.
              </Text>
            </View>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {pending.map((item) => {
                const meta = PACKAGE_META[item.packageType] ?? PACKAGE_META.small;
                const net = item.price - (item.commission ?? Math.round(item.price * 0.15));
                return (
                  <View key={item.id} style={styles.missionCard}>
                    <View style={styles.missionTop}>
                      <View style={styles.missionIcon}>
                        <MaterialIcons name={meta.icon} size={20} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.missionType}>{meta.label}</Text>
                        <Text style={styles.missionPayer}>
                          {item.payer === "SENDER" ? "Payé via AZƆ̀ Pay" : "Réglé à la remise"}
                          {item.pickupDistanceKm != null ? ` · à ${item.pickupDistanceKm.toLocaleString("fr-FR")} km de toi` : ""}
                        </Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={styles.missionNet}>{fcfa(net)}</Text>
                        <Text style={styles.missionGross}>Tarif {fcfa(item.price)}</Text>
                      </View>
                    </View>

                    <View style={styles.missionAddresses}>
                      <Text style={styles.missionAddr} numberOfLines={1}>
                        <Text style={{ fontFamily: FONT.bold, color: colors.primary }}>De : </Text>
                        {item.pickupAddress}
                      </Text>
                      <Text style={styles.missionAddr} numberOfLines={1}>
                        <Text style={{ fontFamily: FONT.bold, color: colors.secondary }}>Vers : </Text>
                        {item.dropAddress}
                      </Text>
                    </View>

                    <Pressable
                      style={[styles.acceptBtn, (busy || !!activeDelivery || !!offeredDelivery) && { opacity: 0.55 }]}
                      disabled={busy || !!activeDelivery || !!offeredDelivery}
                      onPress={() => handleAccept(item.id)}
                    >
                      <MaterialIcons name="check-circle" size={18} color="#fff" />
                      <Text style={styles.acceptBtnText}>
                        {activeDelivery ? "Termine ta mission en cours" : offeredDelivery ? "Une proposition est en attente" : "Accepter la mission"}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          )}

          </>
          )}

          {tab === "gains" && (
          <>
          {/* Indicateurs du jour */}
          <View style={styles.kpiRow}>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Gains du jour</Text>
              <Text style={styles.kpiValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                {fcfa(stats.gainsToday)}
              </Text>
              <Text style={styles.kpiSub}>{stats.todayCount} livrée(s) aujourd'hui</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Solde AZƆ̀ Pay</Text>
              <Text style={styles.kpiValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                {balance != null ? fcfa(balance) : "—"}
              </Text>
              <Text style={styles.kpiSub}>{stats.totalCount} mission(s) au total</Text>
            </View>
          </View>
          <View style={styles.cbTiles}>
            <View style={styles.cbTile}>
              <MaterialIcons name="local-shipping" size={20} color={colors.primary} />
              <Text style={styles.cbTileValue}>{stats.todayCount}</Text>
              <Text style={styles.cbTileLabel}>Livraisons du jour</Text>
            </View>
            <View style={styles.cbTile}>
              <MaterialIcons name="check-circle" size={20} color={colors.primary} />
              <Text style={styles.cbTileValue}>{stats.totalCount}</Text>
              <Text style={styles.cbTileLabel}>Livraisons au total</Text>
            </View>
            <View style={styles.cbTile}>
              <MaterialIcons name="payments" size={20} color={colors.primary} />
              <Text style={styles.cbTileValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{fcfa(stats.gainsTotal)}</Text>
              <Text style={styles.cbTileLabel}>Gains cumulés</Text>
            </View>
          </View>
          </>
          )}

          {tab === "history" && (
          <>
          {/* Mission en cours : elle se suit ici comme dans l'onglet Missions */}
          {activeDelivery ? (
            <View style={styles.ongoingCard}>
              <View style={styles.ongoingTop}>
                <MaterialIcons name={activeDelivery.mode === "PERSONAL" ? "directions-run" : "local-shipping"} size={20} color={colors.onPrimary} />
                <Text style={styles.ongoingTitle}>{activeDelivery.mode === "PERSONAL" ? "Course personnelle en cours" : "Livraison en cours"}</Text>
                <Text style={styles.ongoingState}>{personalMission
                  ? activeDelivery.status === "MATCHED" ? (activeDelivery.courierArrivedAt ? "Arrivé chez le client" : "En route vers le client") : "Course démarrée"
                  : activeDelivery.status === "MATCHED" ? "En route vers le ramassage" : "En livraison"}</Text>
              </View>
              <Text style={styles.ongoingRoute} numberOfLines={1}>De : {activeDelivery.pickupAddress}</Text>
              <Text style={styles.ongoingRoute} numberOfLines={1}>Vers : {activeDelivery.dropAddress}</Text>
              {typeof activeDelivery.traveledMeters === "number" && activeDelivery.status === "IN_PROGRESS" ? (
                <Text style={styles.ongoingRoute}>{fmtTraveled(doneMeters / 1000)} parcourus</Text>
              ) : null}
              <Pressable style={styles.ongoingBtn} onPress={() => setTab("home")} accessibilityRole="button">
                <Text style={styles.ongoingBtnText}>Ouvrir la mission</Text>
                <MaterialIcons name="arrow-forward" size={16} color={colors.primary} />
              </Pressable>
            </View>
          ) : null}

          <Text style={[styles.sectionTitle, { marginBottom: spacing.sm }]}>Livraisons effectuées</Text>
          {history.filter((d) => d.status === "COMPLETED" || d.status === "CANCELLED").length === 0 ? (
            <Text style={styles.muted}>Tes livraisons terminées apparaîtront ici.</Text>
          ) : (
            <View style={{ gap: spacing.xs }}>
              {history
                .filter((d) => d.status === "COMPLETED" || d.status === "CANCELLED")
                .slice(0, 50)
                .map((d) => {
                  const net = d.price - (d.commission ?? Math.round(d.price * 0.15));
                  const cancelled = d.status === "CANCELLED";
                  return (
                    <View key={d.id} style={styles.historyRow}>
                      <MaterialIcons name={cancelled ? "cancel" : "check-circle"} size={18} color={cancelled ? colors.error : "#146C2E"} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.historyDest} numberOfLines={1}>{d.dropAddress}</Text>
                        <Text style={styles.historySub} numberOfLines={1}>Depuis {d.pickupAddress}</Text>
                        <Text style={styles.historySub}>{new Date(d.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}</Text>
                      </View>
                      <Text style={[styles.historyGain, cancelled && { color: colors.outline }]}>{cancelled ? "Annulée" : `+${fcfa(net)}`}</Text>
                    </View>
                  );
                })}
            </View>
          )}
          </>
          )}
          {tab === "profile" && (
            <View style={{ gap: spacing.md }}>
              <View style={styles.pfIdentity}>
                <Pressable onPress={() => setAvatarOpen(true)} accessibilityRole="button" accessibilityLabel="Changer la photo">
                  <LinearGradient colors={[colors.primary, colors.secondaryContainer]} style={styles.pfRing}>
                    <View style={styles.pfAvatar}>
                      <Avatar uri={avatarUri} initials={initials(user)} size={70} />
                    </View>
                  </LinearGradient>
                  <View style={styles.pfBadge}>
                    <MaterialIcons name="photo-camera" size={14} color={colors.onPrimary} />
                  </View>
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pfName} numberOfLines={2}>{displayName(user) || "Coursier AZƆ̀"}</Text>
                  <Text style={styles.pfPhone}>{user ? formatBeninPhoneDisplay(user.phone) : ""}</Text>
                </View>
              </View>
              <View style={styles.pfStats}>
                <View style={styles.pfStat}>
                  <Text style={styles.pfStatValue}>{stats.totalCount}</Text>
                  <Text style={styles.pfStatLabel}>Livraisons terminées</Text>
                </View>
                <View style={styles.pfStat}>
                  <Text style={styles.pfStatValue} numberOfLines={1} adjustsFontSizeToFit>{balance !== null ? fcfa(balance) : "—"}</Text>
                  <Text style={styles.pfStatLabel}>Solde AZƆ̀ Pay</Text>
                </View>
              </View>
              <View style={styles.pfMenu}>
                {onOpenInfo ? (
                  <Pressable style={[styles.pfRow, styles.pfDivider]} onPress={onOpenInfo} accessibilityRole="button">
                    <View style={styles.pfIcon}><MaterialIcons name="badge" size={20} color={colors.primary} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pfLabel}>Modifier mes informations</Text>
                      <Text style={styles.pfHint}>Nom, e-mail, contact d'urgence, numéro</Text>
                    </View>
                    <MaterialIcons name="chevron-right" size={20} color={colors.outline} />
                  </Pressable>
                ) : null}
                <Pressable style={[styles.pfRow, styles.pfDivider]} onPress={() => setAvatarOpen(true)} accessibilityRole="button">
                  <View style={styles.pfIcon}><MaterialIcons name="photo-camera" size={20} color={colors.primary} /></View>
                  <Text style={styles.pfLabel}>Photo de profil</Text>
                  <MaterialIcons name="chevron-right" size={20} color={colors.outline} />
                </Pressable>
                {onOpenDossier ? (
                  <Pressable style={[styles.pfRow, styles.pfDivider]} onPress={onOpenDossier} accessibilityRole="button">
                    <View style={styles.pfIcon}><MaterialIcons name="verified-user" size={20} color={colors.primary} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pfLabel}>Mon dossier</Text>
                      <Text style={styles.pfHint}>Pièces, véhicule, statut de validation</Text>
                    </View>
                    <MaterialIcons name="chevron-right" size={20} color={colors.outline} />
                  </Pressable>
                ) : null}
                <Pressable style={[styles.pfRow, styles.pfDivider]} onPress={() => setLangOpen(true)} accessibilityRole="button">
                  <View style={styles.pfIcon}><MaterialIcons name="translate" size={20} color={colors.primary} /></View>
                  <Text style={styles.pfLabel}>Langue</Text>
                  <Text style={styles.pfMeta} numberOfLines={1}>{languageInfo(lang).flag} {languageInfo(lang).native}</Text>
                  <MaterialIcons name="chevron-right" size={20} color={colors.outline} />
                </Pressable>
                {onOpenSupport ? (
                  <Pressable style={styles.pfRow} onPress={onOpenSupport} accessibilityRole="button">
                    <View style={styles.pfIcon}><MaterialIcons name="support-agent" size={20} color={colors.primary} /></View>
                    <Text style={styles.pfLabel}>Assistance</Text>
                    <MaterialIcons name="chevron-right" size={20} color={colors.outline} />
                  </Pressable>
                ) : null}
              </View>
              <Pressable style={styles.pfLogout} onPress={confirmExit} accessibilityRole="button">
                <MaterialIcons name="logout" size={20} color={colors.error} />
                <Text style={styles.pfLogoutText}>Se déconnecter</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      )}

      <LanguageSheet visible={langOpen} onClose={() => setLangOpen(false)} />
      <AvatarSheet visible={avatarOpen} onClose={() => setAvatarOpen(false)} />

      <PillTabBar
        items={COURIER_TABS}
        active={tab}
        onNavigate={(next) => {
          if (next === "wallet") onOpenWallet?.();
          else setTab(next);
        }}
      />

      {activeDelivery ? (
        <RideChatModal
          visible={chatOpen}
          rideId={activeDelivery.id}
          myRole="PROVIDER"
          peerName={activeDelivery.client?.fullName}
          peerPhone={activeDelivery.client?.phone}
          onClose={() => setChatOpen(false)}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  cbBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
    backgroundColor: `${colors.primaryFixed}99`,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  cbTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  cbStatus: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  cbDot: { width: 8, height: 8, borderRadius: 4 },
  cbStatusText: { ...typography.labelSm, color: colors.onSurfaceVariant },
  cbBell: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceContainerLowest, alignItems: "center", justifyContent: "center" },
  cbTiles: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  cbTile: { flex: 1, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.sm + 2, gap: 4, borderWidth: 1, borderColor: colors.surfaceContainer },
  cbTileValue: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  cbTileLabel: { ...typography.labelSm, color: colors.onSurfaceVariant },
  pfIdentity: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, padding: spacing.md, borderWidth: 1, borderColor: colors.surfaceContainer },
  pfRing: { width: 84, height: 84, borderRadius: 42, alignItems: "center", justifyContent: "center" },
  pfAvatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.surfaceContainerLowest, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  pfBadge: { position: "absolute", right: -2, bottom: -2, width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.surfaceContainerLowest },
  pfName: { ...typography.headlineSm, color: colors.onSurface },
  pfPhone: { ...typography.bodyMd, color: colors.onSurfaceVariant, marginTop: 2 },
  pfStats: { flexDirection: "row", gap: spacing.sm },
  pfStat: { flex: 1, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, padding: spacing.md, borderWidth: 1, borderColor: colors.surfaceContainer },
  pfStatValue: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  pfStatLabel: { ...typography.labelSm, color: colors.onSurfaceVariant, marginTop: 2 },
  pfMenu: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.surfaceContainer, overflow: "hidden" },
  pfRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 2, paddingHorizontal: spacing.md, minHeight: 60 },
  pfDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.surfaceContainer },
  pfIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center" },
  pfLabel: { ...typography.bodyLg, color: colors.onSurface, flex: 1 },
  pfHint: { ...typography.bodySm, color: colors.onSurfaceVariant },
  pfMeta: { ...typography.labelMd, color: colors.onSurfaceVariant, maxWidth: 130 },
  pfLogout: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 52, borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.error },
  pfLogoutText: { ...typography.labelLg, color: colors.error, fontWeight: "700" },
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: spacing.lg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  headerTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  headerSub: { ...typography.labelSm, color: colors.onSurfaceVariant },
  dossierPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.primaryFixed,
    paddingHorizontal: 10,
    height: 32,
    borderRadius: radius.full,
  },
  dossierPillText: { ...typography.labelSm, color: colors.primary, fontWeight: "800" },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceContainer,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: { padding: spacing.md, paddingBottom: 100 },
  muted: { ...typography.bodySm, color: colors.onSurfaceVariant, textAlign: "center", lineHeight: 20 },

  kpiRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  kpiCard: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
  },
  kpiLabel: { ...typography.labelSm, color: colors.onSurfaceVariant },
  kpiValue: { ...typography.headlineMd, color: colors.primary, fontWeight: "800", marginTop: 2 },
  kpiSub: { ...typography.labelSm, color: colors.onSurfaceVariant, marginTop: 2 },

  activeCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 2,
    borderColor: colors.primary,
    gap: spacing.sm,
  },
  activeHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  activeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.full,
  },
  activeBadgeText: { fontSize: 11, color: "#fff", fontWeight: "800" },
  activePrice: { ...typography.labelLg, color: colors.primary, fontWeight: "800" },
  packageTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },

  routeBox: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.lg,
    padding: spacing.sm + 2,
    gap: 8,
  },
  routeStep: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  routeLabel: { ...typography.labelSm, color: colors.onSurfaceVariant },
  routeAddress: { ...typography.bodyMd, color: colors.onSurface, fontWeight: "700" },
  routeDivider: { height: 1, backgroundColor: colors.surfaceContainerHigh, marginLeft: 24 },

  clientRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  clientName: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  clientPhone: { ...typography.labelSm, color: colors.onSurfaceVariant },
  callBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    height: 36,
    borderRadius: radius.full,
  },
  callBtnText: { ...typography.labelSm, color: "#fff", fontWeight: "800" },

  otpBox: {
    backgroundColor: colors.primaryFixed,
    borderRadius: radius.lg,
    padding: spacing.sm + 2,
    gap: 8,
  },
  otpTitle: { ...typography.labelSm, color: colors.onPrimaryFixed, fontWeight: "800" },
  otpRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  otpInput: {
    width: 100,
    height: 44,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.md,
    textAlign: "center",
    ...typography.headlineSm,
    color: colors.onSurface,
    fontWeight: "800",
    letterSpacing: 4,
  },
  otpConfirmBtn: {
    flex: 1,
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingHorizontal: 14,
  },
  otpConfirmText: { ...typography.labelMd, color: "#fff", fontWeight: "800" },
  cancelLink: { alignSelf: "center", paddingVertical: 4 },
  cancelLinkText: { ...typography.labelSm, color: colors.error, fontWeight: "700" },

  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  profileRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.md, padding: spacing.md },
  profileRowTitle: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
  profileRowSub: { ...typography.bodySm, color: colors.onSurfaceVariant },
  sectionTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  activityLine: { ...typography.bodySm, color: colors.onSurfaceVariant, marginTop: 2 },
  offerWaiting: { backgroundColor: colors.primaryFixed, borderRadius: radius.xl, padding: spacing.md, gap: 4, marginBottom: spacing.md },
  offerWaitingTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  offerWaitingTitle: { ...typography.headlineSm, color: colors.onSurface, flex: 1 },
  offerWaitingSec: { ...typography.labelLg, color: colors.primary, fontWeight: "800" },
  offerWaitingText: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  offerWithdraw: { marginTop: spacing.xs, alignSelf: "flex-start", paddingVertical: 6 },
  offerWithdrawText: { ...typography.labelLg, color: colors.error, fontWeight: "700" },
  refreshLink: { ...typography.labelMd, color: colors.primary, fontWeight: "700" },

  emptyCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    padding: spacing.lg,
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
  },
  emptyTitle: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },

  missionCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
  },
  missionTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  missionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryFixed,
    alignItems: "center",
    justifyContent: "center",
  },
  missionType: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
  missionPayer: { ...typography.labelSm, color: colors.onSurfaceVariant },
  missionNet: { ...typography.headlineSm, color: colors.primary, fontWeight: "800" },
  missionGross: { ...typography.labelSm, color: colors.onSurfaceVariant },
  missionAddresses: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: 4,
  },
  missionAddr: { ...typography.bodySm, color: colors.onSurface },
  acceptBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 44,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
  },
  acceptBtnText: { ...typography.labelMd, color: "#fff", fontWeight: "800" },

  ongoingCard: { backgroundColor: colors.primary, borderRadius: radius.xl, padding: spacing.md, gap: 6, marginBottom: spacing.md },
  ongoingTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  ongoingTitle: { ...typography.labelLg, color: colors.onPrimary, fontWeight: "800", flex: 1 },
  ongoingState: { ...typography.labelSm, color: colors.onPrimary, fontWeight: "700", backgroundColor: "rgba(255,255,255,0.2)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full },
  ongoingRoute: { ...typography.bodySm, color: "rgba(255,255,255,0.92)" },
  ongoingBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#fff", borderRadius: radius.full, paddingVertical: 10, marginTop: 4 },
  ongoingBtnText: { ...typography.labelMd, color: colors.primary, fontWeight: "800" },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
  },
  historyDest: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  historySub: { ...typography.labelSm, color: colors.onSurfaceVariant },
  historyGain: { ...typography.labelLg, color: "#146C2E", fontWeight: "800" },
});
