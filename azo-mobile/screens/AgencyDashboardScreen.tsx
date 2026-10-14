import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  agencyLevelPricing,
  tarification,
  type AgencyLevel,
} from "../services/tarification";
import { useI18n } from "../i18n";
import { agencyPlanName } from "../utils/agencyPlan";
import {
  cleanBeninDigits,
  formatBeninPhoneDisplay,
  formatBeninPhoneInput,
  isValidBeninPhone,
} from "../utils/phone";

type Props = {
  onBack: () => void;
  onOpenDossier?: () => void;
  /** Ouvre le portefeuille de l'agence (recharge FedaPay) : il alimente les recharges des chauffeurs et l'activation. */
  onOpenWallet?: () => void;
  /** Ouvre l'assistance (tickets avec l'équipe AZƆ̀). */
  onOpenSupport?: () => void;
};

type RosterFilter = "ALL" | "EN_COURSE" | "DISPONIBLE";

// Grille officielle AZƆ̀ : lue depuis la configuration tarifaire partagée
// (aucun montant codé en dur). Les niveaux ne concernent QUE les agences.
const OFFICIAL_AGENCY_GRID = (Object.keys(tarification().agencyLevels) as AgencyLevel[]).map((plan) => {
  const rules = agencyLevelPricing(plan);
  return {
    plan,
    fee: rules.activationFee,
    maxAccounts: rules.maxAccounts,
    commissionPct: rules.commissionPct,
    withdrawalFeePct: rules.withdrawalFeePct,
  };
});

