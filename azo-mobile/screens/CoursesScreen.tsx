import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Share, View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { errorMessage, ridesApi, Ride } from "../services/api";
import { receiptText } from "../utils/receipt";
import ClientTabBar, { ClientTab } from "../components/ClientTabBar";
import BackButton from "../components/BackButton";
import { useI18n, type MessageKey } from "../i18n";
import {
  fcfa, relativeDay, VEHICLE_ICON, VEHICLE_LABEL, STATUS_INFO, ACTIVE_STATUSES, DEMO_RIDES,
} from "../utils/rideDisplay";
import { BrandAlert } from "../components/BrandAlert";

type Filter = "ALL" | "ACTIVE" | "COMPLETED" | "CANCELLED";

const FILTERS: { id: Filter; labelKey: MessageKey }[] = [
  { id: "ALL", labelKey: "courses.f.all" },
  { id: "ACTIVE", labelKey: "courses.f.active" },
  { id: "COMPLETED", labelKey: "courses.f.done" },
  { id: "CANCELLED", labelKey: "courses.f.cancelled" },
];

type Props = {
  /** Retour à la page précédente (barre d'application). */
  onBack?: () => void;
  onNavigateTab: (tab: ClientTab) => void;
  onRequestRide: () => void;
  onTrackRide?: (rideId: string) => void;
};

export default function CoursesScreen({ onBack, onNavigateTab, onRequestRide, onTrackRide }: Props) {
  const { t, locale } = useI18n();
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

  // Reçu d'une course terminée : texte prêt à partager (WhatsApp, SMS, e-mail…)
  const shareReceipt = useCallback(async (ride: Ride) => {
    try {
      const receipt = await ridesApi.receipt(ride.id);
      await Share.share({ message: receiptText(receipt, VEHICLE_LABEL[ride.vehicleType], locale) });
    } catch (e) {
      BrandAlert.alert(t("receipt.failed"), errorMessage(e));
    }
  }, [locale, t]);

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
        {onBack ? (
          <View style={{ marginBottom: spacing.xs }}>
            <BackButton onPress={onBack} />
          </View>
        ) : null}
        <Text style={styles.title}>{t("courses.title")}</Text>
        <Text style={styles.subtitle}>
          {t("courses.summary", {
            count: t(rides.length > 1 ? "courses.count.many" : "courses.count.one", { n: rides.length }),
            spent: fcfa(totalSpent),
          })}
        </Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll} contentContainerStyle={styles.filtersRow}>
        {FILTERS.map((f) => {
          const active = f.id === filter;
          return (
            <Pressable key={f.id} onPress={() => setFilter(f.id)} style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{t(f.labelKey)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{rides.filter((r) => r.status === "COMPLETED").length}</Text>
            <Text style={styles.statLabel}>Terminées</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{rides.filter((r) => ACTIVE_STATUSES.includes(r.status)).length}</Text>
            <Text style={styles.statLabel}>En cours</Text>
          </View>
          <View style={[styles.statCard, styles.statCardMain]}>
            <Text style={[styles.statValue, { color: "#fff" }]}>{fcfa(totalSpent)}</Text>
            <Text style={[styles.statLabel, { color: "rgba(255,255,255,0.85)" }]}>Dépensés</Text>
          </View>
        </View>

        {offline && (
          <View style={styles.offlineBanner}>
            <MaterialIcons name="cloud-off" size={16} color={colors.tertiary} />
            <Text style={styles.offlineText}>{t("courses.offline")}</Text>
          </View>
        )}

        {loading && <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />}

        {!loading && filtered.length === 0 && (
          <View style={styles.empty}>
            <MaterialIcons name="receipt-long" size={48} color={colors.outlineVariant} />
            <Text style={styles.emptyTitle}>{t("courses.empty.title")}</Text>
            <Text style={styles.emptyText}>
              {filter === "ALL" ? t("courses.empty.all") : t("courses.empty.cat")}
            </Text>
            {filter === "ALL" && (
              <Pressable style={styles.emptyBtn} onPress={onRequestRide}>
                <Text style={styles.emptyBtnText}>{t("courses.empty.order")}</Text>
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
                  <Text style={[styles.price, r.status === "CANCELLED" && styles.priceCancelled]}>{fcfa(r.price)}</Text>
                </View>
                {r.originLabel || r.destLabel ? (
                  <View style={styles.routeBox}>
                    <View style={styles.routeLine}>
                      <View style={[styles.routeDot, { backgroundColor: "#2e7d32" }]} />
                      <Text style={styles.routeText} numberOfLines={1}>{r.originLabel ?? "Départ"}</Text>
                    </View>
                    <View style={styles.routeLine}>
                      <View style={[styles.routeDot, { backgroundColor: "#b3261b" }]} />
                      <Text style={styles.routeText} numberOfLines={1}>{r.destLabel ?? "Destination"}</Text>
                    </View>
                  </View>
                ) : null}
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
                    <Text style={styles.follow}>{t("courses.follow")}</Text>
                  ) : null}
                  {r.status === "COMPLETED" && !offline ? (
                    <Pressable style={styles.receiptBtn} onPress={() => shareReceipt(r)} accessibilityLabel={t("receipt.button")}>
                      <MaterialIcons name="receipt-long" size={14} color={colors.primary} />
                      <Text style={styles.receiptText}>{t("receipt.button")}</Text>
                    </Pressable>
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
  receiptBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, height: 28, borderRadius: radius.full, backgroundColor: colors.primaryFixed },
  receiptText: { ...typography.labelSm, color: colors.primary, fontWeight: "700" },
  safe: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  title: { ...typography.headlineLg, color: colors.onSurface, fontWeight: "800" },
  subtitle: { ...typography.bodyMd, color: colors.onSurfaceVariant, marginTop: 2 },
  filtersScroll: { flexGrow: 0 },
  filtersRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  statsRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  statCard: { flex: 1, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, alignItems: "center", borderWidth: 1, borderColor: colors.surfaceContainer },
  statCardMain: { backgroundColor: colors.primary, borderColor: colors.primary, flex: 1.4 },
  statValue: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  statLabel: { ...typography.labelSm, color: colors.onSurfaceVariant, marginTop: 2 },
  priceCancelled: { color: colors.outline, textDecorationLine: "line-through" },
  routeBox: { gap: 6, backgroundColor: colors.surfaceContainerLow, borderRadius: radius.lg, padding: spacing.sm },
  routeLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  routeDot: { width: 9, height: 9, borderRadius: 5 },
  routeText: { ...typography.bodySm, color: colors.onSurface, flex: 1 },
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
