import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { walletApi, WalletTransaction } from "../services/api";

const ACTIONS = [
  { id: "recharge", label: "Recharger", icon: "add-circle" as const },
  { id: "transfer", label: "Transférer", icon: "send" as const },
  { id: "history", label: "Historique", icon: "receipt-long" as const },
  { id: "security", label: "Sécurité", icon: "fingerprint" as const },
];

const PAYMENT_METHODS = [
  { id: "momo", label: "MTN Mobile Money", meta: "+229 01 97 •• 00 42", tag: "Par défaut", icon: "MTN" },
  { id: "celtiis", label: "Celtiis Cash Bénin", meta: "+229 01 40 •• 33 90", tag: "Secondaire", icon: "CLTS" },
  { id: "moov", label: "Moov Money Bénin", meta: "+229 01 95 •• 11 44", tag: undefined, icon: "MOOV" },
  { id: "visa", label: "Carte Visa UBA Bénin", meta: "•••• •••• •••• 8902 · Exp 09/28", tag: undefined, icon: "VISA" },
];

const ACTIVITY = [
  { id: "demo-1", label: "Course Zem Express — Haie Vive → Ganhi", meta: "Aujourd'hui, 10:42 · Romaric Soglo", amount: "-700 F", positive: false, icon: "two-wheeler" as const },
  { id: "demo-2", label: "Rechargement MTN MoMo", meta: "Hier, 16:30 · Réf. MM-891042", amount: "+25 000 F", positive: true, icon: "arrow-downward" as const },
  { id: "demo-3", label: "Coursier Personnel — Pharmacie Camp Guézo → Fidjrossè", meta: "Hier, 09:15 · Fifamè Arnaud Zinsou", amount: "-1 500 F", positive: false, icon: "local-shipping" as const },
  { id: "demo-4", label: "Voiture Confort — Aéroport Cotonou → Novotel", meta: "Il y a 2 jours · Ulrich Houngbédji", amount: "-2 500 F", positive: false, icon: "directions-car" as const },
];

type Props = { onBack: () => void };

export default function WalletScreen({ onBack }: Props) {
  // Solde réel depuis le backend (nécessite d'être connecté via l'écran OTP)
  const [balance, setBalance] = useState<number | null>(null);
  const [cashback, setCashback] = useState(0);
  const [tx, setTx] = useState<WalletTransaction[]>([]);

  // Recharge le solde ET l'historique depuis le backend
  async function load() {
    try {
      const [w, t] = await Promise.all([walletApi.get(), walletApi.transactions()]);
      setBalance(w.balance);
      setCashback(w.cashback);
      setTx(t);
    } catch {
      setBalance(48500);
      setCashback(1250);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Recharge simulée de 5 000 FCFA (le vrai paiement FedaPay viendra plus tard)
  function handleRecharge() {
    Alert.alert("Recharger", "Ajouter 5 000 FCFA à ton portefeuille (simulation, sans vrai paiement) ?", [
      { text: "Annuler", style: "cancel" },
      {
        text: "Recharger",
        onPress: async () => {
          try {
            await walletApi.recharge(5000, "MTN_MOMO");
            await load();
          } catch (e: any) {
            Alert.alert("Erreur", e.message);
          }
        },
      },
    ]);
  }

  // Transforme les transactions du backend au format d'affichage
  // Sécurisé avec (tx || []) pour éviter le crash si tx n'est pas encore un tableau
  const activity =
    tx && tx.length > 0
      ? tx.map((t) => ({
          id: t.id,
          label: t.label,
          meta: `${new Date(t.createdAt).toLocaleString("fr-FR")}${t.meta ? " · " + t.meta : ""}`,
          amount: `${t.type === "CREDIT" ? "+" : "-"}${t.amount.toLocaleString("fr-FR")} F`,
          positive: t.type === "CREDIT",
          icon: (t.type === "CREDIT" ? "arrow-downward" : "arrow-upward") as keyof typeof MaterialIcons.glyphMap,
        }))
      : ACTIVITY;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.iconButton}>
          <MaterialIcons name="arrow-back-ios-new" size={18} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Portefeuille</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <LinearGradient colors={colors.gradientCta} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Solde disponible · AZƆ̀ Pay</Text>
          <Text style={styles.balanceValue}>
            {balance === null ? "— FCFA" : `${balance.toLocaleString("fr-FR")} FCFA`}
          </Text>
          <View style={styles.cashbackRow}>
            <MaterialIcons name="stars" size={16} color="#fff" />
            <Text style={styles.cashbackText}>Cashback : +{cashback} F</Text>
          </View>
        </LinearGradient>

        <View style={styles.actionsRow}>
          {ACTIONS.map((a) => (
            <Pressable key={a.id} style={styles.actionItem} onPress={() => a.id === "recharge" && handleRecharge()}>
              <View style={styles.actionIcon}>
                <MaterialIcons name={a.icon} size={22} color={colors.primary} />
              </View>
              <Text style={styles.actionLabel}>{a.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Moyens de paiement</Text>
          <Text style={styles.sectionAction}>Gérer</Text>
        </View>
        <View style={{ gap: spacing.sm }}>
          {PAYMENT_METHODS.map((m) => (
            <View key={m.id} style={styles.paymentCard}>
              <View style={styles.paymentLogo}>
                <Text style={styles.paymentLogoText}>{m.icon}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.paymentLabel}>{m.label}</Text>
                <Text style={styles.paymentMeta}>{m.meta}</Text>
              </View>
              {m.tag && (
                <View style={styles.tagPill}>
                  <Text style={styles.tagText}>{m.tag}</Text>
                </View>
              )}
            </View>
          ))}
          <Pressable style={styles.addCardRow}>
            <MaterialIcons name="add-card" size={20} color={colors.primary} />
            <Text style={styles.addCardText}>Lier un nouveau compte ou carte</Text>
          </Pressable>
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Activité récente</Text>
          <Text style={styles.sectionAction}>Tout voir</Text>
        </View>
        <View style={{ gap: spacing.sm }}>
          {activity.length === 0 && (
            <Text style={styles.activityMeta}>Aucune transaction pour le moment.</Text>
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
