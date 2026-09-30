import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { ridesApi, Ride } from "../services/api";
import ClientTabBar, { ClientTab } from "../components/ClientTabBar";
import {
  fcfa, relativeDay, VEHICLE_ICON, VEHICLE_LABEL, STATUS_INFO, ACTIVE_STATUSES, DEMO_RIDES,
} from "../utils/rideDisplay";

type Filter = "ALL" | "ACTIVE" | "COMPLETED" | "CANCELLED";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "ALL", label: "Toutes" },
  { id: "ACTIVE", label: "En cours" },
  { id: "COMPLETED", label: "Terminées" },
  { id: "CANCELLED", label: "Annulées" },
];

type Props = {
  onNavigateTab: (tab: ClientTab) => void;
  onRequestRide: () => void;
  onTrackRide?: (rideId: string) => void;
};

export default function CoursesScreen({ onNavigateTab, onRequestRide, onTrackRide }: Props) {
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [filter, setFilter] = useState<Filter>("ALL");

  const load = useCallback(async () => {
    try {
      setRides(await ridesApi.history());
      setOffline(false);
    } catch {
      setRides(DEMO_RIDES);
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const filtered = useMemo(() => {
    switch (filter) {
      case "ACTIVE": return rides.filter((r) => ACTIVE_STATUSES.includes(r.status));
      case "COMPLETED": return rides.filter((r) => r.status === "COMPLETED");
      case "CANCELLED": return rides.filter((r) => r.status === "CANCELLED");
      default: return rides;
    }
  }, [rides, filter]);

  const totalSpent = useMemo(
    () => rides.filter((r) => r.status === "COMPLETED").reduce((s, r) => s + r.price, 0),
    [rides]
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Mes courses</Text>
        <Text style={styles.subtitle}>
          {rides.length} course{rides.length > 1 ? "s" : ""} · {fcfa(totalSpent)} dépensés
        </Text>
      </View>

      <View style={styles.filtersRow}>
        {FILTERS.map((f) => {
          const active = f.id === filter;
          return (
            <Pressable key={f.id} onPress={() => setFilter(f.id)} style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {offline && (
          <View style={styles.offlineBanner}>
            <MaterialIcons name="cloud-off" size={16} color={colors.tertiary} />
            <Text style={styles.offlineText}>Serveur injoignable · données de démonstration</Text>
          </View>
        )}

        {loading && <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />}

        {!loading && filtered.length === 0 && (
          <View style={styles.empty}>
            <MaterialIcons name="receipt-long" size={48} color={colors.outlineVariant} />
            <Text style={styles.emptyTitle}>Aucune course</Text>
            <Text style={styles.emptyText}>
              {filter === "ALL" ? "Vous n'avez pas encore commandé de course." : "Aucune course dans cette catégorie."}
            </Text>
            {filter === "ALL" && (
              <Pressable style={styles.emptyBtn} onPress={onRequestRide}>
                <Text style={styles.emptyBtnText}>Commander une course</Text>
              </Pressable>
            )}
          </View>
        )}

        <View style={{ gap: spacing.sm }}>
          {filtered.map((r) => {
            const st = STATUS_INFO[r.status];
            const isActive = ACTIVE_STATUSES.includes(r.status);
            return (
              <Pressable
                key={r.id}
                style={[styles.card, isActive && styles.cardActive]}
                onPress={() => isActive && onTrackRide?.(r.id)}
                disabled={!isActive}
              >
                <View style={styles.cardTop}>
                  <View style={[styles.icon, { backgroundColor: st.bg }]}>
                    <MaterialIcons name={VEHICLE_ICON[r.vehicleType]} size={22} color={st.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{VEHICLE_LABEL[r.vehicleType]}</Text>
                    <Text style={styles.cardMeta}>{relativeDay(r.createdAt)}</Text>
                  </View>
                  <Text style={styles.price}>{fcfa(r.price)}</Text>
                </View>
                <View style={styles.cardBottom}>
                  <View style={[styles.pill, { backgroundColor: st.bg }]}>
                    <Text style={[styles.pillText, { color: st.color }]}>{st.label}</Text>
                  </View>
                  {r.status === "COMPLETED" && r.rating ? (
                    <View style={styles.stars}>
                      {[1, 2, 3, 4, 5].map((i) => (
                        <MaterialIcons key={i} name={i <= r.rating! ? "star" : "star-border"} size={14} color={colors.tertiaryFixedDim} />
                      ))}
                    </View>
                  ) : isActive ? (
                    <Text style={styles.follow}>Suivre →</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <ClientTabBar active="courses" onNavigate={onNavigateTab} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  title: { ...typography.headlineLg, color: colors.onSurface, fontWeight: "800" },
  subtitle: { ...typography.bodyMd, color: colors.onSurfaceVariant, marginTop: 2 },
  filtersRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  chip: { paddingHorizontal: 14, height: 34, borderRadius: radius.full, backgroundColor: colors.surfaceContainer, alignItems: "center", justifyContent: "center" },
  chipActive: { backgroundColor: colors.primary },
  chipText: { ...typography.labelMd, color: colors.onSurfaceVariant },
  chipTextActive: { color: "#fff", fontWeight: "700" },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  offlineBanner: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.tertiaryFixed, borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 8, marginBottom: spacing.md },
  offlineText: { ...typography.labelSm, color: colors.tertiary },
  empty: { alignItems: "center", paddingVertical: spacing.xl, gap: 6 },
  emptyTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  emptyText: { ...typography.bodyMd, color: colors.onSurfaceVariant, textAlign: "center" },
  emptyBtn: { marginTop: spacing.md, backgroundColor: colors.primary, paddingHorizontal: 20, height: 44, borderRadius: radius.full, justifyContent: "center" },
  emptyBtnText: { ...typography.labelMd, color: "#fff", fontWeight: "700" },
  card: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, padding: spacing.md, gap: spacing.md, borderWidth: 1, borderColor: colors.surfaceContainer },
  cardActive: { borderWidth: 1.5, borderColor: colors.secondaryContainer },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  icon: { width: 44, height: 44, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
  cardTitle: { ...typography.labelLg, color: colors.onSurface, fontWeight: "800" },
  cardMeta: { ...typography.bodySm, color: colors.onSurfaceVariant },
  price: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  cardBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.full },
  pillText: { ...typography.labelSm },
  stars: { flexDirection: "row" },
  follow: { ...typography.labelMd, color: colors.secondary, fontWeight: "800" },
});
