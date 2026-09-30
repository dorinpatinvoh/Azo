import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";

const STATS = [
  { icon: "account-balance-wallet" as const, value: "4 850 000 F", label: "CA Net Flotte", delta: "+18%" },
  { icon: "sports-motorsports" as const, value: "18 / 22", label: "Chauffeurs actifs", delta: "12 en course" },
  { icon: "verified" as const, value: "1 428", label: "Courses terminées", delta: "+142 vs sem." },
  { icon: "star" as const, value: "4.91", label: "Note satisfaction", delta: "Top 5%" },
];

const DRIVERS = [
  { id: "01", name: "Sébastien D.", status: "En course" },
  { id: "02", name: "Rodrigue A.", status: "Disponible" },
  { id: "04", name: "Koffi M.", status: "En course" },
  { id: "09", name: "Aïcha B.", status: "En attente" },
];

type Props = { onBack: () => void };

export default function AgencyDashboardScreen({ onBack }: Props) {
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.iconButton}>
          <MaterialIcons name="arrow-back-ios-new" size={18} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Mon agence</Text>
        <View style={styles.b2bBadge}>
          <Text style={styles.b2bText}>PRO FLOTTE</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.agencyCard}>
          <View style={styles.agencyTop}>
            <View style={styles.agencyIcon}>
              <MaterialIcons name="verified" size={22} color={colors.onPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.agencyName}>Transports Sahel & Frères SARL</Text>
              <Text style={styles.agencyMeta}>Hub Central Cotonou Littoral • ID #FL-8820</Text>
            </View>
          </View>
          <View style={styles.rankRow}>
            <MaterialIcons name="military-tech" size={18} color={colors.tertiaryFixedDim} />
            <Text style={styles.rankText}>Palmarès Littoral — 3ᵉ / 24 agences</Text>
            <View style={styles.diamondPill}>
              <Text style={styles.diamondText}>Diamant</Text>
            </View>
          </View>
        </View>

        <View style={styles.objectiveCard}>
          <Text style={styles.objectiveLabel}>Objectif mensuel de flotte</Text>
          <Text style={styles.objectiveValue}>1 428 / 1 800 courses · 78% complété</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: "78%" }]} />
          </View>
        </View>

        <View style={styles.statsGrid}>
          {STATS.map((s) => (
            <View key={s.label} style={styles.statCard}>
              <MaterialIcons name={s.icon} size={20} color={colors.primary} />
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
              <Text style={styles.statDelta}>{s.delta}</Text>
            </View>
          ))}
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Équipe (22)</Text>
          <Text style={styles.sectionAction}>Voir tout</Text>
        </View>
        <View style={{ gap: spacing.sm }}>
          {DRIVERS.map((d) => (
            <View key={d.id} style={styles.driverRow}>
              <View style={styles.driverAvatar}>
                <Text style={styles.driverInitial}>{d.name[0]}</Text>
              </View>
              <Text style={styles.driverName}>{d.name}</Text>
              <View
                style={[
                  styles.statusPill,
                  { backgroundColor: d.status === "En course" ? colors.primaryFixed : colors.surfaceContainer },
                ]}
              >
                <Text style={styles.statusPillText}>{d.status}</Text>
              </View>
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
  b2bBadge: { backgroundColor: colors.tertiaryFixed, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full },
  b2bText: { ...typography.labelSm, color: colors.onTertiaryFixed, fontWeight: "700" },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  agencyCard: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  agencyTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  agencyIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  agencyName: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
  agencyMeta: { ...typography.bodySm, color: colors.onSurfaceVariant },
  rankRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  rankText: { ...typography.labelSm, color: colors.onSurfaceVariant, flex: 1 },
  diamondPill: { backgroundColor: colors.secondaryFixed, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full },
  diamondText: { ...typography.labelSm, color: colors.onSecondaryFixed, fontWeight: "700" },
  objectiveCard: { backgroundColor: colors.surfaceContainerLow, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  objectiveLabel: { ...typography.labelMd, color: colors.onSurfaceVariant },
  objectiveValue: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700", marginTop: 2, marginBottom: spacing.sm },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceContainerHigh, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: colors.primary },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  statCard: { width: "47%", backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.sm, gap: 2, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  statValue: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  statLabel: { ...typography.labelSm, color: colors.onSurfaceVariant },
  statDelta: { ...typography.labelSm, color: colors.primary, fontWeight: "700" },
  sectionHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  sectionTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "700" },
  sectionAction: { ...typography.labelMd, color: colors.primary, fontWeight: "700" },
  driverRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.md, padding: spacing.sm },
  driverAvatar: { width: 36, height: 36, borderRadius: radius.full, backgroundColor: colors.surfaceContainer, alignItems: "center", justifyContent: "center" },
  driverInitial: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  driverName: { ...typography.labelMd, color: colors.onSurface, flex: 1, fontWeight: "600" },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full },
  statusPillText: { ...typography.labelSm, color: colors.onSurface, fontWeight: "700" },
});
