import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { Delivery, deliveryApi, errorMessage, walletApi } from "../services/api";
import { formatBeninPhoneDisplay, maskBeninPhone, maskPersonName } from "../utils/phone";
import RideChatModal from "../components/RideChatModal";

type Props = {
  onLogout: () => void;
  onOpenDossier?: () => void;
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

export default function CourierHomeScreen({ onLogout, onOpenDossier }: Props) {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState<Delivery[]>([]);
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

  const currentSimCode = useMemo(() => {
    if (!activeDelivery) return null;
    const raw =
      activeDelivery.status === "MATCHED"
        ? activeDelivery.pickupCode
        : activeDelivery.deliveryCode;
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
    const [wRes, hRes, pRes] = await Promise.allSettled([
      walletApi.get(),
      deliveryApi.courierHistory(),
      deliveryApi.pending(),
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
    const timer = setInterval(() => {
      loadAccount().catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
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
    return { gainsToday, todayCount: today.length, totalCount: done.length };
  }, [history]);

  async function handleAccept(id: string) {
    setBusy(true);
    try {
      await deliveryApi.accept(id);
      setOtpInput("");
      await loadAccount();
    } catch (e) {
      Alert.alert("Mission indisponible", errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmOtp() {
    if (!activeDelivery) return;
    const clean = otpInput.replace(/\D/g, "");
    if (clean.length !== 4) {
      Alert.alert("Code à 4 chiffres", "Saisis le code à 4 chiffres fourni par le client ou le destinataire.");
      return;
    }
    setBusy(true);
    try {
      if (activeDelivery.status === "MATCHED") {
        await deliveryApi.confirmPickup(activeDelivery.id, clean);
        setOtpInput("");
        await loadAccount();
        Alert.alert(
          "Ramassage validé ✅",
          "Colis pris en charge ! Dirige-toi vers l'adresse de livraison et demande le code de remise à 4 chiffres au destinataire."
        );
      } else {
        await deliveryApi.confirmDelivery(activeDelivery.id, clean);
        setOtpInput("");
        await loadAccount();
        const net = activeDelivery.price - (activeDelivery.commission ?? Math.round(activeDelivery.price * 0.15));
        Alert.alert(
          "Livraison terminée 🎉",
          `Code de remise validé. Ton gain net de ${fcfa(net)} a été crédité sur ton portefeuille AZƆ̀ Pay.`
        );
      }
    } catch (e) {
      Alert.alert("Code invalide", errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function handleCancelMission() {
    if (!activeDelivery) return;
    Alert.alert(
      "Annuler cette mission",
      "Veux-tu vraiment te désister ? La mission sera reproposée aux autres coursiers.",
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
              Alert.alert("Impossible d'annuler", errorMessage(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }

  function confirmExit() {
    Alert.alert("Espace Coursier & Livreur", "Que souhaites-tu faire ?", [
      { text: "Annuler", style: "cancel" },
      ...(onOpenDossier ? [{ text: "Mon dossier KYC", onPress: onOpenDossier }] : []),
      { text: "Se déconnecter", style: "destructive", onPress: onLogout },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Coursier & Livreur AZƆ̀</Text>
          <Text style={styles.headerSub}>
            {online ? "En ligne · réception des missions" : "Hors ligne · aucune nouvelle mission"}
          </Text>
        </View>
        {onOpenDossier ? (
          <Pressable style={styles.dossierPill} onPress={onOpenDossier}>
            <MaterialIcons name="verified-user" size={15} color={colors.primary} />
            <Text style={styles.dossierPillText}>Dossier</Text>
          </Pressable>
        ) : null}
        <Switch
          value={online}
          onValueChange={setOnline}
          trackColor={{ false: colors.surfaceContainerHigh, true: colors.primaryFixed }}
          thumbColor={online ? colors.primary : colors.outline}
        />
        <Pressable style={styles.iconBtn} onPress={confirmExit} accessibilityLabel="Menu ou déconnexion">
          <MaterialIcons name="logout" size={18} color={colors.onSurface} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.muted}>Chargement de tes missions…</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
          keyboardShouldPersistTaps="handled"
        >
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

          {/* Mission en cours (double OTP) */}
          {activeDelivery ? (
            <View style={styles.activeCard}>
              <View style={styles.activeHeader}>
                <View style={styles.activeBadge}>
                  <MaterialIcons name="local-shipping" size={16} color="#fff" />
                  <Text style={styles.activeBadgeText}>
                    {activeDelivery.status === "MATCHED"
                      ? "ÉTAPE 1/2 · ALLER AU RAMASSAGE"
                      : "ÉTAPE 2/2 · EN LIVRAISON"}
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
                {PACKAGE_META[activeDelivery.packageType]?.label ?? "Mission de livraison"}
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
                  <Text style={{ ...typography.labelSm, color: "#fff", fontWeight: "800", fontSize: 10 }}>
                    1. Ramassage
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
                    2. En route
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
                  <Text style={{ ...typography.labelSm, color: colors.onSurfaceVariant, fontWeight: "700", fontSize: 10 }}>
                    3. Encaissement
                  </Text>
                </View>
              </View>

              <View style={styles.routeBox}>
                <View style={styles.routeStep}>
                  <MaterialIcons name="trip-origin" size={16} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.routeLabel}>Ramassage (Expéditeur)</Text>
                    <Text style={styles.routeAddress}>{activeDelivery.pickupAddress}</Text>
                  </View>
                </View>
                <View style={styles.routeDivider} />
                <View style={styles.routeStep}>
                  <MaterialIcons name="place" size={16} color={colors.secondary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.routeLabel}>Remise (Destinataire)</Text>
                    <Text style={styles.routeAddress}>{activeDelivery.dropAddress}</Text>
                  </View>
                </View>
              </View>

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

              {/* Saisie du code OTP de ramassage ou de remise */}
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
                    <Text style={{ ...typography.labelMd, color: "#fff", fontWeight: "700" }}>
                      💬 Code client (simulation) :{" "}
                      <Text style={{ color: "#52FF9B", fontWeight: "800", letterSpacing: 2 }}>
                        {simBannerCode}
                      </Text>
                    </Text>
                    <Text style={{ ...typography.labelSm, color: "#8CF0B4", fontWeight: "800" }}>
                      {simBannerSec}s
                    </Text>
                  </Pressable>
                ) : currentSimCode ? (
                  <Pressable onPress={() => showSimCodeFor5Seconds(currentSimCode)}>
                    <Text style={{ ...typography.labelSm, color: colors.primary, fontWeight: "700" }}>
                      Afficher le code client de simulation pendant 5s
                    </Text>
                  </Pressable>
                ) : null}
                <Text style={styles.otpTitle}>
                  {activeDelivery.status === "MATCHED"
                    ? "Code de ramassage (4 chiffres de l'expéditeur)"
                    : "Code de remise finale (4 chiffres du destinataire)"}
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
                            ? "Valider ramassage"
                            : "Livrer & encaisser"}
                        </Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </View>

              {activeDelivery.status === "MATCHED" ? (
                <Pressable style={styles.cancelLink} onPress={handleCancelMission} disabled={busy}>
                  <Text style={styles.cancelLinkText}>Se désister de cette mission</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {/* Missions disponibles */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Missions disponibles ({pending.length})</Text>
            <Pressable onPress={onRefresh}>
              <Text style={styles.refreshLink}>Actualiser</Text>
            </Pressable>
          </View>

          {!online ? (
            <View style={styles.emptyCard}>
              <MaterialIcons name="pause-circle-outline" size={34} color={colors.outline} />
              <Text style={styles.emptyTitle}>Tu es hors ligne</Text>
              <Text style={styles.muted}>
                Active l'interrupteur en haut à droite pour voir et accepter les missions de livraison et
                de coursier personnel autour de toi.
              </Text>
            </View>
          ) : pending.length === 0 ? (
            <View style={styles.emptyCard}>
              <MaterialIcons name="inventory-2" size={34} color={colors.outline} />
              <Text style={styles.emptyTitle}>Aucune mission en attente</Text>
              <Text style={styles.muted}>
                Les nouvelles demandes de livraison de colis et de coursier personnel s'affichent ici
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
                        </Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={styles.missionNet}>{fcfa(net)}</Text>
                        <Text style={styles.missionGross}>Tarif {fcfa(item.price)}</Text>
                      </View>
                    </View>

                    <View style={styles.missionAddresses}>
                      <Text style={styles.missionAddr} numberOfLines={1}>
                        <Text style={{ fontWeight: "700", color: colors.primary }}>De : </Text>
                        {item.pickupAddress}
                      </Text>
                      <Text style={styles.missionAddr} numberOfLines={1}>
                        <Text style={{ fontWeight: "700", color: colors.secondary }}>Vers : </Text>
                        {item.dropAddress}
                      </Text>
                    </View>

                    <Pressable
                      style={[styles.acceptBtn, (busy || !!activeDelivery) && { opacity: 0.55 }]}
                      disabled={busy || !!activeDelivery}
                      onPress={() => handleAccept(item.id)}
                    >
                      <MaterialIcons name="check-circle" size={18} color="#fff" />
                      <Text style={styles.acceptBtnText}>
                        {activeDelivery ? "Termine ta mission en cours" : "Accepter la mission"}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          )}

          {/* Historique récent */}
          {history.filter((d) => d.status === "COMPLETED").length > 0 ? (
            <>
              <Text style={[styles.sectionTitle, { marginTop: spacing.lg, marginBottom: spacing.sm }]}>
                Dernières livraisons effectuées
              </Text>
              <View style={{ gap: spacing.xs }}>
                {history
                  .filter((d) => d.status === "COMPLETED")
                  .slice(0, 5)
                  .map((d) => {
                    const net = d.price - (d.commission ?? Math.round(d.price * 0.15));
                    return (
                      <View key={d.id} style={styles.historyRow}>
                        <MaterialIcons name="check-circle" size={18} color="#146C2E" />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.historyDest} numberOfLines={1}>
                            {d.dropAddress}
                          </Text>
                          <Text style={styles.historySub} numberOfLines={1}>
                            Depuis {d.pickupAddress}
                          </Text>
                        </View>
                        <Text style={styles.historyGain}>+{fcfa(net)}</Text>
                      </View>
                    );
                  })}
              </View>
            </>
          ) : null}
        </ScrollView>
      )}

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
  sectionTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
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