export default function AgencyDashboardScreen({ onBack, onOpenDossier, onOpenWallet, onOpenSupport }: Props) {
  const { t, locale } = useI18n();
  const fcfa = (n: number) => `${n.toLocaleString(locale)} F`;
  const num = (n: number, opts?: Intl.NumberFormatOptions) => n.toLocaleString(locale, opts);
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

  // Modale « compte du chauffeur » : l'agence recharge ou retire de l'argent sur le compte d'un de ses chauffeurs
  const [xferMember, setXferMember] = useState<AgencyRosterMember | null>(null);
  const [xferMode, setXferMode] = useState<"fund" | "withdraw">("fund");
  const [xferAmount, setXferAmount] = useState("");
  const [xferBusy, setXferBusy] = useState(false);
  // Une clé par ouverture de la modale : un nouvel appui après une coupure réseau ne double pas l'opération
  const xferKey = useRef("");

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
      Alert.alert(t("ag.phoneRequired.title"), t("ag.phoneRequired.body"));
      return;
    }
    setAdding(true);
    try {
      const res = await agenciesApi.attachDriver(digits);
      setAddVisible(false);
      setPhoneInput("");
      await load();
      Alert.alert(
        t("ag.attached.title"),
        t("ag.attached.body", { name: res.driver.fullName || formatBeninPhoneDisplay(res.driver.phone) })
      );
    } catch (e) {
      Alert.alert(t("ag.attachFailed"), errorMessage(e));
    } finally {
      setAdding(false);
    }
  }

  function openTransfer(member: AgencyRosterMember) {
    xferKey.current = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setXferMember(member);
    setXferMode("fund");
    setXferAmount("");
  }

  const xferValue = Number(xferAmount.replace(/\D/g, ""));

  async function handleTransfer() {
    if (!xferMember) return;
    if (!Number.isInteger(xferValue) || xferValue < 1) {
      Alert.alert(t("ag.xfer.failed"), t("ag.xfer.amountInvalid"));
      return;
    }
    setXferBusy(true);
    try {
      const call = xferMode === "fund" ? agenciesApi.fundDriver : agenciesApi.withdrawFromDriver;
      const res = await call(xferMember.id, xferValue, xferKey.current);
      const name = xferMember.fullName || formatBeninPhoneDisplay(xferMember.phone);
      setXferMember(null);
      await load();
      Alert.alert(
        t(xferMode === "fund" ? "ag.xfer.doneFund.title" : "ag.xfer.doneWithdraw.title"),
        t(xferMode === "fund" ? "ag.xfer.doneFund.body" : "ag.xfer.doneWithdraw.body", {
          name,
          amount: fcfa(res.amount),
          balance: fcfa(res.agencyBalance),
        })
      );
    } catch (e) {
      Alert.alert(t("ag.xfer.failed"), errorMessage(e));
    } finally {
      setXferBusy(false);
    }
  }

  // Activation de l'agence : paiement UNIQUE des frais du niveau (non récurrent).
  const [activating, setActivating] = useState(false);

  function confirmActivation() {
    if (!data) return;
    Alert.alert(
      t("ag.activate.title"),
      t("ag.activate.body", { fee: fcfa(data.agency.activationFee), plan: agencyPlanName(data.agency.plan) }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("ag.activate.confirm"),
          onPress: async () => {
            setActivating(true);
            try {
              const res = await agenciesApi.activate();
              await load();
              Alert.alert(
                t("ag.activated.title"),
                t("ag.activated.body", {
                  plan: agencyPlanName(res.plan),
                  fee: fcfa(res.activationFee),
                  accounts: num(agencyLevelPricing(res.plan).maxAccounts),
                })
              );
            } catch (e) {
              Alert.alert(t("ag.activateFailed"), errorMessage(e));
            } finally {
              setActivating(false);
            }
          },
        },
      ]
    );
  }

  function confirmDetach(member: AgencyRosterMember) {
    const label = member.fullName || formatBeninPhoneDisplay(member.phone);
    Alert.alert(
      t("ag.detach.title"),
      t("ag.detach.body", { name: label }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("ag.detach.confirm"),
          style: "destructive",
          onPress: async () => {
            setDetachingId(member.id);
            try {
              await agenciesApi.detachDriver(member.id);
              await load();
            } catch (e) {
              Alert.alert(t("common.error"), errorMessage(e));
            } finally {
              setDetachingId(null);
            }
          },
        },
      ]
    );
  }

  function confirmLogout() {
    Alert.alert(t("ag.logout.title"), t("ag.logout.body"), [
      { text: t("common.cancel"), style: "cancel" },
      ...(onOpenDossier ? [{ text: t("ag.logout.dossier"), onPress: onOpenDossier }] : []),
      { text: t("ag.logout.confirm"), style: "destructive", onPress: onBack },
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
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={confirmLogout} style={styles.iconButton} accessibilityLabel={t("ag.menuLabel")}>
          <MaterialIcons name="arrow-back-ios-new" size={18} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {t("ag.title")}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {data
              ? t("ag.planLine", { plan: agencyPlanName(data.agency.plan), pct: num(data.agency.commissionRate * 100) })
              : t("ag.subtitleFleet")}
          </Text>
        </View>
        {onOpenSupport ? (
          <Pressable style={styles.kycBtn} onPress={onOpenSupport} accessibilityLabel={t("sup.title")}>
            <MaterialIcons name="support-agent" size={15} color={colors.primary} />
          </Pressable>
        ) : null}
        {onOpenWallet ? (
          <Pressable style={styles.kycBtn} onPress={onOpenWallet}>
            <MaterialIcons name="account-balance-wallet" size={15} color={colors.primary} />
            <Text style={styles.kycBtnText}>{t("ag.wallet")}</Text>
          </Pressable>
        ) : null}
        {onOpenDossier ? (
          <Pressable style={styles.kycBtn} onPress={onOpenDossier}>
            <MaterialIcons name="verified-user" size={15} color={colors.primary} />
            <Text style={styles.kycBtnText}>{t("ag.dossier")}</Text>
          </Pressable>
        ) : (
          <View style={styles.b2bBadge}>
            <Text style={styles.b2bText}>{t("ag.proBadge")}</Text>
          </View>
        )}
      </View>

      {/* Activation : paiement unique des frais du niveau, obligatoire pour opérer */}
      {data && !data.activated && (
        <View style={styles.activationBanner}>
          <MaterialIcons name="lock-clock" size={18} color={colors.error} />
          <View style={{ flex: 1 }}>
            <Text style={styles.activationTitle}>{t("ag.notActivated")}</Text>
            <Text style={styles.activationText}>
              {t("ag.notActivatedBody", {
                fee: fcfa(data.agency.activationFee),
                plan: agencyPlanName(data.agency.plan),
                commission: data.commissionPct,
                withdrawal: data.withdrawalFeePct,
                accounts: num(agencyLevelPricing(data.agency.plan).maxAccounts),
              })}
            </Text>
          </View>
          <Pressable style={styles.activationBtn} onPress={confirmActivation} disabled={activating}>
            <Text style={styles.activationBtnText}>{activating ? "…" : t("ag.activate")}</Text>
          </Pressable>
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.muted}>{t("ag.loading")}</Text>
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
                <Text style={styles.errorTitle}>{t("ag.loadError")}</Text>
                <Text style={styles.errorText}>{error}</Text>
              </View>
              <Pressable style={styles.smallPrimaryBtn} onPress={onRefresh}>
                <Text style={styles.smallPrimaryBtnText}>{t("common.retry")}</Text>
              </Pressable>
              {onOpenDossier ? (
                <Pressable style={styles.smallPrimaryBtn} onPress={onOpenDossier}>
                  <Text style={styles.smallPrimaryBtnText}>{t("ag.myDossier")}</Text>
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
                      {t("ag.metaLine", {
                        plan: agencyPlanName(data.agency.plan),
                        pct: num(data.agency.commissionRate * 100, { maximumFractionDigits: 2 }),
                      })}
                    </Text>
                  </View>
                  <View style={styles.planPill}>
                    <Text style={styles.planPillText}>{agencyPlanName(data.agency.plan)}</Text>
                  </View>
                </View>

                <View style={styles.capacitySection}>
                  <View style={styles.capacityHeader}>
                    <Text style={styles.capacityLabel}>{t("ag.capacity")}</Text>
                    <Text style={styles.capacityValue}>
                      {t("ag.capacityValue", {
                        used: data.seatsUsed,
                        total: data.seatsTotal,
                        pct: Math.round(capacityRatio * 100),
                      })}
                    </Text>
                  </View>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${Math.round(capacityRatio * 100)}%` }]} />
                  </View>
                  {typeof data.walletBalance === "number" ? (
                    <Text style={[styles.capacityLabel, { marginTop: spacing.xs }]}>
                      {t("ag.walletBalance", { amount: fcfa(data.walletBalance) })}
                    </Text>
                  ) : null}
                </View>
              </View>

              {/* 4 indicateurs réels */}
              <View style={styles.statsGrid}>
                <View style={styles.statCard}>
                  <MaterialIcons name="account-balance-wallet" size={20} color={colors.primary} />
                  <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                    {fcfa(data.netRevenue)}
                  </Text>
                  <Text style={styles.statLabel}>{t("ag.stat.net")}</Text>
                  <Text style={styles.statDelta}>{t("ag.stat.gross", { amount: fcfa(data.grossRevenue) })}</Text>
                </View>

                <View style={styles.statCard}>
                  <MaterialIcons name="two-wheeler" size={20} color={colors.primary} />
                  <Text style={styles.statValue} numberOfLines={1}>
                    {data.drivers} / {data.seatsTotal}
                  </Text>
                  <Text style={styles.statLabel}>{t("ag.stat.members")}</Text>
                  <Text style={styles.statDelta}>{t("ag.stat.activeNow", { n: data.activeRides })}</Text>
                </View>

                <View style={styles.statCard}>
                  <MaterialIcons name="verified" size={20} color={colors.primary} />
                  <Text style={styles.statValue} numberOfLines={1}>
                    {data.completedRides}
                  </Text>
                  <Text style={styles.statLabel}>{t("ag.stat.rides")}</Text>
                  <Text style={styles.statDelta}>{t("ag.stat.commissions", { amount: fcfa(data.commissionsPaid) })}</Text>
                </View>

                <View style={styles.statCard}>
                  <MaterialIcons name="star" size={20} color={colors.primary} />
                  <Text style={styles.statValue} numberOfLines={1}>
                    {data.averageRating != null ? data.averageRating.toFixed(2) : "—"}
                  </Text>
                  <Text style={styles.statLabel}>{t("ag.stat.rating")}</Text>
                  <Text style={styles.statDelta}>
                    {data.averageRating != null ? t("ag.stat.quality") : t("ag.stat.noRating")}
                  </Text>
                </View>
              </View>

              {/* En-tête Équipe + bouton d'ajout */}
              <View style={styles.sectionHeaderRow}>
                <View>
                  <Text style={styles.sectionTitle}>{t("ag.fleet", { n: data.roster.length })}</Text>
                  <Text style={styles.sectionSub}>{t("ag.fleetSub")}</Text>
                </View>
                <Pressable style={styles.addBtn} onPress={() => setAddVisible(true)}>
                  <MaterialIcons name="person-add-alt-1" size={17} color="#fff" />
                  <Text style={styles.addBtnText}>{t("ag.add")}</Text>
                </Pressable>
              </View>

              {/* Filtres de l'équipe */}
              <View style={styles.filterRow}>
                {(
                  [
                    ["ALL", t("ag.filter.all", { n: data.roster.length })],
                    ["EN_COURSE", t("ag.filter.busy", { n: data.roster.filter((m) => m.state === "EN_COURSE").length })],
                    ["DISPONIBLE", t("ag.filter.free", { n: data.roster.filter((m) => m.state === "DISPONIBLE").length })],
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
                  <Text style={styles.emptyTitle}>{t("ag.empty.title")}</Text>
                  <Text style={styles.muted}>{t("ag.empty.body")}</Text>
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
                            {t("ag.row.rides", { phone: formatBeninPhoneDisplay(d.phone), n: d.jobsCompleted })}
                            {d.rating > 0 ? ` · ★ ${d.rating.toFixed(1)}` : ""}
                          </Text>
                          {typeof d.balance === "number" ? (
                            <Text style={styles.driverMeta} numberOfLines={1}>
                              {t("ag.balance", { amount: fcfa(d.balance) })}
                            </Text>
                          ) : null}
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
                            {busyCourse ? t("ag.state.busy") : t("ag.state.free")}
                          </Text>
                        </View>
                        <Pressable
                          style={styles.smallIconBtn}
                          onPress={() => openTransfer(d)}
                          accessibilityLabel={t("ag.xfer.manage")}
                        >
                          <MaterialIcons name="account-balance-wallet" size={18} color={colors.primary} />
                        </Pressable>
                        <Pressable
                          style={styles.smallIconBtn}
                          onPress={() => Linking.openURL(`tel:${d.phone}`)}
                          accessibilityLabel={t("ag.call")}
                        >
                          <MaterialIcons name="phone" size={18} color={colors.primary} />
                        </Pressable>
                        <Pressable
                          style={[styles.smallIconBtn, { backgroundColor: colors.errorContainer }]}
                          disabled={detachingId === d.id}
                          onPress={() => confirmDetach(d)}
                          accessibilityLabel={t("ag.detachLabel")}
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
                {t("ag.grid")}
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
                        <Text style={styles.driverName}>{agencyPlanName(tier.plan)}</Text>
                        <Text style={styles.driverMeta}>
                          {t("ag.tierMeta", { fee: num(tier.fee), accounts: num(tier.maxAccounts) })}
                        </Text>
                      </View>
                      <View style={styles.planPill}>
                        <Text style={styles.planPillText}>{t("ag.tierComm", { pct: `${num(tier.commissionPct)} %` })}</Text>
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
            <Text style={styles.modalTitle}>{t("ag.modal.title")}</Text>
            <Text style={styles.modalSub}>{t("ag.modal.sub")}</Text>

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
                <Text style={styles.modalCancelText}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable
                style={[styles.modalConfirm, (!phoneValid || adding) && { opacity: 0.6 }]}
                disabled={!phoneValid || adding}
                onPress={handleAttachDriver}
              >
                {adding ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalConfirmText}>{t("ag.modal.attach")}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modale « compte du chauffeur » : recharger ou retirer de l'argent */}
      <Modal visible={!!xferMember} transparent animationType="fade" onRequestClose={() => setXferMember(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            {xferMember ? (
              <>
                <Text style={styles.modalTitle}>
                  {t("ag.xfer.title", { name: xferMember.fullName || formatBeninPhoneDisplay(xferMember.phone) })}
                </Text>
                <Text style={styles.modalSub}>
                  {typeof xferMember.balance === "number" ? t("ag.xfer.driverBalance", { amount: fcfa(xferMember.balance) }) : ""}
                  {typeof xferMember.balance === "number" && typeof data?.walletBalance === "number" ? "\n" : ""}
                  {typeof data?.walletBalance === "number" ? t("ag.walletBalance", { amount: fcfa(data.walletBalance) }) : ""}
                </Text>

                <View style={styles.filterRow}>
                  {(["fund", "withdraw"] as const).map((mode) => {
                    const active = xferMode === mode;
                    return (
                      <Pressable
                        key={mode}
                        style={[styles.filterChip, active && styles.filterChipActive]}
                        onPress={() => setXferMode(mode)}
                      >
                        <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                          {t(mode === "fund" ? "ag.xfer.fund" : "ag.xfer.withdraw")}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={styles.phoneRow}>
                  <TextInput
                    style={styles.phoneInput}
                    value={xferAmount}
                    onChangeText={(v) => setXferAmount(v.replace(/\D/g, "").slice(0, 7))}
                    placeholder={t("ag.xfer.amount")}
                    placeholderTextColor={colors.outline}
                    keyboardType="number-pad"
                    maxLength={7}
                  />
                </View>
                <Text style={styles.modalSub}>{t(xferMode === "fund" ? "ag.xfer.hint.fund" : "ag.xfer.hint.withdraw")}</Text>

                <View style={styles.modalActions}>
                  <Pressable style={styles.modalCancel} onPress={() => setXferMember(null)}>
                    <Text style={styles.modalCancelText}>{t("common.cancel")}</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.modalConfirm, (xferValue < 1 || xferBusy) && { opacity: 0.6 }]}
                    disabled={xferValue < 1 || xferBusy}
                    onPress={handleTransfer}
                  >
                    {xferBusy ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.modalConfirmText}>
                        {t(xferMode === "fund" ? "ag.xfer.confirmFund" : "ag.xfer.confirmWithdraw", { amount: fcfa(xferValue || 0) })}
                      </Text>
                    )}
                  </Pressable>
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  activationBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.errorContainer,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  activationTitle: { ...typography.labelMd, color: colors.error, fontWeight: "800" },
  activationText: { ...typography.labelSm, color: colors.error, marginTop: 2, lineHeight: 17 },
  activationBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  activationBtnText: { ...typography.labelMd, color: "#fff", fontWeight: "800" },
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
