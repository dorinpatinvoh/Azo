import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Image, Modal, TextInput, View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as SecureStore from "expo-secure-store";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { errorMessage, userApi, walletApi, WalletTransaction } from "../services/api";
import PaymentWebView from "../components/PaymentWebView";
import ClientTabBar from "../components/ClientTabBar";
import PillTabBar from "../components/PillTabBar";
import { ZEM_TABS } from "./DriverHomeScreen";
import { COURIER_TABS } from "./CourierHomeScreen";
import { AGENCY_TABS } from "./AgencyDashboardScreen";
import { MIN_RECHARGE, MIN_WITHDRAWAL, RECHARGE_POLL_MAX_MS, RECHARGE_POLL_MS, RECHARGE_PRESETS } from "../config/wallet";
import { useI18n, type MessageKey } from "../i18n";
import { BrandAlert } from "../components/BrandAlert";

const ACTIONS: { id: string; labelKey: MessageKey; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { id: "recharge", labelKey: "wallet.act.recharge", icon: "add-circle" },
  { id: "withdraw", labelKey: "wallet.act.withdraw", icon: "payments" },
  { id: "history", labelKey: "wallet.act.history", icon: "receipt-long" },
];

// Moyens acceptés par FedaPay au Bénin (documentation FedaPay : MTN, Moov, Celtiis, cartes Visa et Mastercard).
// Aucun numéro ni carte inventés : le serveur ne liste pas les comptes liés, le choix se fait sur la page FedaPay.
const PAYMENT_METHODS: { id: string; label: string; metaKey: MessageKey; icon: string }[] = [
  { id: "momo", label: "MTN Mobile Money", metaKey: "wallet.pm.mobile", icon: "MTN" },
  { id: "moov", label: "Moov Money", metaKey: "wallet.pm.mobile", icon: "MOOV" },
  { id: "celtiis", label: "Celtiis Cash", metaKey: "wallet.pm.mobile", icon: "CLTS" },
  { id: "visa", label: "Visa", metaKey: "wallet.pm.card", icon: "VISA" },
  { id: "mastercard", label: "Mastercard", metaKey: "wallet.pm.card", icon: "MC" },
];
type Props = {
  onBack: () => void;
  /** Un onglet de la barre du bas a été touché (l'application ouvre l'écran correspondant du profil de l'utilisateur). */
  onNavigateTab?: (tab: string) => void;
};

type BarKind = "client" | "zem" | "courier" | "agency" | null;

