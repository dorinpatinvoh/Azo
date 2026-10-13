import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Alert, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { walletApi, WalletTransaction } from "../services/api";
import { useI18n, type MessageKey } from "../i18n";

const ACTIONS: { id: string; labelKey: MessageKey; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { id: "recharge", labelKey: "wallet.act.recharge", icon: "add-circle" },
  { id: "transfer", labelKey: "wallet.act.transfer", icon: "send" },
  { id: "history", labelKey: "wallet.act.history", icon: "receipt-long" },
  { id: "security", labelKey: "wallet.act.security", icon: "fingerprint" },
];

// Moyens de paiement acceptés (aucun numéro ni carte inventés : le serveur ne liste pas encore les comptes liés)
const PAYMENT_METHODS: { id: string; label: string; metaKey: MessageKey; icon: string }[] = [
  { id: "momo", label: "MTN Mobile Money", metaKey: "wallet.pm.mobile", icon: "MTN" },
  { id: "celtiis", label: "Celtiis Cash Bénin", metaKey: "wallet.pm.mobile", icon: "CLTS" },
  { id: "moov", label: "Moov Money Bénin", metaKey: "wallet.pm.mobile", icon: "MOOV" },
  { id: "visa", label: "Visa", metaKey: "wallet.pm.card", icon: "VISA" },
];

type Props = { onBack: () => void };

export default function WalletScreen({ onBack }: Props) {
  const { t, locale } = useI18n();
  const [loadFailed, setLoadFailed] = useState(false);
  // Solde réel depuis le backend (nécessite d'être connecté via l'écran OTP)
  const [balance, setBalance] = useState<number | null>(null);
  const [cashback, setCashback] = useState(0);
  const [tx, setTx] = useState<WalletTransaction[]>([]);

  // Recharge le solde ET l'historique depuis le backend
  async function load() {
    try {
      const [w, list] = await Promise.all([walletApi.get(), walletApi.transactions()]);
      setBalance(w.balance);
      setCashback(w.cashback);
      setTx(list);
      setLoadFailed(false);
    } catch {
      // Serveur injoignable : pas de solde inventé (48 500 F s'affichait avant), « — FCFA » et un message
      setLoadFailed(true);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Recharge simulée de 5 000 FCFA (le vrai paiement FedaPay viendra plus tard)
  function handleRecharge() {
    Alert.alert(t("wallet.rechargeTitle"), t("wallet.rechargeBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("wallet.rechargeTitle"),
        onPress: async () => {
          try {
            // Le serveur renvoie l'adresse de paiement FedaPay : le crédit arrive après le paiement
            const { url } = await walletApi.recharge(5000, "MTN_MOMO");
            if (url) await Linking.openURL(url);
            await load();
          } catch (e: any) {
            Alert.alert(t("common.error"), e.message);
          }
        },
      },
    ]);
  }

  // Transforme les transactions du backend au format d'affichage (aucune ligne de démonstration)
  const activity = (tx ?? []).map((item) => ({
    id: item.id,
    label: item.label,
    meta: `${new Date(item.createdAt).toLocaleString(locale)}${item.meta ? " · " + item.meta : ""}`,
    amount: `${item.type === "CREDIT" ? "+" : "-"}${item.amount.toLocaleString(locale)} F`,
    positive: item.type === "CREDIT",
    icon: (item.type === "CREDIT" ? "arrow-downward" : "arrow-upward") as keyof typeof MaterialIcons.glyphMap,
  }));

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.iconButton} accessibilityLabel={t("common.back")}>
          <MaterialIcons name="arrow-back-ios-new" size={18} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>{t("wallet.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
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
        </LinearGradient>

        <View style={styles.actionsRow}>
          {ACTIONS.map((a) => (
            <Pressable key={a.id} style={styles.actionItem} onPress={() => a.id === "recharge" && handleRecharge()}>
              <View style={styles.actionIcon}>
                <MaterialIcons name={a.icon} size={22} color={colors.primary} />
              </View>
              <Text style={styles.actionLabel}>{t(a.labelKey)}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>{t("wallet.methods")}</Text>
          <Text style={styles.sectionAction}>{t("wallet.manage")}</Text>
        </View>
        <View style={{ gap: spacing.sm }}>
          {PAYMENT_METHODS.map((m) => (
            <View key={m.id} style={styles.paymentCard}>
              <View style={styles.paymentLogo}>
                <Text style={styles.paymentLogoText}>{m.icon}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.paymentLabel}>{m.label}</Text>
                <Text style={styles.paymentMeta}>{t(m.metaKey)}</Text>
              </View>
            </View>
          ))}
          <Pressable style={styles.addCardRow}>
            <MaterialIcons name="add-card" size={20} color={colors.primary} />
            <Text style={styles.addCardText}>{t("wallet.link")}</Text>
          </Pressable>
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>{t("wallet.activity")}</Text>
          <Text style={styles.sectionAction}>{t("wallet.seeAll")}</Text>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
