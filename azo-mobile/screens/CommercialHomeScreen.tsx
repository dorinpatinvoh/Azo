import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, BackHandler, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { ReferralKind, ReferrerSpace, errorMessage, referralsApi } from "../services/api";
import { formatBeninPhoneDisplay } from "../utils/phone";
import PillTabBar, { type PillTabItem } from "../components/PillTabBar";
import { ReferralList, ReferralSummary, type StatusFilter } from "../components/ReferralOverview";
import CommercialPromoCard from "../components/CommercialPromoCard";
import { BrandAlert } from "../components/BrandAlert";

type Tab = "home" | "recruits" | "link" | "profile";
const TABS: PillTabItem<Tab>[] = [
  { id: "home", label: "Accueil", icon: "home-outline", iconActive: "home" },
  { id: "recruits", label: "Recrues", icon: "people-outline", iconActive: "people" },
  { id: "link", label: "Mon lien", icon: "link-outline", iconActive: "link" },
  { id: "profile", label: "Profil", icon: "person-outline", iconActive: "person" },
];
const TITLES: Record<Tab, string> = { home: "Espace commercial", recruits: "Mes recrues", link: "Mon code et mon lien", profile: "Mon profil" };

type Props = { onLogout: () => void };

const initialsOf = (name?: string | null) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "C";

/**
 * Espace du commercial (compte créé par l'administrateur) : son code promo COM-AZO… et son lien personnel de téléchargement,
 * puis le suivi des Speeders, agences, livreurs express et coursiers personnels qu'il a recrutés (actifs, inactifs, en attente,
 * recharges). Les numéros des recrues sont partiellement masqués.
 */
export default function CommercialHomeScreen({ onLogout }: Props) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("home");
  const [data, setData] = useState<ReferrerSpace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [kind, setKind] = useState<ReferralKind | "ALL">("ALL");
  const [status, setStatus] = useState<StatusFilter>("ALL");

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

  // Le bouton retour du téléphone revient d'abord à l'accueil
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (tab !== "home") {
        setTab("home");
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [tab]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function confirmLogout() {
    BrandAlert.alert("Déconnexion", "Veux-tu vraiment te déconnecter ?", [
      { text: "Non", style: "cancel" },
      { text: "Me déconnecter", style: "destructive", onPress: onLogout },
    ]);
  }

  const firstName = data?.referrer.fullName?.split(/\s+/)[0];
  const latest = useMemo(() => (data ? { ...data, referrals: data.referrals.slice(0, 3) } : null), [data]);

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={[styles.appBar, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initialsOf(data?.referrer.fullName)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{tab === "home" && firstName ? `Bonjour, ${firstName}` : TITLES[tab]}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{tab === "home" ? "Espace commercial AZƆ̀" : "Commercial AZƆ̀"}</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
          showsVerticalScrollIndicator={false}
        >
          {error ? (
            <View style={styles.errorBox}>
              <MaterialIcons name="error-outline" size={20} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {data && tab === "home" ? (
            <>
              <CommercialPromoCard code={data.referrer.code} link={data.referrer.link} name={data.referrer.fullName} compact />
              <Text style={styles.section}>Mes recrues</Text>
              <ReferralSummary
                data={data}
                onSelectKind={(k) => {
                  setKind(k);
                  setStatus("ALL");
                  setTab("recruits");
                }}
              />
              <View style={styles.sectionRow}>
                <Text style={styles.section}>Dernières recrues</Text>
                <Pressable onPress={() => { setKind("ALL"); setStatus("ALL"); setTab("recruits"); }} accessibilityRole="button">
                  <Text style={styles.link}>Tout voir</Text>
                </Pressable>
              </View>
              {latest ? <ReferralList data={latest} kind="ALL" onKindChange={() => undefined} status="ALL" onStatusChange={() => undefined} compact /> : null}
            </>
          ) : null}

          {data && tab === "recruits" ? (
            <ReferralList data={data} kind={kind} onKindChange={setKind} status={status} onStatusChange={setStatus} />
          ) : null}

          {data && tab === "link" ? (
            <>
              <CommercialPromoCard code={data.referrer.code} link={data.referrer.link} name={data.referrer.fullName} />
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Comment ça marche</Text>
                <Step n={1} text="Partage ton lien personnel à un futur Speeder, livreur, coursier ou à une agence de flotte." />
                <Step n={2} text="Il ouvre la page de téléchargement d'AZƆ̀, télécharge l'application et s'inscrit avec son numéro." />
                <Step n={3} text="À l'inscription, il saisit ton code promo : il est alors rattaché à toi." />
                <Step n={4} text="Tu suis son dossier, son activité et ses recharges dans l'onglet Recrues." />
              </View>
            </>
          ) : null}

          {data && tab === "profile" ? (
            <>
              <View style={styles.card}>
                <Info icon="badge" label="Nom" value={data.referrer.fullName ?? "—"} />
                <Info icon="phone" label="Téléphone" value={formatBeninPhoneDisplay(data.referrer.phone)} />
                <Info icon="confirmation-number" label="Code promo" value={data.referrer.code} />
                <Info icon="event" label="Commercial depuis le" value={new Date(data.referrer.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })} />
                <Info icon="groups" label="Recrues" value={`${data.summary.totals.total} (dont ${data.summary.totals.actifs} actives)`} />
              </View>
              <Pressable style={styles.logout} onPress={confirmLogout} accessibilityRole="button">
                <MaterialIcons name="logout" size={20} color={colors.error} />
                <Text style={styles.logoutText}>Se déconnecter</Text>
              </Pressable>
            </>
          ) : null}
        </ScrollView>
      )}

      <PillTabBar items={TABS} active={tab} onNavigate={setTab} />
    </SafeAreaView>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNum}><Text style={styles.stepNumText}>{n}</Text></View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

function Info({ icon, label, value }: { icon: keyof typeof MaterialIcons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.info}>
      <View style={styles.infoIcon}><MaterialIcons name={icon} size={18} color={colors.primary} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
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
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  avatarText: { ...typography.labelLg, color: "#fff", fontWeight: "800" },
  title: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  subtitle: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
  errorBox: { flexDirection: "row", gap: spacing.sm, alignItems: "center", backgroundColor: colors.errorContainer, borderRadius: radius.lg, padding: spacing.sm + 2 },
  errorText: { ...typography.bodyMd, color: colors.error, flex: 1 },
  section: { ...typography.labelLg, color: colors.onSurface, fontWeight: "800", fontSize: 17 },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  link: { ...typography.labelMd, color: colors.primary, fontWeight: "800" },
  card: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.surfaceContainer },
  cardTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  step: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  stepNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center" },
  stepNumText: { ...typography.labelMd, color: colors.primary, fontWeight: "800" },
  stepText: { ...typography.bodyMd, color: colors.onSurface, flex: 1 },
  info: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  infoIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center" },
  infoLabel: { ...typography.bodySm, color: colors.onSurfaceVariant },
  infoValue: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
  logout: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 50, borderRadius: radius.full, backgroundColor: colors.errorContainer },
  logoutText: { ...typography.labelLg, color: colors.error, fontWeight: "800" },
});
