import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import Svg, { Rect } from "react-native-svg";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import {
  AgencyDashboardData,
  AgencyRosterMember,
  agenciesApi,
  errorMessage,
} from "../services/api";
import {
  cleanBeninDigits,
  formatBeninPhoneDisplay,
  formatBeninPhoneInput,
  isValidBeninPhone,
} from "../utils/phone";

type Props = {
  onBack: () => void;
  onOpenDossier?: () => void;
};

type RosterFilter = "ALL" | "EN_COURSE" | "DISPONIBLE";

const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} F`;

const OFFICIAL_AGENCY_GRID = [
  { plan: "PRO", name: "AGENCE PRO", fee: 100000, maxAccounts: 10, commission: "3 %" },
  { plan: "ARGENT", name: "AGENCE ARGENT", fee: 215500, maxAccounts: 25, commission: "2,5 %" },
  { plan: "OR", name: "AGENCE OR", fee: 450500, maxAccounts: 100, commission: "2 %" },
  { plan: "DIAMANT", name: "AGENCE DIAMANT", fee: 600500, maxAccounts: 1000, commission: "1 %" },
] as const;

export default function AgencyDashboardScreen({ onBack, onOpenDossier }: Props) {
  const [data, setData] = useState<AgencyDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rosterFilter, setRosterFilter] = useState<RosterFilter>("ALL");

  // Modale d'ajout d'un conducteur / coursier par numéro à 10 chiffres
  const [addVisible, setAddVisible] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [detachingId, setDetachingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await agenciesApi.dashboard();
      setData(res);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    load().finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const digits = cleanBeninDigits(phoneInput);
  const phoneValid = isValidBeninPhone(digits);

  async function handleAttachDriver() {
    if (!phoneValid) {
      Alert.alert(
        "Numéro à 10 chiffres requis",
        "Entre le numéro béninois à 10 chiffres commençant par 01 (ex. 01 XX XX XX XX) d'un conducteur ou coursier au dossier validé."
      );
      return;
    }
    setAdding(true);
    try {
      const res = await agenciesApi.attachDriver(digits);
      setAddVisible(false);
      setPhoneInput("");
      await load();
      Alert.alert(
        "Membre rattaché ✅",
        `${res.driver.fullName || formatBeninPhoneDisplay(res.driver.phone)} fait maintenant partie de ta flotte.`
      );
    } catch (e) {
      Alert.alert("Rattachement impossible", errorMessage(e));
    } finally {
      setAdding(false);
    }
  }

  function confirmDetach(member: AgencyRosterMember) {
    const label = member.fullName || formatBeninPhoneDisplay(member.phone);
    Alert.alert(
      "Retirer de la flotte",
      `Veux-tu retirer ${label} de ton agence ? Il redeviendra conducteur indépendant.`,
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Retirer",
          style: "destructive",
          onPress: async () => {
            setDetachingId(member.id);
            try {
              await agenciesApi.detachDriver(member.id);
              await load();
            } catch (e) {
              Alert.alert("Erreur", errorMessage(e));
            } finally {
              setDetachingId(null);
            }
          },
        },
      ]
    );
  }

  function confirmLogout() {
    Alert.alert("Quitter l'espace agence", "Que souhaites-tu faire ?", [
      { text: "Annuler", style: "cancel" },
      ...(onOpenDossier ? [{ text: "Mon dossier KYC", onPress: onOpenDossier }] : []),
      { text: "Se déconnecter", style: "destructive", onPress: onBack },
    ]);
  }

  const filteredRoster = useMemo(() => {
    const list = data?.roster ?? [];
    if (rosterFilter === "ALL") return list;
    return list.filter((m) => m.state === rosterFilter);
  }, [data, rosterFilter]);

  const capacityRatio = useMemo(() => {
    if (!data || !data.seatsTotal) return 0;
    return Math.min(1, data.seatsUsed / data.seatsTotal);
  }, [data]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={confirmLogout} style={styles.iconButton} accessibilityLabel="Menu ou déconnexion">
          <MaterialIcons name="arrow-back-ios-new" size={18} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Mon agence
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {data ? `Formule ${data.agency.planLabel} · commission ${(data.agency.commissionRate * 100).toLocaleString("fr-FR")}%` : "Gestion de flotte AZƆ̀"}
          </Text>
        </View>
        {onOpenDossier ? (
          <Pressable style={styles.kycBtn} onPress={onOpenDossier}>
            <MaterialIcons name="verified-user" size={15} color={colors.primary} />
            <Text style={styles.kycBtnText}>Dossier</Text>
          </Pressable>
        ) : (
          <View style={styles.b2bBadge}>
            <Text style={styles.b2bText}>PRO FLOTTE</Text>
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.muted}>Chargement de ta flotte…</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        >
          {error ? (
            <View style={styles.errorCard}>
              <MaterialIcons name="error-outline" size={20} color={colors.error} />
              <View style={{ flex: 1 }}>
                <Text style={styles.errorTitle}>Impossible de charger l'agence</Text>
                <Text style={styles.errorText}>{error}</Text>
              </View>
              {onOpenDossier ? (
                <Pressable style={styles.smallPrimaryBtn} onPress={onOpenDossier}>
                  <Text style={styles.smallPrimaryBtnText}>Mon dossier</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {data ? (
            <>
              {/* Identité de l'agence */}
              <View style={styles.agencyCard}>
                <View style={styles.agencyTop}>
                  <View style={styles.agencyIcon}>
                    <MaterialIcons name="apartment" size={24} color={colors.onPrimary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.agencyName} numberOfLines={1}>
                      {data.agency.name}
                    </Text>
                    <Text style={styles.agencyMeta}>
                      Formule {data.agency.planLabel} • Commission{" "}
                      {(data.agency.commissionRate * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })}%
                    </Text>
                  </View>
                  <View style={styles.planPill}>
                    <Text style={styles.planPillText}>{data.agency.planLabel}</Text>
                  </View>
                </View>

                <View style={styles.capacitySection}>
                  <View style={styles.capacityHeader}>
                    <Text style={styles.capacityLabel}>Capacité de la flotte</Text>
                    <Text style={styles.capacityValue}>
                      {data.seatsUsed} / {data.seatsTotal} comptes ({Math.round(capacityRatio * 100)}%)
                    </Text>
                  </View>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${Math.round(capacityRatio * 100)}%` }]} />
                  </View>
                </View>
              </View>

              {/* 4 indicateurs réels */}
              <View style={styles.statsGrid}>
                <View style={styles.statCard}>
                  <MaterialIcons name="account-balance-wallet" size={20} color={colors.primary} />
                  <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                    {fcfa(data.netRevenue)}
                  </Text>
                  <Text style={styles.statLabel}>CA Net Flotte</Text>
                  <Text style={styles.statDelta}>Brut : {fcfa(data.grossRevenue)}</Text>
                </View>

                <View style={styles.statCard}>
                  <MaterialIcons name="two-wheeler" size={20} color={colors.primary} />
                  <Text style={styles.statValue} numberOfLines={1}>
                    {data.drivers} / {data.seatsTotal}
                  </Text>
                  <Text style={styles.statLabel}>Membres actifs</Text>
                  <Text style={styles.statDelta}>{data.activeRides} en course actuellement</Text>
                </View>

                <View style={styles.statCard}>
                  <MaterialIcons name="verified" size={20} color={colors.primary} />
                  <Text style={styles.statValue} numberOfLines={1}>
                    {data.completedRides}
                  </Text>
                  <Text style={styles.statLabel}>Courses terminées</Text>
                  <Text style={styles.statDelta}>Commissions : {fcfa(data.commissionsPaid)}</Text>
                </View>

                <View style={styles.statCard}>
                  <MaterialIcons name="star" size={20} color={colors.primary} />
                  <Text style={styles.statValue} numberOfLines={1}>
                    {data.averageRating != null ? data.averageRating.toFixed(2) : "—"}
                  </Text>
                  <Text style={styles.statLabel}>Note moyenne</Text>
                  <Text style={styles.statDelta}>
                    {data.averageRating != null ? "Qualité flotte" : "Aucune note"}
                  </Text>
                </View>
              </View>

              {/* En-tête Équipe + bouton d'ajout */}
              <View style={styles.sectionHeaderRow}>
                <View>
                  <Text style={styles.sectionTitle}>Flotte ({data.roster.length})</Text>
                  <Text style={styles.sectionSub}>Zem, conducteurs & coursiers rattachés</Text>
                </View>
                <Pressable style={styles.addBtn} onPress={() => setAddVisible(true)}>
                  <MaterialIcons name="person-add-alt-1" size={17} color="#fff" />
                  <Text style={styles.addBtnText}>Ajouter</Text>
                </Pressable>
              </View>

              {/* Filtres de l'équipe */}
              <View style={styles.filterRow}>
                {(
                  [
                    ["ALL", `Tous (${data.roster.length})`],
                    ["EN_COURSE", `En mission (${data.roster.filter((m) => m.state === "EN_COURSE").length})`],
                    ["DISPONIBLE", `Disponibles (${data.roster.filter((m) => m.state === "DISPONIBLE").length})`],
                  ] as const
                ).map(([id, label]) => {
                  const active = rosterFilter === id;
                  return (
                    <Pressable
                      key={id}
                      style={[styles.filterChip, active && styles.filterChipActive]}
                      onPress={() => setRosterFilter(id)}
                    >
                      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {filteredRoster.length === 0 ? (
                <View style={styles.emptyCard}>
                  <MaterialIcons name="groups" size={34} color={colors.outline} />
                  <Text style={styles.emptyTitle}>Aucun membre dans cette vue</Text>
                  <Text style={styles.muted}>
                    Ajoute un conducteur ou un coursier dont le dossier prestataire a été validé par AZƆ̀
                    à l'aide de son numéro à 10 chiffres (01…).
                  </Text>
                </View>
              ) : (
                <View style={{ gap: spacing.sm }}>
                  {filteredRoster.map((d) => {
                    const displayName = d.fullName || formatBeninPhoneDisplay(d.phone);
                    const initial = displayName.trim().charAt(0).toUpperCase() || "C";
                    const busyCourse = d.state === "EN_COURSE";
                    return (
                      <View key={d.id} style={styles.driverRow}>
                        <View style={styles.driverAvatar}>
                          <Text style={styles.driverInitial}>{initial}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.driverName} numberOfLines={1}>
                            {displayName}
                          </Text>
                          <Text style={styles.driverMeta} numberOfLines={1}>
                            {formatBeninPhoneDisplay(d.phone)} · {d.jobsCompleted} course(s)
                            {d.rating > 0 ? ` · ★ ${d.rating.toFixed(1)}` : ""}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.statusPill,
                            { backgroundColor: busyCourse ? colors.primaryFixed : colors.surfaceContainer },
                          ]}
                        >
                          <Text
                            style={[
                              styles.statusPillText,
                              { color: busyCourse ? colors.primary : colors.onSurfaceVariant },
                            ]}
                          >
                            {busyCourse ? "En mission" : "Disponible"}
                          </Text>
                        </View>
                        <Pressable
                          style={styles.smallIconBtn}
                          onPress={() => Linking.openURL(`tel:${d.phone}`)}
                          accessibilityLabel="Appeler"
                        >
                          <MaterialIcons name="phone" size={18} color={colors.primary} />
                        </Pressable>
                        <Pressable
                          style={[styles.smallIconBtn, { backgroundColor: colors.errorContainer }]}
                          disabled={detachingId === d.id}
                          onPress={() => confirmDetach(d)}
                          accessibilityLabel="Retirer de la flotte"
                        >
                          {detachingId === d.id ? (
                            <ActivityIndicator size="small" color={colors.error} />
                          ) : (
                            <MaterialIcons name="person-remove" size={17} color={colors.error} />
                          )}
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Grille officielle AZƆ̀ */}
              <Text style={[styles.sectionTitle, { marginTop: spacing.lg, marginBottom: spacing.sm }]}>
                Grille officielle AZƆ̀
              </Text>
              <View style={{ gap: spacing.sm }}>
                {OFFICIAL_AGENCY_GRID.map((tier) => {
                  const isCurrent = data.agency.plan === tier.plan;
                  return (
                    <View
                      key={tier.plan}
                      style={[
                        styles.driverRow,
                        isCurrent && {
                          borderColor: colors.primary,
                          borderWidth: 1.5,
                          backgroundColor: `${colors.primaryFixed}35`,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.driverAvatar,
                          {
                            backgroundColor: isCurrent
                              ? colors.primary
                              : colors.surfaceContainerLow,
                          },
                        ]}
                      >
                        <MaterialIcons
                          name="workspace-premium"
                          size={20}
                          color={isCurrent ? "#fff" : colors.primary}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.driverName}>{tier.name}</Text>
                        <Text style={styles.driverMeta}>
                          Activation unique : {tier.fee.toLocaleString("fr-FR")} FCFA · Jusqu'à{" "}
                          {tier.maxAccounts.toLocaleString("fr-FR")} comptes
                        </Text>
                      </View>
                      <View style={styles.planPill}>
                        <Text style={styles.planPillText}>Comm. {tier.commission}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </>
          ) : null}
        </ScrollView>
      )}

      {/* Modale d'ajout d'un conducteur / coursier par numéro à 10 chiffres */}
      <Modal visible={addVisible} transparent animationType="fade" onRequestClose={() => setAddVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Rattacher un membre à la flotte</Text>
            <Text style={styles.modalSub}>
              Saisis le numéro béninois à 10 chiffres (01…) d'un conducteur Zem, voiture ou coursier dont
              le dossier a été approuvé par AZƆ̀.
            </Text>

            <View style={[styles.phoneRow, phoneValid && styles.phoneRowValid]}>
              <View style={styles.flagBadge}>
                <Svg width={18} height={12} viewBox="0 0 450 300">
                  <Rect fill="#008751" width="180" height="300" />
                  <Rect fill="#FCD116" x="180" width="270" height="150" />
                  <Rect fill="#E8112D" x="180" y="150" width="270" height="150" />
                </Svg>
                <Text style={styles.flagCode}>+229</Text>
              </View>
              <TextInput
                style={styles.phoneInput}
                value={phoneInput}
                onChangeText={(v) => setPhoneInput(formatBeninPhoneInput(v))}
                placeholder="01 XX XX XX XX"
                placeholderTextColor={colors.outline}
                keyboardType="phone-pad"
                maxLength={14}
                autoFocus
              />
              {phoneValid && <MaterialIcons name="check-circle" size={20} color={colors.primary} />}
            </View>

            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancel}
                onPress={() => {
                  setAddVisible(false);
                  setPhoneInput("");
                }}
              >
                <Text style={styles.modalCancelText}>Annuler</Text>
              </Pressable>
              <Pressable
                style={[styles.modalConfirm, (!phoneValid || adding) && { opacity: 0.6 }]}
                disabled={!phoneValid || adding}
                onPress={handleAttachDriver}
              >
                {adding ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalConfirmText}>Rattacher</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: spacing.lg },
  header: {
    height: 58,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainer,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  headerSub: { ...typography.labelSm, color: colors.onSurfaceVariant },
  kycBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.primaryFixed,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: radius.full,
  },
  kycBtnText: { ...typography.labelSm, color: colors.primary, fontWeight: "800" },
  b2bBadge: {
    backgroundColor: colors.tertiaryFixed,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  b2bText: { ...typography.labelSm, color: colors.onTertiaryFixed, fontWeight: "700" },
  scroll: { padding: spacing.md, paddingBottom: 100 },
  muted: { ...typography.bodySm, color: colors.onSurfaceVariant, textAlign: "center", lineHeight: 20 },

  errorCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.errorContainer,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorTitle: { ...typography.labelMd, color: colors.error, fontWeight: "800" },
  errorText: { ...typography.bodySm, color: colors.onSurface, marginTop: 2 },
  smallPrimaryBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.full,
  },
  smallPrimaryBtnText: { ...typography.labelSm, color: "#fff", fontWeight: "700" },

  agencyCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
  },
  agencyTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
  agencyIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  agencyName: { ...typography.labelLg, color: colors.onSurface, fontWeight: "800" },
  agencyMeta: { ...typography.bodySm, color: colors.onSurfaceVariant, marginTop: 2 },
  planPill: {
    backgroundColor: colors.secondaryFixed,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  planPillText: { ...typography.labelSm, color: colors.onSecondaryFixed, fontWeight: "800" },

  capacitySection: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.lg,
    padding: spacing.sm + 2,
  },
  capacityHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  capacityLabel: { ...typography.labelSm, color: colors.onSurfaceVariant, fontWeight: "600" },
  capacityValue: { ...typography.labelSm, color: colors.onSurface, fontWeight: "800" },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceContainerHigh,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: colors.primary },

  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  statCard: {
    width: "48%",
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.sm + 2,
    gap: 2,
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
  },
  statValue: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800", marginTop: 2 },
  statLabel: { ...typography.labelSm, color: colors.onSurfaceVariant },
  statDelta: { ...typography.labelSm, color: colors.primary, fontWeight: "700", marginTop: 2 },

  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  sectionTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  sectionSub: { ...typography.labelSm, color: colors.onSurfaceVariant },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    height: 38,
    borderRadius: radius.full,
  },
  addBtnText: { ...typography.labelMd, color: "#fff", fontWeight: "800" },

  filterRow: { flexDirection: "row", gap: 8, marginBottom: spacing.sm },
  filterChip: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: "center",
    justifyContent: "center",
  },
  filterChipActive: { backgroundColor: colors.primaryFixed, borderWidth: 1, borderColor: colors.primary },
  filterChipText: { ...typography.labelSm, color: colors.onSurfaceVariant, fontWeight: "700" },
  filterChipTextActive: { color: colors.primary, fontWeight: "800" },

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

  driverRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
  },
  driverAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primaryFixed,
    alignItems: "center",
    justifyContent: "center",
  },
  driverInitial: { ...typography.labelMd, color: colors.primary, fontWeight: "800" },
  driverName: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  driverMeta: { ...typography.labelSm, color: colors.onSurfaceVariant, marginTop: 1 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full },
  statusPillText: { ...typography.labelSm, fontWeight: "700" },
  smallIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primaryFixed,
    alignItems: "center",
    justifyContent: "center",
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.sm,
  },
  modalTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  modalSub: { ...typography.bodySm, color: colors.onSurfaceVariant, lineHeight: 19 },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 50,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceContainerLow,
    paddingHorizontal: spacing.sm,
    gap: 8,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  phoneRowValid: { borderColor: colors.primary, backgroundColor: colors.surfaceContainerLowest },
  flagBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surfaceContainerLowest,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: radius.md,
  },
  flagCode: { ...typography.labelSm, color: colors.onSurface, fontWeight: "800" },
  phoneInput: { flex: 1, ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 4 },
  modalCancel: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.outline,
    alignItems: "center",
    justifyContent: "center",
  },
  modalCancelText: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  modalConfirm: {
    height: 40,
    paddingHorizontal: 20,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 110,
  },
  modalConfirmText: { ...typography.labelMd, color: "#fff", fontWeight: "800" },
});
