import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { Ride, errorMessage, ridesApi } from "../services/api";
import { maskPersonName } from "../utils/phone";
import { offerExpirySeconds } from "../config/radar";
import { useI18n } from "../i18n";
import DriverProfileSheet from "./DriverProfileSheet";

type Props = {
  ride: Ride;
  /** Course mise à jour par le serveur après la décision du client. */
  onChanged: (ride: Ride) => void;
};

/**
 * Un Spider a accepté la course (statut OFFERED) : le client voit qui c'est, ouvre son profil et décide
 * — le choisir (la course démarre) ou le refuser (la demande repart chez les autres Spider).
 * Sans réponse dans le délai, le serveur remet lui-même la demande en recherche.
 */
export default function DriverOfferCard({ ride, onChanged }: Props) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Fin du délai : celle du serveur, sinon la durée de référence à partir du premier affichage
  const fallbackEnd = useRef(Date.now() + offerExpirySeconds() * 1000);
  const endsAt = useMemo(() => {
    const iso = ride.offerExpiresAt ?? ride.offer?.expiresAt;
    const parsed = iso ? Date.parse(iso) : NaN;
    return Number.isNaN(parsed) ? fallbackEnd.current : parsed;
  }, [ride.offerExpiresAt, ride.offer?.expiresAt]);
  const secondsLeft = Math.max(0, Math.ceil((endsAt - now) / 1000));

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const driver = ride.driver;
  const profile = driver?.profile ?? null;
  const name = profile?.displayName || driver?.displayName || maskPersonName(driver?.fullName, t("live.driverDefault"));
  const rating = typeof profile?.rating === "number" ? profile.rating.toFixed(1) : t("offer.new");
  const km = ride.offer?.distanceKm;
  const eta = ride.offer?.etaMinutes;

  async function decide(action: "approve" | "decline") {
    setBusy(true);
    try {
      const next = action === "approve" ? await ridesApi.approveDriver(ride.id) : await ridesApi.declineDriver(ride.id);
      setSheetOpen(false);
      onChanged(next);
    } catch (e) {
      Alert.alert(t("offer.failed"), errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <View style={styles.avatar}>
          <MaterialIcons name="two-wheeler" size={26} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <View style={styles.meta}>
            <MaterialIcons name="star" size={14} color={colors.tertiaryFixedDim} />
            <Text style={styles.metaText}>{rating}</Text>
            {typeof profile?.jobsCompleted === "number" && (
              <Text style={styles.metaText}> · {profile.jobsCompleted} {t("zprofile.stat.rides").toLowerCase()}</Text>
            )}
          </View>
          {profile?.verified && (
            <View style={styles.verified}>
              <MaterialIcons name="verified" size={13} color={colors.primary} />
              <Text style={styles.verifiedText}>{t("offer.verified")}</Text>
            </View>
          )}
        </View>
      </View>

      {(typeof km === "number" || typeof eta === "number") && (
        <Text style={styles.distance}>
          {typeof km === "number" && typeof eta === "number"
            ? t("offer.distance", { distance: `${km.toLocaleString(undefined, { maximumFractionDigits: 1 })} km`, min: eta })
            : typeof km === "number"
              ? t("offer.distanceOnly", { distance: `${km.toLocaleString(undefined, { maximumFractionDigits: 1 })} km` })
              : t("offer.etaOnly", { min: eta as number })}
        </Text>
      )}

      <Text style={styles.intro}>{t("offer.intro")}</Text>
      <Text style={[styles.countdown, secondsLeft <= 10 && { color: colors.error }]}>{t("offer.countdown", { s: secondsLeft })}</Text>

      <Pressable style={styles.profileBtn} onPress={() => setSheetOpen(true)} accessibilityRole="button">
        <MaterialIcons name="badge" size={18} color={colors.primary} />
        <Text style={styles.profileBtnText}>{t("offer.viewProfile")}</Text>
      </Pressable>
      <Pressable style={[styles.choose, busy && { opacity: 0.6 }]} onPress={() => decide("approve")} disabled={busy} accessibilityRole="button">
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.chooseText}>{t("offer.choose")}</Text>}
      </Pressable>
      <Pressable style={styles.decline} onPress={() => decide("decline")} disabled={busy} accessibilityRole="button">
        <Text style={styles.declineText}>{t("offer.decline")}</Text>
      </Pressable>

      <DriverProfileSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        rideId={ride.id}
        name={name}
        profile={profile}
        onChoose={() => decide("approve")}
        onDecline={() => decide("decline")}
        busy={busy}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.primaryFixed, borderRadius: radius.xl, padding: spacing.md, gap: spacing.xs + 2 },
  top: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surfaceContainerLowest, alignItems: "center", justifyContent: "center" },
  name: { ...typography.headlineSm, color: colors.onSurface },
  meta: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 1 },
  metaText: { ...typography.bodySm, color: colors.onSurfaceVariant },
  verified: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  verifiedText: { ...typography.labelSm, color: colors.primary, fontWeight: "700" },
  distance: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
  intro: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  countdown: { ...typography.labelMd, color: colors.primary, fontWeight: "700" },
  profileBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 44, borderRadius: radius.full, backgroundColor: colors.surfaceContainerLowest },
  profileBtnText: { ...typography.labelLg, color: colors.primary, fontWeight: "700" },
  choose: { height: 50, borderRadius: radius.full, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  chooseText: { ...typography.labelLg, color: "#fff", fontWeight: "800" },
  decline: { height: 40, alignItems: "center", justifyContent: "center" },
  declineText: { ...typography.labelLg, color: colors.error, fontWeight: "700" },
});
