import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import PrimaryButton from "../components/PrimaryButton";
import { deliveryApi } from "../services/api";

const PACKAGE_TYPES = [
  { id: "doc", label: "Document", note: "Pli < 1 kg", icon: "drafts" as const },
  { id: "small", label: "Petit Colis", note: "Sac/Repas < 5 kg", icon: "shopping-bag" as const },
  { id: "medium", label: "Colis Moyen", note: "Carton < 15 kg", icon: "inventory-2" as const },
];

type Props = { onBack: () => void; onConfirm: () => void };

export default function DeliveryScreen({ onBack, onConfirm }: Props) {
  const [selectedType, setSelectedType] = useState("small");
  const [payer, setPayer] = useState<"me" | "recipient">("me");
  const [loading, setLoading] = useState(false);

  // Crée la livraison : le backend génère les 2 codes de sécurité (ramassage + remise)
  async function handleConfirm() {
    setLoading(true);
    try {
      const d = await deliveryApi.create({
        packageType: selectedType,
        pickupAddress: "Haie Vive, Pharmacie Cotonou",
        dropAddress: "Akpakpa, Dodomè, Rue des Pavés",
        payer: payer === "me" ? "SENDER" : "RECIPIENT",
        price: 1500,
      });
      Alert.alert(
        "Coursier en recherche",
        `Code de ramassage : ${d.pickupCode}\nCode de remise (destinataire) : ${d.deliveryCode}`,
        [{ text: "OK", onPress: onConfirm }]
      );
    } catch (e: any) {
      Alert.alert("Erreur", e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.iconButton}>
          <MaterialIcons name="arrow-back-ios-new" size={18} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Livraison colis</Text>
        <View style={styles.iconButton}>
          <MaterialIcons name="fmd-bad" size={18} color={colors.error} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.banner}>
          <MaterialIcons name="verified-user" size={22} color={colors.onPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerTitle}>Course Express Cotonou</Text>
            <Text style={styles.bannerSubtitle}>24 coursier(s) disponibles</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Type de paquet à expédier</Text>
        <View style={{ gap: spacing.sm }}>
          {PACKAGE_TYPES.map((p) => {
            const active = p.id === selectedType;
            return (
              <Pressable
                key={p.id}
                style={[styles.typeCard, active && styles.typeCardActive]}
                onPress={() => setSelectedType(p.id)}
              >
                <View style={[styles.typeIcon, { backgroundColor: active ? colors.primaryContainer : colors.surfaceContainer }]}>
                  <MaterialIcons name={p.icon} size={22} color={active ? colors.onPrimary : colors.onSurfaceVariant} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.typeLabel}>{p.label}</Text>
                  <Text style={styles.typeNote}>{p.note}</Text>
                </View>
                {active && <MaterialIcons name="check-circle" size={20} color={colors.primary} />}
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Adresses</Text>
        <View style={styles.addressCard}>
          <Text style={styles.addressLabel}>Point de ramassage</Text>
          <Text style={styles.addressValue}>Haie Vive, Pharmacie Cotonou</Text>
          <Text style={styles.addressMeta}>Koffi Mensah (+229 97••10)</Text>
          <View style={styles.divider} />
          <Text style={styles.addressLabel}>Point de livraison</Text>
          <Text style={styles.addressValue}>Akpakpa, Dodomè, Rue des Pavés</Text>
        </View>

        <View style={styles.otpBanner}>
          <MaterialIcons name="verified-user" size={20} color={colors.primary} />
          <Text style={styles.otpTitle}>Double sécurité OTP antivol — AZƆ̀ Protection intégrale brevetée</Text>
        </View>
        <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
          <View style={styles.otpStep}>
            <MaterialIcons name="pin" size={18} color={colors.secondary} />
            <Text style={styles.otpStepText}>
              <Text style={{ fontWeight: "700" }}>1. Ramassage — </Text>
              Code remis au coursier à Haie Vive avant le départ.
            </Text>
          </View>
          <View style={styles.otpStep}>
            <MaterialIcons name="lock-clock" size={18} color={colors.secondary} />
            <Text style={styles.otpStepText}>
              <Text style={{ fontWeight: "700" }}>2. Remise finale — </Text>
              SMS 4 chiffres au destinataire pour déverrouiller.
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Prise en charge de la course</Text>
        <View style={styles.payerRow}>
          <Pressable
            style={[styles.payerChip, payer === "me" && styles.payerChipActive]}
            onPress={() => setPayer("me")}
          >
            <MaterialIcons name="account-balance-wallet" size={18} color={payer === "me" ? colors.onPrimary : colors.onSurfaceVariant} />
            <Text style={[styles.payerText, payer === "me" && { color: colors.onPrimary }]}>Par moi</Text>
          </Pressable>
          <Pressable
            style={[styles.payerChip, payer === "recipient" && styles.payerChipActive]}
            onPress={() => setPayer("recipient")}
          >
            <MaterialIcons name="payments" size={18} color={payer === "recipient" ? colors.onPrimary : colors.onSurfaceVariant} />
            <Text style={[styles.payerText, payer === "recipient" && { color: colors.onPrimary }]}>Par destinataire</Text>
          </Pressable>
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <PrimaryButton label="Trouver un coursier" icon="local-shipping" onPress={handleConfirm} loading={loading} />
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
  scroll: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.xs },
  banner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  bannerTitle: { ...typography.labelLg, color: colors.onPrimary, fontWeight: "700" },
  bannerSubtitle: { ...typography.bodySm, color: "rgba(255,255,255,0.85)" },
  sectionTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "700", marginTop: spacing.md, marginBottom: spacing.sm },
  typeCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.md, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  typeCardActive: { borderWidth: 1.5, borderColor: colors.primary, backgroundColor: `${colors.primaryFixed}40` },
  typeIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  typeLabel: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
  typeNote: { ...typography.bodySm, color: colors.onSurfaceVariant },
  addressCard: { backgroundColor: colors.surfaceContainerLow, borderRadius: radius.lg, padding: spacing.md },
  addressLabel: { ...typography.labelSm, color: colors.outline, textTransform: "uppercase" },
  addressValue: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700", marginTop: 2 },
  addressMeta: { ...typography.bodySm, color: colors.onSurfaceVariant, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.surfaceContainerHigh, marginVertical: spacing.sm },
  otpBanner: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, backgroundColor: colors.primaryFixed, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.md },
  otpTitle: { ...typography.labelSm, color: colors.onPrimaryFixed, flex: 1 },
  otpStep: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  otpStepText: { ...typography.bodySm, color: colors.onSurfaceVariant, flex: 1 },
  payerRow: { flexDirection: "row", gap: spacing.sm },
  payerChip: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.surfaceContainerLow },
  payerChipActive: { backgroundColor: colors.primary },
  payerText: { ...typography.labelMd, color: colors.onSurfaceVariant, fontWeight: "700" },
});
