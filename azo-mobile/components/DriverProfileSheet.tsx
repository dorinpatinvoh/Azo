import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { DriverPublicProfile, ridesApi } from "../services/api";
import { useI18n, type MessageKey } from "../i18n";
import Avatar from "./Avatar";

type Props = {
  visible: boolean;
  onClose: () => void;
  rideId: string;
  /** Nom déjà connu du Zem (affiché même si le profil détaillé n'est pas disponible). */
  name: string;
  profile?: DriverPublicProfile | null;
  /** Boutons de décision, présents tant que le client n'a pas confirmé. */
  onChoose?: () => void;
  onDecline?: () => void;
  busy?: boolean;
};

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "Z";

function Row({ icon, label, value }: { icon: keyof typeof MaterialIcons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <MaterialIcons name={icon} size={18} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
    </View>
  );
}

/**
 * Profil public du Zem, montré au client AVANT qu'il le choisisse. Le profil vient de la course
 * (`driver.profile`) ; à défaut, on le demande à `GET /rides/:id/driver-profile`. Le serveur ne
 * fournit jamais le téléphone ni les pièces d'identité : seulement ce qui rassure le client.
 */
export default function DriverProfileSheet({ visible, onClose, rideId, name, profile, onChoose, onDecline, busy }: Props) {
  const { t, locale } = useI18n();
  const [fetched, setFetched] = useState<DriverPublicProfile | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || profile) return;
    let active = true;
    setLoading(true);
    ridesApi
      .driverProfile(rideId)
      .then((value) => active && setFetched(value))
      .catch(() => undefined)
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [visible, profile, rideId]);

  const data = profile ?? fetched;
  const displayName = data?.displayName || name;
  const rating = typeof data?.rating === "number" ? data.rating.toFixed(1) : t("offer.new");
  const since = data?.memberSince
    ? new Date(data.memberSince).toLocaleDateString(locale, { month: "short", year: "numeric" })
    : "—";
  const vehicle = data?.vehicleModel
    ? data.vehicleModel
    : data?.vehicleType
      ? t(`veh.${data.vehicleType}.label` as MessageKey)
      : null;
  const place = [data?.city, ...(data?.zones ?? [])].filter(Boolean).join(" · ");

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t("common.close")} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.md }}>
            <View style={styles.header}>
              <Avatar uri={data?.photoUrl ?? null} initials={initialsOf(displayName)} size={72} fontSize={26} />
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{t("zprofile.title")}</Text>
                <Text style={styles.name} numberOfLines={2}>{displayName}</Text>
                {data?.verified && (
                  <View style={styles.verified}>
                    <MaterialIcons name="verified" size={14} color={colors.primary} />
                    <Text style={styles.verifiedText}>{t("offer.verified")}</Text>
                  </View>
                )}
              </View>
            </View>

            {loading && <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />}

            {!loading && !data && <Text style={styles.empty}>{t("zprofile.noDetails")}</Text>}

            {!!data && (
              <>
                <View style={styles.stats}>
                  <View style={styles.stat}>
                    <View style={styles.starRow}>
                      <MaterialIcons name="star" size={16} color={colors.tertiaryFixedDim} />
                      <Text style={styles.statValue}>{rating}</Text>
                    </View>
                    <Text style={styles.statLabel}>
                      {typeof data.ratingCount === "number" && data.ratingCount > 0
                        ? t("zprofile.ratingCount", { count: data.ratingCount })
                        : t("zprofile.stat.rating")}
                    </Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>{typeof data.jobsCompleted === "number" ? data.jobsCompleted : "—"}</Text>
                    <Text style={styles.statLabel}>{t("zprofile.stat.rides")}</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statValue}>{since}</Text>
                    <Text style={styles.statLabel}>{t("zprofile.stat.since")}</Text>
                  </View>
                </View>

                {typeof data.experienceYears === "number" && data.experienceYears > 0 && (
                  <Row
                    icon="workspace-premium"
                    label={t("zprofile.experience")}
                    value={t(data.experienceYears > 1 ? "zprofile.year.many" : "zprofile.year.one", { n: data.experienceYears })}
                  />
                )}
                {!!vehicle && <Row icon="two-wheeler" label={t("zprofile.vehicle")} value={vehicle} />}
                {!!data.plateMasked && <Row icon="confirmation-number" label={t("zprofile.plate")} value={data.plateMasked} />}
                {!!place && <Row icon="place" label={t("zprofile.zone")} value={place} />}
                {!!data.agencyName && <Row icon="apartment" label={t("zprofile.agencyLabel")} value={data.agencyName} />}
                {!!data.bio && (
                  <View style={styles.bio}>
                    <Text style={styles.rowLabel}>{t("zprofile.about")}</Text>
                    <Text style={styles.bioText}>{data.bio}</Text>
                  </View>
                )}
              </>
            )}
          </ScrollView>

          {onChoose && (
            <View style={styles.actions}>
              <Pressable style={[styles.choose, busy && { opacity: 0.6 }]} onPress={onChoose} disabled={busy}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.chooseText}>{t("offer.choose")}</Text>}
              </Pressable>
              {onDecline && (
                <Pressable style={styles.decline} onPress={onDecline} disabled={busy}>
                  <Text style={styles.declineText}>{t("offer.decline")}</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(20, 0, 35, 0.55)" },
  sheet: {
    maxHeight: "88%",
    backgroundColor: colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  handle: { alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: colors.outlineVariant, marginBottom: spacing.md },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.md },
  title: { ...typography.labelSm, color: colors.outline },
  name: { ...typography.headlineMd, color: colors.onSurface },
  verified: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 4, backgroundColor: colors.primaryFixed, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 3, marginTop: 4 },
  verifiedText: { ...typography.labelSm, color: colors.primary, fontWeight: "700" },
  empty: { ...typography.bodyMd, color: colors.onSurfaceVariant, marginVertical: spacing.md },
  stats: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  stat: { flex: 1, alignItems: "center", backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.surfaceContainer, paddingVertical: spacing.sm },
  starRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  statValue: { ...typography.headlineSm, color: colors.onSurface },
  statLabel: { ...typography.labelSm, color: colors.onSurfaceVariant, marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs + 2 },
  rowIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center" },
  rowLabel: { ...typography.labelSm, color: colors.onSurfaceVariant },
  rowValue: { ...typography.bodyLg, color: colors.onSurface },
  bio: { marginTop: spacing.sm, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.md },
  bioText: { ...typography.bodyMd, color: colors.onSurface, marginTop: 2 },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
  choose: { height: 52, borderRadius: radius.full, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  chooseText: { ...typography.labelLg, color: "#fff", fontWeight: "800" },
  decline: { height: 46, alignItems: "center", justifyContent: "center" },
  declineText: { ...typography.labelLg, color: colors.error, fontWeight: "700" },
});
