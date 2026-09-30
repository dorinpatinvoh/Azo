import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";

const INDICATORS = [
  { icon: "group" as const, value: "12 698", label: "Utilisateurs", delta: "+3%" },
  { icon: "local-taxi" as const, value: "8 743", label: "Courses/missions", delta: "+8%" },
  { icon: "receipt-long" as const, value: "3 568 000 F", label: "Revenus AZƆ̀", delta: "+12%" },
  { icon: "flag" as const, value: "6", label: "Signalements", delta: "À traiter" },
];

const MANAGEMENT = [
  { icon: "group" as const, label: "Utilisateurs" },
  { icon: "apartment" as const, label: "Agences" },
  { icon: "badge" as const, label: "Professionnels" },
  { icon: "payments" as const, label: "Transactions" },
  { icon: "percent" as const, label: "Commissions" },
  { icon: "tune" as const, label: "Services" },
  { icon: "flag" as const, label: "Signalements" },
  { icon: "settings" as const, label: "Paramètres" },
];

type Props = { onBack: () => void };

export default function AdminDashboardScreen({ onBack }: Props) {
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.iconButton}>
          <MaterialIcons name="arrow-back-ios-new" size={18} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Tableau de bord administrateur</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.statsGrid}>
          {INDICATORS.map((s) => (
            <View key={s.label} style={styles.statCard}>
              <MaterialIcons name={s.icon} size={20} color={colors.primary} />
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
              <Text style={styles.statDelta}>{s.delta}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Évolution de l'activité</Text>
        <View style={styles.chartPlaceholder}>
          <MaterialIcons name="show-chart" size={20} color={colors.onSurfaceVariant} />
          <Text style={styles.chartPlaceholderText}>Graphique transactions — à brancher sur l'API</Text>
        </View>

        <Text style={styles.sectionTitle}>Gestion</Text>
        <View style={styles.managementGrid}>
          {MANAGEMENT.map((m) => (
            <Pressable key={m.label} style={styles.managementTile}>
              <View style={styles.managementIcon}>
                <MaterialIcons name={m.icon} size={22} color={colors.onSurfaceVariant} />
              </View>
              <Text style={styles.managementLabel}>{m.label}</Text>
            </Pressable>
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
  headerTitle: { ...typography.headlineSm, color: colors.onSurface, flex: 1, textAlign: "center" },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.lg },
  statCard: { width: "47%", backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.sm, gap: 2, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  statValue: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  statLabel: { ...typography.labelSm, color: colors.onSurfaceVariant },
  statDelta: { ...typography.labelSm, color: colors.primary, fontWeight: "700" },
  sectionTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "700", marginBottom: spacing.sm },
  chartPlaceholder: { height: 120, borderRadius: radius.lg, backgroundColor: colors.surfaceContainerLow, alignItems: "center", justifyContent: "center", gap: 6, marginBottom: spacing.lg },
  chartPlaceholderText: { ...typography.bodySm, color: colors.onSurfaceVariant },
  managementGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  managementTile: { width: "30%", alignItems: "center", gap: 6, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, paddingVertical: spacing.sm },
  managementIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.surfaceContainer, alignItems: "center", justifyContent: "center" },
  managementLabel: { ...typography.labelSm, color: colors.onSurface, textAlign: "center" },
});
