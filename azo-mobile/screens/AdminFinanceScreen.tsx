import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import { LinearGradient } from "expo-linear-gradient";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { AdminCommissionRow, AdminCompanyWithdrawal, AdminFinanceSummary, adminApi, errorMessage } from "../services/api";
import { cleanBeninDigits, formatBeninPhoneDisplay, formatBeninPhoneInput, isValidBeninPhone } from "../utils/phone";
import AdminTabBar, { type AdminTab } from "../components/AdminTabBar";
import { BrandAlert } from "../components/BrandAlert";

type Props = {
  onNavigateTab?: (tab: AdminTab) => void;
};

const fcfa = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} F`;

const SOURCE_ICONS: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  RIDE_COMMISSIONS: "two-wheeler",
  DELIVERY_COMMISSIONS: "local-shipping",
  AGENCY_ACTIVATIONS: "apartment",
  WITHDRAWAL_FEES: "price-change",
  SPEEDER_MONTHLY_SHARE: "event-repeat",
};

const OPERATORS = ["MTN", "MOOV", "CELTIIS"] as const;

const STATUS_META: Record<AdminCompanyWithdrawal["status"], { label: string; bg: string; fg: string }> = {
  REQUESTED: { label: "En attente", bg: colors.tertiaryFixed, fg: colors.onTertiaryFixed },
  PAID: { label: "Versé", bg: "#DDF3E4", fg: "#146C2E" },
  CANCELLED: { label: "Annulé", bg: colors.surfaceContainer, fg: colors.onSurfaceVariant },
};

const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "short" }).replace(".", "");
};

/** Finances de l'entreprise : ce que l'on a gagné, d'où ça vient, et les retraits. */
export default function AdminFinanceScreen({ onNavigateTab }: Props) {
  const [summary, setSummary] = useState<AdminFinanceSummary | null>(null);
  const [withdrawals, setWithdrawals] = useState<AdminCompanyWithdrawal[]>([]);
  const [commissions, setCommissions] = useState<AdminCommissionRow[]>([]);
  const [commissionsError, setCommissionsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fenêtre de retrait
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [operator, setOperator] = useState<(typeof OPERATORS)[number]>("MTN");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Fenêtre « marquer comme versé »
  const [paying, setPaying] = useState<AdminCompanyWithdrawal | null>(null);
  const [reference, setReference] = useState("");

  const load = useCallback(async () => {
    try {
      const [s, w, c] = await Promise.all([adminApi.financeSummary(), adminApi.withdrawals(), adminApi.commissions(40).then((rows) => { setCommissionsError(null); return rows; }).catch((e) => { setCommissionsError("Commissions indisponibles : " + errorMessage(e)); return [] as AdminCommissionRow[]; })]);
      setSummary(s);
      setWithdrawals(w);
      setCommissions(c);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const amountValue = Number(amount.replace(/\D/g, ""));
  const available = summary?.available ?? 0;
  const minWithdrawal = summary?.minWithdrawal ?? 1000;
  const phoneDigits = cleanBeninDigits(phone);
  const phoneValid = isValidBeninPhone(phoneDigits);
  const amountProblem =
    amount === ""
      ? null
      : amountValue < minWithdrawal
        ? `Minimum : ${fcfa(minWithdrawal)}`
        : amountValue > available
          ? `Maximum disponible : ${fcfa(available)}`
          : null;
  const canSubmit = amountValue >= minWithdrawal && amountValue <= available && phoneValid && !busy;

  async function submitWithdrawal() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await adminApi.requestWithdrawal({ amount: amountValue, phone: phoneDigits, method: operator, note: note.trim() || undefined });
      setOpen(false);
      setAmount("");
      setNote("");
      await load();
      BrandAlert.alert("Retrait enregistré", `${fcfa(amountValue)} à verser sur ${formatBeninPhoneDisplay(phoneDigits)}. Marque-le comme versé une fois l'argent envoyé.`);
    } catch (e) {
      BrandAlert.alert("Retrait impossible", errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmPaid() {
    if (!paying) return;
    setBusy(true);
    try {
      await adminApi.markWithdrawalPaid(paying.id, reference.trim() || undefined);
      setPaying(null);
      setReference("");
      await load();
    } catch (e) {
      BrandAlert.alert("Opération impossible", errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function confirmCancel(w: AdminCompanyWithdrawal) {
    BrandAlert.alert("Annuler ce retrait ?", `${fcfa(w.amount)} redeviendront disponibles.`, [
      { text: "Non", style: "cancel" },
      {
        text: "Annuler le retrait",
        style: "destructive",
        onPress: async () => {
          try {
            await adminApi.cancelWithdrawal(w.id);
            await load();
          } catch (e) {
            BrandAlert.alert("Opération impossible", errorMessage(e));
          }
        },
      },
    ]);
  }

  const maxMonth = useMemo(() => Math.max(1, ...(summary?.months ?? []).map((m) => m.total)), [summary]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Finances</Text>
        <Text style={styles.subtitle}>Gains de l'entreprise et retraits</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        >
          {error ? (
            <View style={styles.errorCard}>
              <MaterialIcons name="error-outline" size={20} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
              <Pressable onPress={onRefresh}>
                <Text style={styles.link}>Réessayer</Text>
              </Pressable>
            </View>
          ) : null}

          {summary ? (
            <>
              {/* Ce que l'on a gagné */}
              <LinearGradient colors={[colors.onPrimaryFixed, colors.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
                <Text style={styles.heroLabel}>Gains cumulés de l'entreprise</Text>
                <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>{fcfa(summary.total)}</Text>
                <View style={styles.heroRow}>
                  <View style={styles.heroChip}>
                    <Text style={styles.heroChipLabel}>Ce mois</Text>
                    <Text style={styles.heroChipValue}>{fcfa(summary.thisMonth)}</Text>
                  </View>
                  <View style={styles.heroChip}>
                    <Text style={styles.heroChipLabel}>Déjà retiré</Text>
                    <Text style={styles.heroChipValue}>{fcfa(summary.withdrawn)}</Text>
                  </View>
                </View>
              </LinearGradient>

              {/* Disponible au retrait */}
              <View style={styles.availableCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.availableLabel}>Disponible au retrait</Text>
                  <Text style={styles.availableValue} numberOfLines={1} adjustsFontSizeToFit>{fcfa(summary.available)}</Text>
                  {summary.pendingWithdrawals > 0 ? (
                    <Text style={styles.availableHint}>{fcfa(summary.pendingWithdrawals)} en attente de versement</Text>
                  ) : null}
                </View>
                <Pressable
                  style={[styles.withdrawBtn, summary.available < minWithdrawal && { opacity: 0.45 }]}
                  disabled={summary.available < minWithdrawal}
                  onPress={() => setOpen(true)}
                  accessibilityRole="button"
                >
                  <MaterialIcons name="north-east" size={18} color={colors.onPrimary} />
                  <Text style={styles.withdrawText}>Faire un retrait</Text>
                </Pressable>
              </View>

              {/* Commissions reçues : une ligne par course, avec le Speeder et le détail de la course */}
              <View style={styles.sectionHeadRow}>
                <Text style={styles.sectionTitle}>Commissions reçues</Text>
                <Text style={styles.sectionCount}>{commissions.length} dernières · {fcfa(commissions.reduce((sum, c) => sum + c.commission, 0))}</Text>
              </View>
              {commissionsError ? <Text style={styles.commissionError}>{commissionsError}</Text> : null}
              <View style={styles.card}>
                {commissions.length === 0 ? (
                  <Text style={styles.sourceSub}>Aucune course terminée pour le moment : chaque course terminée apparaîtra ici avec sa commission.</Text>
                ) : (
                  commissions.map((c, i) => (
                    <View key={`${c.kind}-${c.id}`} style={[styles.commissionRow, i < commissions.length - 1 && styles.divider]}>
                      <View style={styles.sourceIcon}>
                        <MaterialIcons name={c.kind === "RIDE" ? "two-wheeler" : c.kind === "PERSONAL" ? "directions-run" : "local-shipping"} size={20} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.sourceLabel} numberOfLines={1}>{c.driverName ?? c.who ?? "Prestataire inconnu"}</Text>
                        <Text style={styles.sourceSub} numberOfLines={1}>
                          {c.ref} · {c.independent === false ? `Agence ${c.agencyName ?? ""}`.trim() : "Indépendant"}{c.driverPhone ? ` · ${c.driverPhone}` : ""}
                        </Text>
                        {c.origin || c.dest ? (
                          <Text style={styles.sourceSub} numberOfLines={2}>
                            {c.origin ?? "Départ ?"} → {c.dest ?? "Arrivée ?"}
                          </Text>
                        ) : null}
                        <Text style={styles.sourceSub} numberOfLines={2}>
                          {new Date(c.date).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          {c.clientName ? ` · Client : ${c.clientName}` : ""}
                          {typeof c.distanceKm === "number" ? ` · ${c.distanceKm.toLocaleString("fr-FR", { maximumFractionDigits: 3 })} km` : ""}
                        </Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={styles.commissionValue}>+{fcfa(c.commission)}</Text>
                        <Text style={styles.sourceSub}>{c.pct.toLocaleString("fr-FR")} % de {fcfa(c.amount)}</Text>
                      </View>
                    </View>
                  ))
                )}
              </View>

              {/* D'où viennent les gains */}
              <Text style={styles.sectionTitle}>D'où viennent les gains</Text>
              <View style={styles.card}>
                {summary.sources.map((s, i) => (
                  <View key={s.key} style={[styles.sourceRow, i < summary.sources.length - 1 && styles.divider]}>
                    <View style={styles.sourceIcon}>
                      <MaterialIcons name={SOURCE_ICONS[s.key] ?? "paid"} size={20} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sourceLabel}>{s.label}</Text>
                      <Text style={styles.sourceSub}>Ce mois : {fcfa(s.thisMonth)}</Text>
                    </View>
                    <Text style={styles.sourceTotal}>{fcfa(s.total)}</Text>
                  </View>
                ))}
              </View>

              {/* 6 derniers mois */}
              <Text style={styles.sectionTitle}>Les 6 derniers mois</Text>
              <View style={styles.card}>
                <View style={styles.chart}>
                  {summary.months.map((m) => (
                    <View key={m.month} style={styles.barCol}>
                      <Text style={styles.barValue} numberOfLines={1}>{m.total > 0 ? Math.round(m.total / 1000) + "k" : ""}</Text>
                      <View style={styles.barTrack}>
                        <View style={[styles.barFill, { height: `${Math.max(4, Math.round((m.total / maxMonth) * 100))}%` }]} />
                      </View>
                      <Text style={styles.barLabel}>{monthLabel(m.month)}</Text>
                    </View>
                  ))}
                </View>
              </View>

              {/* Retraits */}
              <Text style={styles.sectionTitle}>Retraits</Text>
              {withdrawals.length === 0 ? (
                <Text style={styles.empty}>Aucun retrait pour l'instant.</Text>
              ) : (
                <View style={{ gap: spacing.sm }}>
                  {withdrawals.map((w) => {
                    const meta = STATUS_META[w.status];
                    return (
                      <View key={w.id} style={styles.wCard}>
                        <View style={styles.wTop}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.wAmount}>{fcfa(w.amount)}</Text>
                            <Text style={styles.wMeta}>
                              {w.method ? `${w.method} · ` : ""}{formatBeninPhoneDisplay(w.phone)}
                            </Text>
                            <Text style={styles.wMeta}>
                              {new Date(w.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </Text>
                            {w.note ? <Text style={styles.wMeta}>« {w.note} »</Text> : null}
                            {w.reference ? <Text style={styles.wMeta}>Réf. {w.reference}</Text> : null}
                          </View>
                          <View style={[styles.pill, { backgroundColor: meta.bg }]}>
                            <Text style={[styles.pillText, { color: meta.fg }]}>{meta.label}</Text>
                          </View>
                        </View>
                        {w.status === "REQUESTED" ? (
                          <View style={styles.wActions}>
                            <Pressable style={[styles.wBtn, { flex: 1.4 }]} onPress={() => { setPaying(w); setReference(""); }}>
                              <MaterialIcons name="check-circle" size={17} color={colors.primary} />
                              <Text style={styles.wBtnText}>Marquer comme versé</Text>
                            </Pressable>
                            <Pressable style={[styles.wBtn, { backgroundColor: colors.errorContainer }]} onPress={() => confirmCancel(w)}>
                              <MaterialIcons name="close" size={17} color={colors.error} />
                              <Text style={[styles.wBtnText, { color: colors.error }]}>Annuler</Text>
                            </Pressable>
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              )}
              <Text style={styles.disclaimer}>
                Les gains sont calculés à partir des courses, livraisons, activations d'agences et frais réellement enregistrés. Le versement sur le compte Mobile Money se fait ensuite à la main : marque le retrait « versé » une fois l'argent envoyé.
              </Text>
            </>
          ) : null}
        </ScrollView>
      )}

      <AdminTabBar active="finance" onNavigate={onNavigateTab} />

      {/* Faire un retrait */}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <ScrollView contentContainerStyle={styles.modalWrap} keyboardShouldPersistTaps="handled">
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Faire un retrait</Text>
              <Text style={styles.modalSub}>Disponible : {fcfa(available)} · minimum {fcfa(minWithdrawal)}</Text>

              <Text style={styles.fieldLabel}>Montant (FCFA)</Text>
              <View style={[styles.field, !!amountProblem && { borderColor: colors.error }]}>
                <TextInput
                  style={styles.fieldInput}
                  value={amount}
                  onChangeText={(v) => setAmount(v.replace(/\D/g, "").slice(0, 9))}
                  placeholder="Ex. 50000"
                  placeholderTextColor={colors.outline}
                  keyboardType="number-pad"
                />
                <Pressable onPress={() => setAmount(String(available))} hitSlop={8}>
                  <Text style={styles.link}>Tout retirer</Text>
                </Pressable>
              </View>
              {amountProblem ? <Text style={styles.problem}>{amountProblem}</Text> : null}

              <Text style={styles.fieldLabel}>Opérateur Mobile Money</Text>
              <View style={styles.opRow}>
                {OPERATORS.map((op) => (
                  <Pressable key={op} style={[styles.op, operator === op && styles.opActive]} onPress={() => setOperator(op)}>
                    <Text style={[styles.opText, operator === op && { color: colors.onPrimary }]}>{op === "MOOV" ? "Moov" : op === "CELTIIS" ? "Celtiis" : "MTN"}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.labelRow}>
                <Text style={styles.fieldLabel}>Numéro qui reçoit l'argent</Text>
                <Text style={styles.count}>{phoneDigits.length}/10</Text>
              </View>
              <View style={[styles.field, phoneValid && { borderColor: colors.primary }]}>
                <Text style={styles.prefix}>+229</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={phone}
                  onChangeText={(v) => setPhone(formatBeninPhoneInput(v))}
                  placeholder="01 XX XX XX XX"
                  placeholderTextColor={colors.outline}
                  keyboardType="phone-pad"
                  maxLength={14}
                />
                {phoneValid ? <MaterialIcons name="check-circle" size={20} color={colors.primary} /> : null}
              </View>

              <Text style={styles.fieldLabel}>Note (facultatif)</Text>
              <View style={styles.field}>
                <TextInput style={styles.fieldInput} value={note} onChangeText={setNote} placeholder="Ex. Avance salaires" placeholderTextColor={colors.outline} maxLength={200} />
              </View>

              <Pressable style={[styles.primary, !canSubmit && { opacity: 0.5 }]} disabled={!canSubmit} onPress={submitWithdrawal}>
                {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryText}>Enregistrer le retrait</Text>}
              </Pressable>
              <Pressable style={styles.cancel} onPress={() => setOpen(false)}>
                <Text style={styles.cancelText}>Annuler</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Marquer comme versé */}
      <Modal visible={!!paying} transparent animationType="fade" onRequestClose={() => setPaying(null)}>
        <View style={styles.backdrop}>
          <View style={[styles.modalCard, { margin: spacing.lg }]}>
            <Text style={styles.modalTitle}>Retrait versé ?</Text>
            <Text style={styles.modalSub}>
              {paying ? `${fcfa(paying.amount)} sur ${formatBeninPhoneDisplay(paying.phone)}` : ""}
            </Text>
            <Text style={styles.fieldLabel}>Référence de l'opération (facultatif)</Text>
            <View style={styles.field}>
              <TextInput style={styles.fieldInput} value={reference} onChangeText={setReference} placeholder="Ex. numéro de transaction MoMo" placeholderTextColor={colors.outline} maxLength={80} />
            </View>
            <Pressable style={[styles.primary, busy && { opacity: 0.5 }]} disabled={busy} onPress={confirmPaid}>
              {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryText}>Oui, c'est versé</Text>}
            </Pressable>
            <Pressable style={styles.cancel} onPress={() => setPaying(null)}>
              <Text style={styles.cancelText}>Pas encore</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  title: { ...typography.headlineLg, color: colors.onSurface, fontWeight: "800" },
  subtitle: { ...typography.bodySm, color: colors.onSurfaceVariant },
  scroll: { padding: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.xl, gap: spacing.sm },
  errorCard: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.errorContainer, borderRadius: radius.md, padding: spacing.sm },
  errorText: { ...typography.labelSm, color: colors.error, flex: 1 },
  link: { ...typography.labelMd, color: colors.primary, fontWeight: "800" },
  hero: { borderRadius: 28, padding: spacing.lg, gap: 6 },
  heroLabel: { ...typography.labelMd, color: "rgba(255,255,255,0.85)" },
  heroValue: { ...typography.displayLgMobile, color: colors.onPrimary, fontSize: 38, lineHeight: 44, fontWeight: "800" },
  heroRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  heroChip: { flex: 1, backgroundColor: "rgba(255,255,255,0.16)", borderRadius: radius.lg, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  heroChipLabel: { ...typography.labelSm, color: "rgba(255,255,255,0.8)" },
  heroChipValue: { ...typography.labelLg, color: colors.onPrimary, fontWeight: "800" },
  availableCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, padding: spacing.md, borderWidth: 1.5, borderColor: colors.primary },
  availableLabel: { ...typography.labelMd, color: colors.onSurfaceVariant },
  availableValue: { ...typography.headlineMd, color: colors.primary, fontWeight: "800" },
  availableHint: { ...typography.labelSm, color: colors.onSurfaceVariant, marginTop: 2 },
  withdrawBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, height: 46 },
  withdrawText: { ...typography.labelMd, color: colors.onPrimary, fontWeight: "800" },
  sectionTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800", marginTop: spacing.md },
  card: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, padding: spacing.md, borderWidth: 1, borderColor: colors.surfaceContainer },
  sectionHeadRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.sm },
  sectionCount: { ...typography.bodySm, flexShrink: 1, color: colors.onSurfaceVariant },
  commissionError: { ...typography.bodySm, color: colors.error, marginBottom: spacing.xs },
  commissionRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, paddingVertical: spacing.sm },
  commissionValue: { ...typography.labelLg, color: "#146C2E", fontWeight: "800" },
  sourceRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 2, paddingVertical: spacing.sm },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.surfaceContainer },
  sourceIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center" },
  sourceLabel: { ...typography.bodyLg, color: colors.onSurface, fontWeight: "700" },
  sourceSub: { ...typography.labelSm, color: colors.onSurfaceVariant },
  sourceTotal: { ...typography.labelLg, color: colors.onSurface, fontWeight: "800" },
  chart: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: 150, gap: 8 },
  barCol: { flex: 1, alignItems: "center", height: "100%", justifyContent: "flex-end", gap: 4 },
  barValue: { ...typography.labelSm, color: colors.onSurfaceVariant, fontSize: 10 },
  barTrack: { width: "70%", flex: 1, justifyContent: "flex-end" },
  barFill: { width: "100%", backgroundColor: colors.primary, borderTopLeftRadius: 8, borderTopRightRadius: 8 },
  barLabel: { ...typography.labelSm, color: colors.onSurfaceVariant },
  empty: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  wCard: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.surfaceContainer },
  wTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  wAmount: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  wMeta: { ...typography.bodySm, color: colors.onSurfaceVariant, marginTop: 1 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full },
  pillText: { ...typography.labelSm, fontWeight: "800" },
  wActions: { flexDirection: "row", gap: 8 },
  wBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 40, borderRadius: radius.full, backgroundColor: colors.primaryFixed },
  wBtnText: { ...typography.labelMd, color: colors.primary, fontWeight: "700" },
  disclaimer: { ...typography.bodySm, color: colors.onSurfaceVariant, marginTop: spacing.md },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center" },
  modalWrap: { flexGrow: 1, justifyContent: "center", padding: spacing.lg },
  modalCard: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, padding: spacing.md, gap: spacing.sm },
  modalTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  modalSub: { ...typography.bodySm, color: colors.onSurfaceVariant },
  fieldLabel: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700", marginTop: spacing.xs },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.xs },
  count: { ...typography.labelSm, color: colors.primary, fontWeight: "800" },
  field: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 50, borderRadius: radius.lg, backgroundColor: colors.surfaceContainerLow, borderWidth: 1.5, borderColor: "transparent", paddingHorizontal: spacing.sm + 2 },
  fieldInput: { flex: 1, ...typography.bodyLg, color: colors.onSurface, fontWeight: "700" },
  prefix: { ...typography.labelMd, color: colors.onSurface, fontWeight: "800" },
  problem: { ...typography.labelSm, color: colors.error },
  opRow: { flexDirection: "row", gap: 8 },
  op: { flex: 1, height: 42, borderRadius: radius.full, backgroundColor: colors.surfaceContainer, alignItems: "center", justifyContent: "center" },
  opActive: { backgroundColor: colors.primary },
  opText: { ...typography.labelMd, color: colors.onSurface, fontWeight: "800" },
  primary: { height: 50, borderRadius: radius.full, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", marginTop: spacing.sm },
  primaryText: { ...typography.labelLg, color: "#fff", fontWeight: "800" },
  cancel: { height: 40, alignItems: "center", justifyContent: "center" },
  cancelText: { ...typography.labelLg, color: colors.onSurfaceVariant, fontWeight: "700" },
});
