import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { artisansApi } from "../services/api";

const CATEGORIES = [
  { id: "couture", label: "Couture", icon: "checkroom" as const },
  { id: "coiffure", label: "Coiffure", icon: "content-cut" as const },
  { id: "plomberie", label: "Plomberie", icon: "plumbing" as const },
  { id: "electricite", label: "Électricité", icon: "bolt" as const },
  { id: "menuiserie", label: "Menuiserie", icon: "carpenter" as const },
  { id: "reparation", label: "Réparation", icon: "build" as const },
];

const ARTISANS = [
  { id: 1, name: "Édouard Koudjo", specialty: "Plombier certifié", rating: 4.8, distance: "1,2 km", price: "À partir de 3 000 F" },
  { id: 2, name: "Fatou Lawson", specialty: "Couturière", rating: 4.9, distance: "800 m", price: "Sur devis" },
  { id: 3, name: "Blaise Houngbo", specialty: "Électricien", rating: 4.7, distance: "2,5 km", price: "À partir de 5 000 F" },
];

type Props = { onBack: () => void; onRequestArtisan: (id: number) => void };

export default function ArtisansScreen({ onBack, onRequestArtisan }: Props) {
  const [category, setCategory] = useState<string | null>(null);

  // Envoie la demande de service au backend
  async function handleRequest(id: number) {
    try {
      await artisansApi.request(category ?? "general");
      Alert.alert("Demande envoyée", "L'artisan sera notifié de ta demande.", [
        { text: "OK", onPress: () => onRequestArtisan(id) },
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
        <Text style={styles.headerTitle}>Espace Artisans</Text>
        <View style={styles.betaPill}>
          <Text style={styles.betaText}>V2</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.searchBar}>
          <MaterialIcons name="search" size={20} color={colors.onSurfaceVariant} />
          <TextInput
            placeholder="Rechercher un service ou un artisan"
            placeholderTextColor={colors.outline}
            style={styles.searchInput}
          />
        </View>

        <View style={styles.categoryGrid}>
          {CATEGORIES.map((c) => {
            const active = category === c.id;
            return (
              <Pressable
                key={c.id}
                style={[styles.categoryTile, active && styles.categoryTileActive]}
                onPress={() => setCategory(active ? null : c.id)}
              >
                <MaterialIcons name={c.icon} size={22} color={active ? colors.onPrimary : colors.onSurfaceVariant} />
                <Text style={[styles.categoryLabel, active && { color: colors.onPrimary }]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Artisans à proximité</Text>
        <View style={{ gap: spacing.sm }}>
          {ARTISANS.map((a) => (
            <View key={a.id} style={styles.artisanCard}>
              <View style={styles.artisanAvatar}>
                <MaterialIcons name="person" size={24} color={colors.onSurfaceVariant} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.artisanName}>{a.name}</Text>
                <Text style={styles.artisanSpecialty}>{a.specialty}</Text>
                <View style={styles.artisanMetaRow}>
                  <MaterialIcons name="star" size={13} color={colors.tertiaryFixedDim} />
                  <Text style={styles.artisanMeta}>{a.rating} · {a.distance} · {a.price}</Text>
                </View>
              </View>
              <Pressable style={styles.requestBtn} onPress={() => handleRequest(a.id)}>
                <Text style={styles.requestText}>Demander</Text>
              </Pressable>
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
  betaPill: { backgroundColor: colors.secondaryFixed, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full },
  betaText: { ...typography.labelSm, color: colors.onSecondaryFixed, fontWeight: "700" },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  searchBar: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.surfaceContainerLow, borderRadius: radius.full, paddingHorizontal: spacing.md, height: 46, marginBottom: spacing.md },
  searchInput: { flex: 1, ...typography.bodyMd, color: colors.onSurface },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.lg },
  categoryTile: { width: "30%", alignItems: "center", gap: 6, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, paddingVertical: spacing.sm, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  categoryTileActive: { backgroundColor: colors.primary },
  categoryLabel: { ...typography.labelSm, color: colors.onSurface, textAlign: "center" },
  sectionTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "700", marginBottom: spacing.sm },
  artisanCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.md, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  artisanAvatar: { width: 48, height: 48, borderRadius: radius.full, backgroundColor: colors.surfaceContainer, alignItems: "center", justifyContent: "center" },
  artisanName: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
  artisanSpecialty: { ...typography.bodySm, color: colors.onSurfaceVariant },
  artisanMetaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  artisanMeta: { ...typography.labelSm, color: colors.onSurfaceVariant },
  requestBtn: { backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md },
  requestText: { ...typography.labelSm, color: colors.onPrimary, fontWeight: "700" },
});
