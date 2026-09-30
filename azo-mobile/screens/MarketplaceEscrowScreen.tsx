import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import PrimaryButton from "../components/PrimaryButton";
import { marketplaceApi } from "../services/api";

const ITEMS = [
  { id: 1, label: "2 Paniers de Tomates fraîches", note: "Triées fermes", price: 2500 },
  { id: 2, label: "Piment vert & Oignons rouges", note: "Épicerie locale", price: 1200 },
  { id: 3, label: "Poisson fumé capitaine (1 lot)", note: "Pièces entières", price: 3500 },
];

type Props = { onBack: () => void; onConfirm: () => void };

export default function MarketplaceEscrowScreen({ onBack, onConfirm }: Props) {
  const total = ITEMS.reduce((sum, i) => sum + i.price, 0);
  const [loading, setLoading] = useState(false);

  // Passe la commande : le backend débite le portefeuille et bloque l'argent en séquestre
  async function handleConfirm() {
    setLoading(true);
    try {
      await marketplaceApi.order({
        market: "Grand Marché Dantokpa",
        items: ITEMS.map((i) => ({ label: i.label, note: i.note, price: i.price })),
      });
      Alert.alert("Coursier envoyé", "Ton argent est bloqué en séquestre jusqu'à validation de la livraison.", [
        { text: "OK", onPress: onConfirm },
      ]);
    } catch (e: any) {
      Alert.alert("Commande impossible", e.message);
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
        <Text style={styles.headerTitle}>Courses au marché</Text>
        <View style={styles.iconButton}>
          <MaterialIcons name="fmd-bad" size={18} color={colors.error} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.banner}>
          <MaterialIcons name="verified-user" size={22} color={colors.onPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerTitle}>Service d'Achat Assisté Garanti</Text>
            <Text style={styles.bannerSubtitle}>
              Un coursier certifié AZƆ̀ négocie au meilleur prix, valide avec vous et livre à votre porte.
            </Text>
          </View>
        </View>

        <View style={styles.marketCard}>
          <View style={styles.marketIcon}>
            <MaterialIcons name="storefront" size={22} color={colors.onSurfaceVariant} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.marketLabel}>Marché sélectionné</Text>
            <Text style={styles.marketValue}>Grand Marché Dantokpa</Text>
            <Text style={styles.marketMeta}>Secteur vivres frais & épices · 12 coursiers dispo</Text>
          </View>
          <MaterialIcons name="expand-more" size={20} color={colors.onSurfaceVariant} />
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Panier de courses ({ITEMS.length})</Text>
          <Text style={styles.estimateText}>Est. totale : ~{total.toLocaleString("fr-FR")} FCFA</Text>
        </View>

        <View style={{ gap: spacing.sm }}>
          {ITEMS.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <MaterialIcons name="check-circle" size={18} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.itemLabel}>{item.label}</Text>
                <Text style={styles.itemNote}>{item.note}</Text>
              </View>
              <Text style={styles.itemPrice}>~{item.price.toLocaleString("fr-FR")} F</Text>
            </View>
          ))}
        </View>

        <Pressable style={styles.addItemRow}>
          <MaterialIcons name="add-circle" size={20} color={colors.primary} />
          <Text style={styles.addItemText}>Ajouter un article</Text>
          <View style={{ flex: 1 }} />
          <MaterialIcons name="mic" size={20} color={colors.onSurfaceVariant} />
          <Text style={styles.voiceNoteText}>Note vocale (Fon / Fr)</Text>
        </Pressable>

        <View style={styles.escrowBanner}>
          <MaterialIcons name="gavel" size={20} color={colors.tertiary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.escrowTitle}>Séquestre garanti AZƆ̀</Text>
            <Text style={styles.escrowText}>
              Votre argent est bloqué et n'est débité qu'après validation de votre commande.
            </Text>
          </View>
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <PrimaryButton
            label={`Envoyer le coursier (${total.toLocaleString("fr-FR")} F)`}
            icon="shopping-cart"
            onPress={handleConfirm}
            loading={loading}
          />
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
  banner: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  bannerTitle: { ...typography.labelLg, color: colors.onPrimary, fontWeight: "700" },
  bannerSubtitle: { ...typography.bodySm, color: "rgba(255,255,255,0.85)", marginTop: 2 },
  marketCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceContainerLow, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  marketIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.surfaceContainer, alignItems: "center", justifyContent: "center" },
  marketLabel: { ...typography.labelSm, color: colors.outline, textTransform: "uppercase" },
  marketValue: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
  marketMeta: { ...typography.bodySm, color: colors.onSurfaceVariant },
  sectionHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  sectionTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "700" },
  estimateText: { ...typography.labelMd, color: colors.primary, fontWeight: "700" },
  itemRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.md, padding: spacing.sm },
  itemLabel: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  itemNote: { ...typography.bodySm, color: colors.onSurfaceVariant },
  itemPrice: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  addItemRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm, marginBottom: spacing.md },
  addItemText: { ...typography.labelMd, color: colors.primary, fontWeight: "700" },
  voiceNoteText: { ...typography.labelSm, color: colors.onSurfaceVariant },
  escrowBanner: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.tertiaryFixed, borderRadius: radius.lg, padding: spacing.md },
  escrowTitle: { ...typography.labelLg, color: colors.onTertiaryFixed, fontWeight: "700" },
  escrowText: { ...typography.bodySm, color: colors.onTertiaryFixed, marginTop: 2 },
});
