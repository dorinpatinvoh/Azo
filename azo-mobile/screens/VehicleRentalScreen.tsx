import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { RentalFormula, RentalVehicle, errorMessage, rentalApi } from "../services/api";
import { useI18n } from "../i18n";
import { BrandAlert } from "../components/BrandAlert";

const FORMULA_ORDER: RentalFormula[] = ["4h", "day", "week"];

type Props = { onBack: () => void; onReserve: (vehicleId: string) => void };

/** Location : le catalogue et les prix viennent du serveur (jamais codés ici ni envoyés par l'application). */
export default function VehicleRentalScreen({ onBack, onReserve }: Props) {
  const { t, locale } = useI18n();
  const [vehicles, setVehicles] = useState<RentalVehicle[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [formula, setFormula] = useState<RentalFormula>("day");
  const [days, setDays] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setVehicles(await rentalApi.catalog());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const money = (n: number) => n.toLocaleString(locale);
  const priceFor = (v: RentalVehicle) => {
    const f = v.formulas.find((x) => x.id === formula);
    if (!f) return null;
    return formula === "day" ? f.price * days : f.price;
  };

  async function handleReserve(v: RentalVehicle) {
    setBusyId(v.id);
    try {
      const booking = await rentalApi.book({ vehicleId: v.id, formula, ...(formula === "day" ? { days } : {}) });
      BrandAlert.alert(
        t("rent.booked"),
        t("rent.bookedBody", { name: v.name, formula: t(`rent.f.${formula}` as const), price: money(booking.totalPrice ?? priceFor(v) ?? 0) }),
        [{ text: "OK", onPress: () => onReserve(v.id) }]
      );
    } catch (e) {
      BrandAlert.alert(t("common.error"), errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.iconButton} accessibilityLabel={t("common.back")}>
          <MaterialIcons name="arrow-back-ios-new" size={18} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>{t("rent.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.heroBanner}>
          <Text style={styles.heroTitle}>{t("rent.heroTitle")}</Text>
          <Text style={styles.heroSubtitle}>{t("rent.heroSub")}</Text>
          <Text style={styles.heroNote}>{t("rent.heroNote")}</Text>
        </View>

        <Text style={styles.sectionTitle}>{t("rent.formula")}</Text>
        <View style={styles.formulaRow}>
          {FORMULA_ORDER.map((f) => (
            <Pressable key={f} style={[styles.formulaChip, formula === f && styles.formulaChipActive]} onPress={() => setFormula(f)}>
              <Text style={[styles.formulaText, formula === f && { color: colors.onPrimary }]}>{t(`rent.f.${f}` as const)}</Text>
            </Pressable>
          ))}
        </View>
        {formula === "day" && (
          <View style={styles.formulaRow}>
            <Text style={styles.vehicleCategory}>{t("rent.days")}</Text>
            <Pressable style={styles.formulaChip} onPress={() => setDays((d) => Math.max(1, d - 1))}>
              <Text style={styles.formulaText}>−</Text>
            </Pressable>
            <Text style={styles.sectionTitle}>{days}</Text>
            <Pressable style={styles.formulaChip} onPress={() => setDays((d) => Math.min(30, d + 1))}>
              <Text style={styles.formulaText}>+</Text>
            </Pressable>
          </View>
        )}

        <Text style={styles.sectionTitle}>{t("rent.vehicles")}</Text>
        {vehicles === null && !failed ? <ActivityIndicator color={colors.primary} /> : null}
        {failed ? (
          <Pressable onPress={load}>
            <Text style={styles.vehicleCategory}>{t("rent.loadError")} {t("common.retry")}</Text>
          </Pressable>
        ) : null}
        {vehicles && vehicles.length === 0 ? <Text style={styles.vehicleCategory}>{t("rent.empty")}</Text> : null}
        <View style={{ gap: spacing.sm }}>
          {(vehicles ?? []).map((v) => {
            const price = priceFor(v);
            return (
              <View key={v.id} style={styles.vehicleCard}>
                <View style={styles.vehicleTop}>
                  <View style={styles.vehicleIcon}>
                    <MaterialIcons name="directions-car" size={26} color={colors.onSurfaceVariant} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.vehicleName}>{v.name}</Text>
                    <Text style={styles.vehicleCategory}>{t("rent.seats", { n: v.seats })}</Text>
                  </View>
                </View>

                <View style={styles.priceRow}>
                  <View>
                    <Text style={styles.price}>{price === null ? t("rent.unavailable") : t("rent.total", { price: money(price) })}</Text>
                  </View>
                  <Pressable
                    style={[styles.reserveBtn, (price === null || busyId === v.id) && { opacity: 0.5 }]}
                    disabled={price === null || busyId === v.id}
                    onPress={() => handleReserve(v)}
                  >
                    <Text style={styles.reserveText}>{t("rent.reserve")}</Text>
                    <MaterialIcons name="arrow-forward" size={16} color={colors.onPrimary} />
                  </Pressable>
                </View>
              </View>
            );
          })}
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
