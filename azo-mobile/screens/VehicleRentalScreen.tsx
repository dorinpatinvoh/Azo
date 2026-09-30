import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { rentalApi } from "../services/api";

const FORMULAS = ["À la journée (8h-18h)", "Forfait 4 heures", "Longue durée (Semaine)"];

const VEHICLES = [
  {
    id: "corolla",
    name: "Toyota Corolla Prestige",
    category: "Berline citadine & confort d'affaires",
    rating: 4.9,
    seats: 4,
    luggage: 3,
    gearbox: "Boîte auto",
    price: 28000,
    oldPrice: 32000,
    icon: "directions-car" as const,
  },
  {
    id: "tucson",
    name: "Hyundai Tucson SUV Confort",
    category: "Confort surélevé, routes interurbaines",
    rating: 4.95,
    seats: 5,
    luggage: 4,
    gearbox: "4x4 disponible",
    price: 35000,
    icon: "directions-car" as const,
  },
];

type Props = { onBack: () => void; onReserve: (vehicleId: string) => void };

export default function VehicleRentalScreen({ onBack, onReserve }: Props) {
  const [formula, setFormula] = useState(0);

  // Enregistre la réservation dans la base de données
  async function handleReserve(v: (typeof VEHICLES)[number]) {
    try {
      await rentalApi.book({ vehicleModel: v.name, formula: FORMULAS[formula], pricePerDay: v.price });
      Alert.alert("Réservation enregistrée", `${v.name}\n${FORMULAS[formula]}`, [
        { text: "OK", onPress: () => onReserve(v.id) },
      ]);
    } catch (e: any) {
      Alert.alert("Erreur", e.message);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.iconButton}>
          <MaterialIcons name="arrow-back-ios-new" size={18} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Location de véhicules</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.heroBanner}>
          <Text style={styles.heroTitle}>AZƆ̀ Prestige & Loc</Text>
          <Text style={styles.heroSubtitle}>Flotte premium à Cotonou — 18 véhicules dispo</Text>
          <Text style={styles.heroNote}>
            Mise à disposition VIP pour trajets urbains, voyages régionaux ou cérémonies.
          </Text>
          <View style={styles.heroBadge}>
            <MaterialIcons name="verified" size={16} color={colors.onPrimary} />
            <Text style={styles.heroBadgeText}>Chauffeur certifié AZƆ̀ inclus</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Formule de location</Text>
        <View style={styles.formulaRow}>
          {FORMULAS.map((f, i) => (
            <Pressable
              key={f}
              style={[styles.formulaChip, formula === i && styles.formulaChipActive]}
              onPress={() => setFormula(i)}
            >
              <Text style={[styles.formulaText, formula === i && { color: colors.onPrimary }]}>{f}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Véhicules disponibles</Text>
        <View style={{ gap: spacing.sm }}>
          {VEHICLES.map((v) => (
            <View key={v.id} style={styles.vehicleCard}>
              <View style={styles.vehicleTop}>
                <View style={styles.vehicleIcon}>
                  <MaterialIcons name={v.icon} size={26} color={colors.onSurfaceVariant} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.vehicleName}>{v.name}</Text>
                  <Text style={styles.vehicleCategory}>{v.category}</Text>
                </View>
              </View>

              <View style={styles.specsRow}>
                <Spec icon="star" text={`${v.rating}`} />
                <Spec icon="group" text={`${v.seats} passagers`} />
                <Spec icon="luggage" text={`${v.luggage} valises`} />
                <Spec icon="settings" text={v.gearbox} />
              </View>

              <View style={styles.priceRow}>
                <View>
                  <Text style={styles.price}>{v.price.toLocaleString("fr-FR")} FCFA / jour</Text>
                  {v.oldPrice && (
                    <Text style={styles.oldPrice}>{v.oldPrice.toLocaleString("fr-FR")} FCFA</Text>
                  )}
                </View>
                <Pressable style={styles.reserveBtn} onPress={() => handleReserve(v)}>
                  <Text style={styles.reserveText}>Réserver</Text>
                  <MaterialIcons name="arrow-forward" size={16} color={colors.onPrimary} />
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Spec({ icon, text }: { icon: keyof typeof MaterialIcons.glyphMap; text: string }) {
  return (
    <View style={styles.spec}>
      <MaterialIcons name={icon} size={14} color={colors.onSurfaceVariant} />
      <Text style={styles.specText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { height: 56, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  iconButton: { width: 40, height: 40, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...typography.headlineSm, color: colors.onSurface },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  heroBanner: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  heroTitle: { ...typography.headlineMd, color: colors.onPrimary, fontWeight: "800" },
  heroSubtitle: { ...typography.labelMd, color: "rgba(255,255,255,0.9)", marginTop: 2 },
  heroNote: { ...typography.bodySm, color: "rgba(255,255,255,0.8)", marginTop: spacing.xs },
  heroBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.15)", alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.full, marginTop: spacing.sm },
  heroBadgeText: { ...typography.labelSm, color: colors.onPrimary, fontWeight: "700" },
  sectionTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "700", marginBottom: spacing.sm },
  formulaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: spacing.md },
  formulaChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.full, backgroundColor: colors.surfaceContainerLow },
  formulaChipActive: { backgroundColor: colors.primary },
  formulaText: { ...typography.labelSm, color: colors.onSurfaceVariant, fontWeight: "600" },
  vehicleCard: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.md, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 6, elevation: 1 },
  vehicleTop: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  vehicleIcon: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.surfaceContainer, alignItems: "center", justifyContent: "center" },
  vehicleName: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
  vehicleCategory: { ...typography.bodySm, color: colors.onSurfaceVariant, marginTop: 2 },
  specsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  spec: { flexDirection: "row", alignItems: "center", gap: 4 },
  specText: { ...typography.labelSm, color: colors.onSurfaceVariant },
  priceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.sm },
  price: { ...typography.labelLg, color: colors.onSurface, fontWeight: "800" },
  oldPrice: { ...typography.labelSm, color: colors.outline, textDecorationLine: "line-through" },
  reserveBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.md },
  reserveText: { ...typography.labelMd, color: colors.onPrimary, fontWeight: "700" },
});