export default function WalletScreen({ onBack, onNavigateTab }: Props) {
  const { t, locale } = useI18n();
  // Speeder, conducteurs et coursiers ne rechargent pas AZƆ̀ Pay : leur solde vient des courses (et de leur agence)
  const [canRecharge, setCanRecharge] = useState(true);
  // Seuls les prestataires (Speeder, coursier, agence) retirent leur gain vers Mobile Money
  const [canWithdraw, setCanWithdraw] = useState(false);
  // Barre du bas de CE profil (client, Speeder, coursier, agence) : elle ne doit jamais disparaître en ouvrant AZƆ̀ Pay
  const [barKind, setBarKind] = useState<BarKind>(null);
  useEffect(() => {
    Promise.all([SecureStore.getItemAsync("userRole"), SecureStore.getItemAsync("providerType")])
      .then(([roleRaw, typeRaw]) => {
        const role = (roleRaw ?? "").toUpperCase().trim();
        const type = (typeRaw ?? "").toUpperCase().trim();
        setCanRecharge(role !== "DRIVER");
        setCanWithdraw(role === "DRIVER" || role === "COURIER" || role === "AGENCY");
        setBarKind(
          role === "CLIENT" ? "client" : role === "AGENCY" || type === "AGENCY" ? "agency" : role === "DRIVER" || role === "COURIER" ? (type === "COURIER" || role === "COURIER" ? "courier" : "zem") : null
        );
      })
      .catch(() => undefined);
  }, []);
  const [loadFailed, setLoadFailed] = useState(false);
  // Solde réel depuis le backend (nécessite d'être connecté via l'écran OTP)
  const [balance, setBalance] = useState<number | null>(null);
  const [cashback, setCashback] = useState(0);
  const [tx, setTx] = useState<WalletTransaction[]>([]);

  // Recharge le solde ET l'historique depuis le backend (renvoie le solde lu, ou null si le serveur est injoignable)
  const load = useCallback(async (): Promise<{ balance: number; list: WalletTransaction[] } | null> => {
    try {
      const [w, list] = await Promise.all([walletApi.get(), walletApi.transactions()]);
      setBalance(w.balance);
      setCashback(w.cashback);
      setTx(list);
      setLoadFailed(false);
      return { balance: w.balance, list };
    } catch {
      // Serveur injoignable : pas de solde inventé (48 500 F s'affichait avant), « — FCFA » et un message
      setLoadFailed(true);
      return null;
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // --- Recharge FedaPay -------------------------------------------------------------------------------------------
  // Le crédit n'arrive pas à la fin du paiement mais quand FedaPay prévient le serveur (webhook). On suit donc le solde :
  // toutes les 4 s pendant 3 minutes, et dès que l'application revient au premier plan (retour de la page de paiement).
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [rechargeAmount, setRechargeAmount] = useState("");
  const [rechargeBusy, setRechargeBusy] = useState(false);
  // Adresse de paiement FedaPay affichée dans l'application (fenêtre plein écran), sans quitter l'application
  const [payUrl, setPayUrl] = useState<string | null>(null);
  // Recharge suivie : on repère SA transaction (numéro FedaPay), pas une variation du solde — d'autres crédits peuvent arriver entre-temps
  const [awaiting, setAwaiting] = useState<{ transactionId: number; amount: number; since: number } | null>(null);
  const awaitingRef = useRef(awaiting);
  awaitingRef.current = awaiting;
  const finished = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const activityY = useRef(0);

  const checkCredited = useCallback(async () => {
    const pending = awaitingRef.current;
    if (!pending) return;
    const data = await load();
    if (!data || finished.current) return;
    const mine = data.list.find((item) => item.meta === `fedaPayId:${pending.transactionId}`);
    if (mine?.status === "CONFIRMED") {
      // Créditée : la fenêtre de paiement se ferme toute seule et le nouveau solde est déjà affiché derrière
      finished.current = true;
      setAwaiting(null);
      setPayUrl(null);
      BrandAlert.alert(
        t("wallet.recharge.done.title"),
        t("wallet.recharge.done.body", { amount: mine.amount.toLocaleString(locale), balance: data.balance.toLocaleString(locale) })
      );
    } else if (mine?.status === "FAILED") {
      finished.current = true;
      setAwaiting(null);
      setPayUrl(null);
      BrandAlert.alert(t("wallet.recharge.title"), t("wallet.recharge.failed"));
    } else if (Date.now() - pending.since > RECHARGE_POLL_MAX_MS) {
      finished.current = true;
      setAwaiting(null);
      BrandAlert.alert(t("wallet.recharge.title"), t("wallet.recharge.timeout"));
    }
  }, [load, locale, t]);

  useEffect(() => {
    if (!awaiting) return;
    finished.current = false;
    const timer = setInterval(checkCredited, RECHARGE_POLL_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") checkCredited();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [awaiting, checkCredited]);

  const rechargeValue = Number(rechargeAmount.replace(/\D/g, ""));
  const rechargeValid = Number.isInteger(rechargeValue) && rechargeValue >= MIN_RECHARGE;

  async function startRecharge() {
    if (!rechargeValid) {
      BrandAlert.alert(t("common.error"), t("wallet.recharge.min", { min: MIN_RECHARGE }));
      return;
    }
    setRechargeBusy(true);
    try {
      // Le serveur renvoie l'adresse de paiement FedaPay et le numéro de la transaction : le crédit est contrôlé juste après le paiement
      const { url, transactionId } = await walletApi.recharge(rechargeValue, "FEDAPAY");
      setRechargeOpen(false);
      setAwaiting({ transactionId, amount: rechargeValue, since: Date.now() });
      if (url) setPayUrl(url);
    } catch (e) {
      BrandAlert.alert(t("common.error"), errorMessage(e));
    } finally {
      setRechargeBusy(false);
    }
  }

  // --- Retrait vers Mobile Money (prestataires) ------------------------------------------------------------------------
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawPhone, setWithdrawPhone] = useState("");
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [withdrawQuote, setWithdrawQuote] = useState<{ fee: number; feePct: number; netAmount: number } | null>(null);
  const withdrawValue = Number(withdrawAmount.replace(/\D/g, ""));
  const withdrawPhoneDigits = withdrawPhone.replace(/\D/g, "");
  const withdrawPhoneValid = withdrawPhoneDigits.length === 10 && withdrawPhoneDigits.startsWith("01");
  const withdrawTooMuch = balance !== null && withdrawValue > balance;
  const withdrawValid = Number.isInteger(withdrawValue) && withdrawValue >= MIN_WITHDRAWAL && !withdrawTooMuch && withdrawPhoneValid;

  // Frais et net à recevoir : calculés par le serveur à chaque montant saisi
  useEffect(() => {
    if (!withdrawOpen || !Number.isInteger(withdrawValue) || withdrawValue < MIN_WITHDRAWAL) {
      setWithdrawQuote(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      walletApi.withdrawalQuote(withdrawValue).then((q) => !cancelled && setWithdrawQuote(q)).catch(() => !cancelled && setWithdrawQuote(null));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [withdrawOpen, withdrawValue]);

  function handleWithdraw() {
    if (!canWithdraw) return;
    setWithdrawAmount("");
    setWithdrawQuote(null);
    setWithdrawOpen(true);
    // Numéro de connexion proposé par défaut : modifiable
    if (!withdrawPhone) {
      userApi
        .me()
        .then((me) => {
          const digits = String(me.phone ?? "").replace(/\D/g, "");
          const local = digits.startsWith("229") ? digits.slice(3) : digits;
          if (local.length === 10) setWithdrawPhone(local);
        })
        .catch(() => undefined);
    }
  }

  async function startWithdraw() {
    if (!withdrawValid) return;
    setWithdrawBusy(true);
    try {
      const res = await walletApi.withdraw(withdrawValue, withdrawPhoneDigits);
      setWithdrawOpen(false);
      await load();
      BrandAlert.alert(
        t("wallet.withdraw.done.title"),
        t("wallet.withdraw.done.body", {
          net: res.netAmount.toLocaleString(locale),
          phone: withdrawPhoneDigits.replace(/(\d{2})(?=\d)/g, "$1 "),
          balance: res.balance.toLocaleString(locale),
        })
      );
    } catch (e) {
      BrandAlert.alert(t("common.error"), errorMessage(e));
    } finally {
      setWithdrawBusy(false);
    }
  }

  function handleRecharge() {
    if (!canRecharge) return;
    setRechargeAmount("");
    setRechargeOpen(true);
  }

  // Transforme les transactions du backend au format d'affichage (aucune ligne de démonstration)
  const activity = (tx ?? []).map((item) => ({
    id: item.id,
    label: item.label,
    meta: `${new Date(item.createdAt).toLocaleString(locale)}${item.meta ? " · " + item.meta : ""}`,
    amount: `${item.type === "CREDIT" ? "+" : "-"}${item.amount.toLocaleString(locale)} F${
      item.status === "PENDING" ? " " + t("wallet.tx.pending") : item.status === "FAILED" ? " " + t("wallet.tx.failed") : ""
    }`,
    positive: item.type === "CREDIT" && (item.status ?? "CONFIRMED") === "CONFIRMED",
    icon: (item.type === "CREDIT" ? "arrow-downward" : "arrow-upward") as keyof typeof MaterialIcons.glyphMap,
  }));

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.iconButton} accessibilityLabel={t("common.back")}>
          <MaterialIcons name="arrow-back-ios-new" size={18} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>{t("wallet.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll}>
        <LinearGradient colors={colors.gradientCta} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>{t("wallet.balance")}</Text>
          <Text style={styles.balanceValue}>
            {balance === null ? "— FCFA" : `${balance.toLocaleString(locale)} FCFA`}
          </Text>
          <View style={styles.cashbackRow}>
            <MaterialIcons name="stars" size={16} color="#fff" />
            <Text style={styles.cashbackText}>{t("wallet.cashback", { amount: cashback })}</Text>
          </View>
          {loadFailed && <Text style={styles.cashbackText}>{t("wallet.loadError")}</Text>}
          {awaiting && (
            <View style={styles.cashbackRow}>
              <ActivityIndicator size="small" color="#fff" />
              <View style={{ flex: 1 }}>
                <Text style={styles.cashbackText}>{t("wallet.recharge.pending")}</Text>
                <Text style={[styles.cashbackText, { fontWeight: "400" }]}>{t("wallet.recharge.pendingHelp")}</Text>
              </View>
            </View>
          )}
        </LinearGradient>

        <View style={styles.actionsRow}>
          {ACTIONS.filter((a) => (canRecharge || a.id !== "recharge") && (canWithdraw || a.id !== "withdraw")).map((a) => (
            <Pressable key={a.id} style={styles.actionItem} onPress={() => (a.id === "recharge" ? handleRecharge() : a.id === "withdraw" ? handleWithdraw() : scrollRef.current?.scrollTo({ y: activityY.current, animated: true }))}>
              <View style={styles.actionIcon}>
                <MaterialIcons name={a.icon} size={22} color={colors.primary} />
              </View>
              <Text style={styles.actionLabel}>{t(a.labelKey)}</Text>
            </Pressable>
          ))}
        </View>

        {canRecharge && (
          <View style={styles.fedaCard}>
            <View style={styles.fedaHead}>
              <View style={styles.fedaLogoBox}>
                <Image source={require("../assets/logo_feda.png")} style={styles.fedaLogo} resizeMode="contain" accessibilityLabel="FedaPay" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fedaTitle}>{t("wallet.fedapay.title")}</Text>
                <Text style={styles.fedaSub}>{t("wallet.fedapay.sub")}</Text>
              </View>
            </View>
            <Text style={styles.fedaAccepted}>{t("wallet.fedapay.accepted")}</Text>
            <View style={styles.fedaChips}>
              {PAYMENT_METHODS.map((m) => (
                <View key={m.id} style={styles.fedaChip}>
                  <View style={styles.fedaChipBadge}>
                    <Text style={styles.fedaChipBadgeText}>{m.icon}</Text>
                  </View>
                  <View>
                    <Text style={styles.fedaChipLabel}>{m.label}</Text>
                    <Text style={styles.fedaChipMeta}>{t(m.metaKey)}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.sectionHeaderRow} onLayout={(e) => { activityY.current = e.nativeEvent.layout.y; }}>
          <Text style={styles.sectionTitle}>{t("wallet.activity")}</Text>
        </View>
        <View style={{ gap: spacing.sm }}>
          {activity.length === 0 && (
            <Text style={styles.activityMeta}>{t("wallet.noTx")}</Text>
          )}
          {activity.map((a) => (
            <View key={a.id} style={styles.activityRow}>
              <View style={styles.activityIcon}>
                <MaterialIcons name={a.icon} size={18} color={colors.onSurfaceVariant} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.activityLabel}>{a.label}</Text>
                <Text style={styles.activityMeta}>{a.meta}</Text>
              </View>
              <Text style={[styles.activityAmount, { color: a.positive ? colors.primary : colors.onSurface }]}>
                {a.amount}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {barKind === "client" && <ClientTabBar active="wallet" onNavigate={(tab) => onNavigateTab?.(tab)} />}
      {barKind === "zem" && <PillTabBar items={ZEM_TABS} active="wallet" onNavigate={(tab) => tab !== "wallet" && onNavigateTab?.(tab)} />}
      {barKind === "courier" && <PillTabBar items={COURIER_TABS} active="wallet" onNavigate={(tab) => tab !== "wallet" && onNavigateTab?.(tab)} />}
      {barKind === "agency" && <PillTabBar items={AGENCY_TABS} active="wallet" onNavigate={(tab) => tab !== "wallet" && onNavigateTab?.(tab)} />}

      {/* Page de paiement FedaPay intégrée : se ferme à la fin du paiement, le solde est ensuite suivi automatiquement */}
      <PaymentWebView
        url={payUrl}
        onClose={() => {
          setPayUrl(null);
          checkCredited();
        }}
        onReturn={() => {
          setPayUrl(null);
          checkCredited();
        }}
      />

      {/* Retrait vers Mobile Money : montant, numéro, frais calculés par le serveur */}
      <Modal visible={withdrawOpen} transparent animationType="fade" onRequestClose={() => setWithdrawOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t("wallet.withdraw.title")}</Text>
            <Text style={styles.modalHint}>{t("wallet.withdraw.available", { amount: (balance ?? 0).toLocaleString(locale) })}</Text>
            <Text style={styles.modalHint}>{t("wallet.withdraw.amountLabel", { min: MIN_WITHDRAWAL.toLocaleString(locale) })}</Text>
            <TextInput
              style={styles.amountInput}
              value={withdrawAmount}
              onChangeText={(v) => setWithdrawAmount(v.replace(/\D/g, "").slice(0, 7))}
              placeholder={t("wallet.recharge.placeholder")}
              placeholderTextColor={colors.outline}
              keyboardType="number-pad"
              maxLength={7}
            />
            {withdrawTooMuch ? <Text style={styles.modalError}>{t("wallet.withdraw.tooMuch")}</Text> : null}
            {withdrawQuote && !withdrawTooMuch ? (
              <Text style={styles.modalHint}>
                {t("wallet.withdraw.quote", { fee: withdrawQuote.fee.toLocaleString(locale), pct: withdrawQuote.feePct, net: withdrawQuote.netAmount.toLocaleString(locale) })}
              </Text>
            ) : null}
            <Text style={styles.modalHint}>{t("wallet.withdraw.phoneLabel")}</Text>
            <TextInput
              style={styles.amountInput}
              value={withdrawPhone}
              onChangeText={(v) => setWithdrawPhone(v.replace(/[^\d ]/g, "").slice(0, 14))}
              placeholder="01 XX XX XX XX"
              placeholderTextColor={colors.outline}
              keyboardType="number-pad"
              maxLength={14}
            />
            {withdrawPhone !== "" && !withdrawPhoneValid ? <Text style={styles.modalError}>{t("wallet.withdraw.invalidPhone")}</Text> : <Text style={styles.modalHint}>{t("wallet.withdraw.help")}</Text>}
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setWithdrawOpen(false)}>
                <Text style={styles.modalCancelText}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable
                style={[styles.modalConfirm, (!withdrawValid || withdrawBusy) && { opacity: 0.6 }]}
                disabled={!withdrawValid || withdrawBusy}
                onPress={startWithdraw}
              >
                {withdrawBusy ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalConfirmText}>{t("wallet.withdraw.send", { amount: `${(withdrawValue || 0).toLocaleString(locale)} F` })}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Montant de la recharge FedaPay (minimum {MIN_RECHARGE} FCFA) */}
      <Modal visible={rechargeOpen} transparent animationType="fade" onRequestClose={() => setRechargeOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t("wallet.recharge.title")}</Text>
            <Text style={styles.modalHint}>{t("wallet.recharge.amountLabel", { min: MIN_RECHARGE })}</Text>
            <View style={styles.presetRow}>
              {RECHARGE_PRESETS.map((value) => {
                const active = rechargeValue === value;
                return (
                  <Pressable
                    key={value}
                    style={[styles.presetChip, active && styles.presetChipActive]}
                    onPress={() => setRechargeAmount(String(value))}
                  >
                    <Text style={[styles.presetText, active && styles.presetTextActive]}>{value.toLocaleString(locale)}</Text>
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              style={styles.amountInput}
              value={rechargeAmount}
              onChangeText={(v) => setRechargeAmount(v.replace(/\D/g, "").slice(0, 7))}
              placeholder={t("wallet.recharge.placeholder")}
              placeholderTextColor={colors.outline}
              keyboardType="number-pad"
              maxLength={7}
            />
            {rechargeAmount !== "" && !rechargeValid ? (
              <Text style={styles.modalError}>{t("wallet.recharge.min", { min: MIN_RECHARGE })}</Text>
            ) : (
              <Text style={styles.modalHint}>{t("wallet.recharge.secure")}</Text>
            )}
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setRechargeOpen(false)}>
                <Text style={styles.modalCancelText}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable
                style={[styles.modalConfirm, (!rechargeValid || rechargeBusy) && { opacity: 0.6 }]}
                disabled={!rechargeValid || rechargeBusy}
                onPress={startRecharge}
              >
                {rechargeBusy ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalConfirmText}>
                    {t("wallet.recharge.pay", { amount: `${(rechargeValue || 0).toLocaleString(locale)} F` })}
                  </Text>
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
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: spacing.lg },
  modalCard: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.sm },
  modalTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  modalHint: { ...typography.bodySm, color: colors.onSurfaceVariant, lineHeight: 20 },
  modalError: { ...typography.bodySm, color: colors.error, lineHeight: 20 },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  presetChip: { paddingHorizontal: 14, height: 38, borderRadius: radius.full, backgroundColor: colors.surfaceContainer, alignItems: "center", justifyContent: "center" },
  presetChipActive: { backgroundColor: colors.primary },
  presetText: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  presetTextActive: { color: "#fff" },
  amountInput: { ...typography.headlineSm, color: colors.onSurface, borderWidth: 1.5, borderColor: colors.outlineVariant, borderRadius: radius.lg, paddingHorizontal: spacing.md, height: 52 },
  modalActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  modalCancel: { flex: 1, height: 46, borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.outlineVariant, alignItems: "center", justifyContent: "center" },
  modalCancelText: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
  modalConfirm: { flex: 1.4, height: 46, borderRadius: radius.full, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  modalConfirmText: { ...typography.labelLg, color: "#fff", fontWeight: "800" },
  safe: { flex: 1, backgroundColor: colors.background },
  header: { height: 56, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  iconButton: { width: 40, height: 40, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...typography.headlineSm, color: colors.onSurface },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  balanceCard: { borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.md },
  balanceLabel: { ...typography.labelMd, color: "rgba(255,255,255,0.85)" },
  balanceValue: { ...typography.displayLgMobile, color: "#fff", marginTop: 4 },
  cashbackRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
  cashbackText: { ...typography.labelSm, color: "#fff", fontWeight: "700" },
  actionsRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: spacing.lg },
  actionItem: { alignItems: "center", gap: 6 },
  actionIcon: { width: 52, height: 52, borderRadius: radius.full, backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center" },
  actionLabel: { ...typography.labelSm, color: colors.onSurface },
  sectionHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm, marginTop: spacing.sm },
  sectionTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "700" },
  sectionAction: { ...typography.labelMd, color: colors.primary, fontWeight: "700" },
  fedaCard: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.surfaceContainer },
  fedaHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  fedaLogoBox: { width: 96, height: 72, overflow: "hidden", borderRadius: radius.lg, backgroundColor: "#fff", borderWidth: 1, borderColor: colors.surfaceContainer },
  fedaLogo: { width: 150, height: 150, marginLeft: -27, marginTop: -33 },
  fedaTitle: { ...typography.labelLg, color: colors.onSurface, fontWeight: "800" },
  fedaSub: { ...typography.bodySm, color: colors.onSurfaceVariant, marginTop: 2 },
  fedaAccepted: { ...typography.labelSm, color: colors.onSurfaceVariant, textTransform: "uppercase", marginTop: spacing.xs },
  fedaChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  fedaChip: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surfaceContainerLow, borderRadius: radius.lg, paddingVertical: 8, paddingHorizontal: 10, flexGrow: 1, flexBasis: "46%" },
  fedaChipBadge: { minWidth: 40, height: 28, borderRadius: radius.md, backgroundColor: colors.surfaceContainerLowest, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  fedaChipBadgeText: { ...typography.labelSm, color: colors.tertiary, fontWeight: "800" },
  fedaChipLabel: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  fedaChipMeta: { ...typography.bodySm, color: colors.onSurfaceVariant },
  paymentCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.md, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  paymentLogo: { width: 40, height: 40, borderRadius: radius.full, backgroundColor: colors.surfaceContainer, alignItems: "center", justifyContent: "center" },
  paymentLogoText: { ...typography.labelSm, color: colors.secondary, fontWeight: "700" },
  paymentLabel: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
  paymentMeta: { ...typography.bodySm, color: colors.onSurfaceVariant },
  tagPill: { backgroundColor: colors.primaryFixed, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full },
  tagText: { ...typography.labelSm, color: colors.onPrimaryFixed, fontWeight: "700" },
  addCardRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  addCardText: { ...typography.labelMd, color: colors.primary, fontWeight: "700" },
  activityRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.md },
  activityIcon: { width: 36, height: 36, borderRadius: radius.full, backgroundColor: colors.surfaceContainer, alignItems: "center", justifyContent: "center" },
  activityLabel: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  activityMeta: { ...typography.bodySm, color: colors.onSurfaceVariant },
  activityAmount: { ...typography.labelMd, fontWeight: "800" },
});
