import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { ReferrerSpace, errorMessage, referralsApi } from "../services/api";
import ReferralOverview from "../components/ReferralOverview";
import { BrandAlert } from "../components/BrandAlert";

type Props = { onLogout: () => void };

/**
 * Espace du parrain (compte créé par l'administrateur) : son code de parrainage, le nombre de Speeders, d'agences,
 * de livreurs express et de coursiers personnels qu'il a parrainés, ceux qui sont actifs ou inactifs, ceux qui ont rechargé
 * leur compte, et la fiche de chacun. Les numéros de téléphone des filleuls sont partiellement masqués.
 */
export default function ReferrerHomeScreen({ onLogout }: Props) {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<ReferrerSpace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await referralsApi.me());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
    const timer = setInterval(() => load().catch(() => undefined), 30000);
    return () => clearInterval(timer);
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function share() {
    if (!data) return;
    Share.share({
      message: `Rejoins AZƆ̀ ! Pour t'inscrire comme Speeder, coursier, livreur ou agence, saisis mon code de parrainage à l'inscription : ${data.referrer.code}`,
    }).catch(() => undefined);
  }

  function confirmLogout() {
    BrandAlert.alert("Déconnexion", "Veux-tu vraiment te déconnecter ?", [
      { text: "Non", style: "cancel" },
      { text: "Me déconnecter", style: "destructive", onPress: onLogout },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={[styles.appBar, { paddingTop: insets.top + spacing.sm }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Espace parrain</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {data?.referrer.fullName ? `Bonjour, ${data.referrer.fullName}` : "Suivi de tes filleuls"}
          </Text>
        </View>
        <Pressable style={styles.logout} onPress={confirmLogout} accessibilityRole="button" accessibilityLabel="Se déconnecter">
          <MaterialIcons name="logout" size={20} color={colors.primary} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          showsVerticalScrollIndicator={false}
        >
          {error ? (
            <View style={styles.errorBox}>
              <MaterialIcons name="error-outline" size={20} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {data ? (
            <>
              <View style={styles.codeCard}>
                <Text style={styles.codeLabel}>Ton code de parrainage</Text>
                <Text style={styles.code} selectable>{data.referrer.code}</Text>
                <Text style={styles.codeHint}>Chaque Speeder, agence, livreur ou coursier saisit ce code à son inscription pour être rattaché à toi.</Text>
                <Pressable style={styles.shareBtn} onPress={share} accessibilityRole="button">
                  <MaterialIcons name="share" size={18} color={colors.primary} />
                  <Text style={styles.shareText}>Partager mon code</Text>
                </Pressable>
              </View>
              <ReferralOverview data={data} />
            </>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  appBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: `${colors.primaryFixed}99`,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  title: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  subtitle: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  logout: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surfaceContainerLowest, alignItems: "center", justifyContent: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
  errorBox: { flexDirection: "row", gap: spacing.sm, alignItems: "center", backgroundColor: colors.errorContainer, borderRadius: radius.lg, padding: spacing.sm + 2 },
  errorText: { ...typography.bodyMd, color: colors.error, flex: 1 },
  codeCard: { backgroundColor: colors.primary, borderRadius: radius.xl, padding: spacing.md, gap: 4 },
  codeLabel: { ...typography.labelMd, color: "rgba(255,255,255,0.85)", textTransform: "uppercase", letterSpacing: 0.5 },
  code: { ...typography.displayLgMobile, color: "#fff", fontWeight: "800", letterSpacing: 2 },
  codeHint: { ...typography.bodySm, color: "rgba(255,255,255,0.9)" },
  shareBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 44, borderRadius: radius.full, backgroundColor: "#fff", marginTop: spacing.xs },
  shareText: { ...typography.labelLg, color: colors.primary, fontWeight: "800" },
});
