import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { DriverEarnings, ridesApi } from "../services/api";
import { useI18n } from "../i18n";

type Period = "day" | "week" | "month";

/** Gains nets du chauffeur sur le jour, 7 jours ou 30 jours, avec un histogramme par jour. Données réelles du serveur. */
export default function EarningsCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const { t, locale } = useI18n();
  const [period, setPeriod] = useState<Period>("week");
  const [data, setData] = useState<DriverEarnings | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setData(await ridesApi.earnings(period));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load, refreshKey]);

  const money = (n: number) => `${n.toLocaleString(locale)} F`;
  const dayLabel = (date: string) => {
    const d = new Date(`${date}T12:00:00Z`);
    return period === "month" ? String(d.getUTCDate()) : d.toLocaleDateString(locale, { weekday: "narrow", timeZone: "UTC" });
  };
  const max = Math.max(1, ...(data?.days.map((d) => d.net) ?? [1]));

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>{t("earn.title")}</Text>
        <View style={styles.tabs}>
          {(["day", "week", "month"] as const).map((p) => (
            <Pressable key={p} onPress={() => setPeriod(p)} style={[styles.tab, period === p && styles.tabActive]}>
              <Text style={[styles.tabText, period === p && styles.tabTextActive]}>{t(`earn.${p}` as const)}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {loading && !data ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
      ) : failed && !data ? (
        <Text style={styles.muted}>{t("earn.error")}</Text>
      ) : data ? (
        <>
          <Text style={styles.label}>{t("earn.net")}</Text>
          <Text style={styles.value}>{money(data.totals.net)}</Text>
          <Text style={styles.muted}>
            {t("earn.rides", { n: data.totals.rides })} · {t("earn.commission", { amount: money(data.totals.commission) })}
          </Text>

          {data.totals.rides === 0 ? (
            <Text style={[styles.muted, { marginTop: spacing.sm }]}>{t("earn.empty")}</Text>
          ) : (
            <>
              {data.period !== "day" && (
                <View style={styles.bars}>
                  {data.days.map((d) => (
                    <View key={d.date} style={styles.barCol}>
                      <View style={[styles.bar, { height: Math.max(3, Math.round((d.net / max) * 56)), opacity: d.net > 0 ? 1 : 0.25 }]} />
                      {data.period === "week" || new Date(`${d.date}T12:00:00Z`).getUTCDate() % 5 === 0 ? (
                        <Text style={styles.barLabel}>{dayLabel(d.date)}</Text>
                      ) : (
                        <Text style={styles.barLabel}> </Text>
                      )}
                    </View>
                  ))}
                </View>
              )}
              {data.period !== "day" && (
                <Text style={styles.muted}>{t("earn.avg", { amount: money(data.averagePerActiveDay) })}</Text>
              )}
              {data.bestDay && data.period !== "day" && (
                <Text style={styles.muted}>
                  {t("earn.best", {
                    date: new Date(`${data.bestDay.date}T12:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" }),
                    amount: money(data.bestDay.net),
                  })}
                </Text>
              )}
            </>
          )}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.md, gap: 4, marginVertical: spacing.xs },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xs },
  title: { ...typography.labelLg, color: colors.onSurface, fontWeight: "800" },
  tabs: { flexDirection: "row", gap: 6 },
  tab: { paddingHorizontal: 10, height: 28, borderRadius: radius.full, backgroundColor: colors.surfaceContainer, alignItems: "center", justifyContent: "center" },
  tabActive: { backgroundColor: colors.primary },
  tabText: { ...typography.labelSm, color: colors.onSurface, fontWeight: "700" },
  tabTextActive: { color: "#fff" },
  label: { ...typography.labelMd, color: colors.onSurfaceVariant },
  value: { ...typography.headlineMd, color: colors.primary, fontWeight: "800" },
  muted: { ...typography.bodySm, color: colors.onSurfaceVariant },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: 78, marginTop: spacing.sm },
  barCol: { flex: 1, alignItems: "center", justifyContent: "flex-end", gap: 2 },
  bar: { width: "100%", maxWidth: 22, borderRadius: 4, backgroundColor: colors.primary },
  barLabel: { ...typography.labelSm, fontSize: 9, color: colors.onSurfaceVariant },
});
