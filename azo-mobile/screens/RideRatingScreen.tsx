import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Alert, TextInput, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import PrimaryButton from "../components/PrimaryButton";
import { Ride, errorCode, errorMessage, isRouteMissing, ridesApi } from "../services/api";
import { tipSettings } from "../config/tips";
import { useI18n, type MessageKey } from "../i18n";
import { VEHICLE_LABEL } from "../utils/rideDisplay";
import { maskPersonName } from "../utils/phone";

const COMPLIMENTS: { id: string; labelKey: MessageKey; icon: "sanitizer" | "two-wheeler" | "sentiment-satisfied" | "alt-route" }[] = [
  { id: "clean", labelKey: "rate.c.clean", icon: "sanitizer" },
  { id: "smooth", labelKey: "rate.c.smooth", icon: "two-wheeler" },
  { id: "polite", labelKey: "rate.c.polite", icon: "sentiment-satisfied" },
  { id: "route", labelKey: "rate.c.route", icon: "alt-route" },
];

type Props = { onDone: () => void; rideId?: string };

export default function RideRatingScreen({ onDone, rideId }: Props) {
  const { t, locale } = useI18n();
  // Chauffeur et véhicule réels de la course (plus de fiche écrite en dur)
  const [ride, setRide] = useState<Ride | null>(null);
  useEffect(() => {
    if (!rideId) return;
    ridesApi.get(rideId).then(setRide).catch(() => undefined);
  }, [rideId]);
  const driverName = ride?.driver?.fullName ? maskPersonName(ride.driver.fullName, t("rate.driverDefault")) : null;
  const [stars, setStars] = useState(4);
  const [selectedCompliments, setSelectedCompliments] = useState<string[]>(["clean", "smooth"]);

  // Pourboire : 100 % reversé au Spider, débité du portefeuille AZƆ̀ Pay (POST /rides/:id/tip)
  const tips = tipSettings();
  const [tipPreset, setTipPreset] = useState<number | null>(null);
  const [tipCustom, setTipCustom] = useState("");
  const [tipSending, setTipSending] = useState(false);
  const [tipSent, setTipSent] = useState<number | null>(null);
  const [tipError, setTipError] = useState<string | null>(null);
  const tipKey = useRef<{ amount: number; key: string } | null>(null);
  const customAmount = parseInt(tipCustom.replace(/\D/g, ""), 10);
  const tipAmount = tipCustom.trim() ? (Number.isFinite(customAmount) ? customAmount : 0) : tipPreset ?? 0;
  const tipValid = tipAmount >= tips.min && tipAmount <= tips.max;
  const money = (n: number) => `${n.toLocaleString(locale)} F`;
  // Le serveur annonce la date limite (tipUntil) et le pourboire déjà envoyé ; sans lui, on propose quand même
  const tipExpired = !!ride?.tipUntil && Date.parse(ride.tipUntil) < Date.now();
  const alreadyTipped = tipSent ?? ride?.tip?.amount ?? null;
  const canTip = !!rideId && !!ride?.driver && !tipExpired;

  async function sendTip() {
    if (!rideId || !tipValid || tipSending) return;
    setTipSending(true);
    setTipError(null);
    // Même clé tant que le montant ne change pas : un renvoi après coupure ne débite pas deux fois
    if (!tipKey.current || tipKey.current.amount !== tipAmount) {
      tipKey.current = { amount: tipAmount, key: `${rideId}-${tipAmount}-${Date.now()}` };
    }
    try {
      await ridesApi.tip(rideId, tipAmount, tipKey.current.key);
      setTipSent(tipAmount);
    } catch (e) {
      const code = errorCode(e);
      if (code === "TIP_ALREADY_SENT") setTipSent(ride?.tip?.amount ?? tipAmount);
      else if (isRouteMissing(e)) setTipError(t("tip.unavailable"));
      else if (code === "WALLET_INSUFFICIENT") setTipError(t("tip.lowBalance"));
      else setTipError(errorMessage(e));
    } finally {
      setTipSending(false);
    }
  }

  // Envoie la note au backend (si on vient d'une vraie course)
  async function handleSend() {
    try {
      if (rideId) await ridesApi.rate(rideId, stars);
      onDone();
    } catch (e: any) {
      Alert.alert(t("common.error"), e.message);
    }
  }

  function toggleCompliment(id: string) {
    setSelectedCompliments((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.successBlock}>
          <View style={styles.successIcon}>
            <MaterialIcons name="check-circle" size={36} color={colors.primary} />
          </View>
          <Text style={styles.successText}>{t("rate.success")}</Text>
        </View>

        {driverName && (
          <View style={styles.driverCard}>
            <View style={styles.driverAvatar}>
              <MaterialIcons name="person" size={26} color={colors.onSurfaceVariant} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.driverName}>{driverName}</Text>
              {ride && <Text style={styles.plate}>{VEHICLE_LABEL[ride.vehicleType]}</Text>}
            </View>
          </View>
        )}

        <Text style={styles.question}>{t("rate.question")}</Text>
        <View style={styles.starsRow}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Pressable key={i} onPress={() => setStars(i)}>
              <MaterialIcons
                name="star"
                size={36}
                color={i <= stars ? colors.tertiaryFixedDim : colors.surfaceContainer}
              />
            </Pressable>
          ))}
        </View>
        <Text style={styles.starsLabel}>{t("rate.stars", { n: stars })}</Text>

        <Text style={styles.sectionLabel}>
          {driverName ? t("rate.compliments", { name: driverName }) : t("rate.complimentsDriver")}
        </Text>
        <View style={styles.complimentGrid}>
          {COMPLIMENTS.map((c) => {
            const active = selectedCompliments.includes(c.id);
            return (
              <Pressable
                key={c.id}
                style={[styles.complimentChip, active && styles.complimentChipActive]}
                onPress={() => toggleCompliment(c.id)}
              >
                <MaterialIcons name={c.icon} size={16} color={active ? colors.onPrimary : colors.onSurfaceVariant} />
                <Text style={[styles.complimentText, active && { color: colors.onPrimary }]}>{t(c.labelKey)}</Text>
              </Pressable>
            );
          })}
        </View>

        {canTip && (
          <>
            <Text style={styles.sectionLabel}>{t("tip.title")}</Text>
            {alreadyTipped !== null ? (
              <View style={styles.tipDone}>
                <MaterialIcons name="favorite" size={18} color={colors.primary} />
                <Text style={styles.tipDoneText}>{t("tip.sent", { amount: money(alreadyTipped) })}</Text>
              </View>
            ) : (
              <>
                <View style={styles.tipRow}>
                  {tips.presets.map((amount) => {
                    const active = !tipCustom.trim() && tipPreset === amount;
                    return (
                      <Pressable
                        key={amount}
                        style={[styles.tipChip, active && styles.tipChipActive]}
                        onPress={() => { setTipPreset(active ? null : amount); setTipCustom(""); setTipError(null); }}
                        accessibilityRole="button"
                      >
                        <Text style={[styles.tipText, active && { color: colors.onPrimary }]}>{money(amount)}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <TextInput
                  style={styles.tipInput}
                  value={tipCustom}
                  onChangeText={(v) => { setTipCustom(v.replace(/\D/g, "").slice(0, 6)); setTipError(null); }}
                  placeholder={t("tip.otherPlaceholder")}
                  placeholderTextColor={colors.outline}
                  keyboardType="number-pad"
                  accessibilityLabel={t("tip.other")}
                />
                {tipCustom.trim().length > 0 && !tipValid && (
                  <Text style={styles.tipError}>{t("tip.invalid", { min: tips.min, max: tips.max.toLocaleString(locale) })}</Text>
                )}
                {!!tipError && <Text style={styles.tipError}>{tipError}</Text>}
                <Pressable
                  style={[styles.tipSend, (!tipValid || tipSending) && { opacity: 0.5 }]}
                  onPress={sendTip}
                  disabled={!tipValid || tipSending}
                  accessibilityRole="button"
                >
                  {tipSending ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.tipSendText}>{t("tip.send", { amount: tipValid ? money(tipAmount) : "—" })}</Text>
                  )}
                </Pressable>
              </>
            )}
          </>
        )}

        <View style={{ marginTop: spacing.lg }}>
          <PrimaryButton label={t("rate.send")} icon="check" onPress={handleSend} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  tipInput: { height: 46, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.outlineVariant, backgroundColor: colors.surfaceContainerLowest, paddingHorizontal: spacing.md, marginTop: spacing.sm, ...typography.bodyLg, color: colors.onSurface },
  tipError: { ...typography.bodySm, color: colors.error, marginTop: spacing.xs },
  tipSend: { height: 48, borderRadius: radius.full, backgroundColor: colors.secondaryContainer, alignItems: "center", justifyContent: "center", marginTop: spacing.sm },
  tipSendText: { ...typography.labelLg, color: colors.onSecondaryFixed, fontWeight: "800" },
  tipDone: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.primaryFixed, borderRadius: radius.lg, padding: spacing.md },
  tipDoneText: { ...typography.labelLg, color: colors.primary, fontWeight: "700", flex: 1 },
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  successBlock: { alignItems: "center", marginBottom: spacing.md },
  successIcon: { width: 64, height: 64, borderRadius: radius.full, backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm },
  tripId: { ...typography.labelSm, color: colors.outline },
  successText: { ...typography.headlineMd, color: colors.onSurface, fontWeight: "700", marginTop: 2 },
  arrivalText: { ...typography.bodySm, color: colors.onSurfaceVariant, marginTop: 2 },
  driverCard: { flexDirection: "row", gap: spacing.sm, alignItems: "center", backgroundColor: colors.surfaceContainerLow, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  driverAvatar: { width: 48, height: 48, borderRadius: radius.full, backgroundColor: colors.surfaceContainer, alignItems: "center", justifyContent: "center" },
  driverName: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  driverRating: { ...typography.labelSm, color: colors.onSurfaceVariant },
  plate: { ...typography.bodySm, color: colors.onSurfaceVariant, marginTop: 2 },
  question: { ...typography.headlineSm, color: colors.onSurface, textAlign: "center", marginBottom: spacing.sm },
  starsRow: { flexDirection: "row", justifyContent: "center", gap: 6 },
  starsLabel: { ...typography.labelMd, color: colors.onSurfaceVariant, textAlign: "center", marginTop: 4, marginBottom: spacing.md },
  sectionLabel: { ...typography.labelMd, color: colors.onSurfaceVariant, marginBottom: spacing.xs, marginTop: spacing.sm },
  complimentGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  complimentChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.full, backgroundColor: colors.surfaceContainerLow },
  complimentChipActive: { backgroundColor: colors.primary },
  complimentText: { ...typography.labelSm, color: colors.onSurfaceVariant },
  tipRow: { flexDirection: "row", gap: 8 },
  tipChip: { flex: 1, paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.surfaceContainerLow, alignItems: "center" },
  tipChipActive: { backgroundColor: colors.secondary },
  tipText: { ...typography.labelMd, color: colors.onSurfaceVariant, fontWeight: "700" },
});
