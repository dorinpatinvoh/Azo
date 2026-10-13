import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  AppState,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import ClientTabBar, { type ClientTab } from "../components/ClientTabBar";
import { userApi, walletApi } from "../services/api";
import StandingBanner from "../components/StandingBanner";
import { ridePrice } from "../services/tarification";
import { useI18n, type MessageKey } from "../i18n";

type Props = {
  clientName?: string;
  onSelectService: (serviceId: string) => void;
  onNavigateTab?: (tabId: ClientTab) => void;
};

// Services principaux mis en avant avec sous-titre d'accroche (les textes sont dans i18n/*.ts)
const MAIN_SERVICES: {
  id: string;
  labelKey: MessageKey;
  subKey: MessageKey;
  badgeKey: MessageKey;
  icon: "two-wheeler" | "directions-car";
  bg: string;
  fg: string;
}[] = [
  {
    id: "zem",
    labelKey: "home.service.zem",
    subKey: "home.service.zem.sub",
    badgeKey: "home.badge.popular",
    icon: "two-wheeler",
    bg: colors.secondaryFixed,
    fg: colors.secondary,
  },
  {
    id: "transport",
    labelKey: "home.service.car",
    subKey: "home.service.car.sub",
    badgeKey: "home.badge.secure",
    icon: "directions-car",
    bg: colors.primaryFixed,
    fg: colors.primary,
  },
];

// Grille symétrique 3 × 2 (6 services complémentaires bien alignés)
const OTHER_SERVICES: { id: string; labelKey: MessageKey; icon: keyof typeof MaterialIcons.glyphMap; bg: string; fg: string }[] = [
  { id: "livraison", labelKey: "home.other.parcel", icon: "local-shipping", bg: colors.tertiaryFixed, fg: colors.tertiary },
  { id: "coursier", labelKey: "home.other.courier", icon: "directions-run", bg: colors.secondaryFixed, fg: colors.secondary },
  { id: "location", labelKey: "home.other.rent", icon: "key", bg: colors.tertiaryFixed, fg: colors.tertiary },
  { id: "marketplace", labelKey: "home.other.shop", icon: "storefront", bg: colors.secondaryFixed, fg: colors.secondary },
  { id: "agence", labelKey: "home.other.agency", icon: "apartment", bg: colors.primaryFixed, fg: colors.primary },
  { id: "courses", labelKey: "home.other.rides", icon: "receipt-long", bg: colors.primaryFixed, fg: colors.primary },
];

// Lieux favoris de Cotonou en 1 clic
const QUICK_DESTINATIONS: { id: string; labelKey: MessageKey; icon: keyof typeof MaterialIcons.glyphMap; service: string }[] = [
  { id: "etoile", labelKey: "home.dest.etoile", icon: "place", service: "zem" },
  { id: "dantokpa", labelKey: "home.dest.dantokpa", icon: "shopping-bag", service: "zem" },
  { id: "aeroport", labelKey: "home.dest.aeroport", icon: "flight", service: "transport" },
  { id: "ganhi", labelKey: "home.dest.ganhi", icon: "business", service: "transport" },
  { id: "calavi", labelKey: "home.dest.calavi", icon: "school", service: "zem" },
];

// Économie du Zem électrique sur un trajet de référence, calculée avec le barème (jamais écrite à la main).
const PROMO_KM = 5;

export default function HomeScreen({ clientName = "", onSelectService, onNavigateTab }: Props) {
  const insets = useSafeAreaInsets();
  const { t, locale } = useI18n();
  const [name, setName] = useState(clientName);
  const [balance, setBalance] = useState<number | null>(null);
  const [loadingWallet, setLoadingWallet] = useState(true);

  // Le solde se met à jour tout seul : une recharge FedaPay est créditée par le webhook, parfois après le retour
  // dans l'application. On relit le solde au retour au premier plan et toutes les 15 s.
  useEffect(() => {
    const refresh = () => {
      walletApi.get().then((w) => setBalance(w.balance)).catch(() => undefined);
    };
    const timer = setInterval(refresh, 15000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);

  useEffect(() => {
    userApi
      .me()
      .then((u) => {
        // Prénom saisi à l'inscription ; à défaut, premier mot du nom complet
        const first = u.firstName || u.fullName?.split(" ")[0];
        if (first) setName(first);
      })
      // Serveur injoignable : pas de prénom inventé, la salutation s'affiche sans prénom
      .catch(() => undefined);
    walletApi
      .get()
      .then((w) => setBalance(w.balance))
      // Serveur injoignable : « --- » plutôt qu'un solde inventé (48 500 F s'affichait avant)
      .catch(() => setBalance(null))
      .finally(() => setLoadingWallet(false));
  }, []);

  // Économie réelle du Zem électrique par rapport à l'essence (0 si le barème ne la justifie pas)
  const promoSavings = Math.max(0, ridePrice(PROMO_KM, "ZEM_ESSENCE") - ridePrice(PROMO_KM, "ZEM_ELECTRIC"));

  return (
    // Le haut de l'écran est géré par la barre d'application (elle passe sous la barre d'état) :
    // seul le bas est protégé ici.
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      {/* Barre d'application fixe : ville, profil et salutation, sur un fond légèrement teinté */}
      <View style={[styles.appBar, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.appBarTop}>
          <View style={styles.cityPill}>
            <View style={styles.liveDot} />
            <Text style={styles.cityPillText} numberOfLines={1}>
              Cotonou & Grand Nokoué
            </Text>
          </View>
          <Pressable
            style={styles.avatar}
            onPress={() => onNavigateTab?.("profile")}
            accessibilityRole="button"
            accessibilityLabel="Profil"
          >
            <MaterialIcons name="person" size={22} color={colors.primary} />
          </Pressable>
        </View>
        {/* Une seule ligne chacun : un long prénom est tronqué (…) au lieu de déborder */}
        <Text style={styles.greeting} numberOfLines={1} ellipsizeMode="tail">
          {name ? t("home.greetingName", { name }) : t("home.greeting")}
        </Text>
        <Text style={styles.question} numberOfLines={1} ellipsizeMode="tail">
          {t("home.question")}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Carte Portefeuille AZƆ̀ Pay (Point focal financier) */}
        <StandingBanner />

        <View style={styles.walletCard}>
          <View style={styles.walletInfo}>
            <View style={styles.walletIconBox}>
              <MaterialIcons name="account-balance-wallet" size={22} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.walletLabel}>{t("home.wallet.label")}</Text>
              {loadingWallet ? (
                <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 4 }} />
              ) : (
                <Text style={styles.walletBalance} numberOfLines={1}>
                  {balance !== null ? balance.toLocaleString(locale) : "---"}{" "}
                  <Text style={styles.currency}>FCFA</Text>
                </Text>
              )}
            </View>
          </View>
          <Pressable style={styles.rechargeBtn} onPress={() => onNavigateTab?.("wallet")}>
            <MaterialIcons name="add" size={18} color="#fff" />
            <Text style={styles.rechargeBtnText}>{t("home.wallet.recharge")}</Text>
          </Pressable>
        </View>

        {/* Barre de recherche rapide + Destinations en 1 clic */}
        <Pressable style={styles.quickSearchBox} onPress={() => onSelectService("zem")}>
          <View style={styles.quickSearchIcon}>
            <MaterialIcons name="search" size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.quickSearchTitle}>{t("home.search.title")}</Text>
            <Text style={styles.quickSearchSub}>{t("home.search.sub")}</Text>
          </View>
          <MaterialIcons name="arrow-forward-ios" size={16} color={colors.onSurfaceVariant} />
        </Pressable>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quickChipsRow}
        >
          {QUICK_DESTINATIONS.map((d) => (
            <Pressable
              key={d.id}
              style={styles.quickChip}
              onPress={() => onSelectService(d.service)}
            >
              <MaterialIcons name={d.icon} size={15} color={colors.primary} />
              <Text style={styles.quickChipText}>{t(d.labelKey)}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Section 1 : Déplacement immédiat (2 grandes cartes côte à côte) */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t("home.section.order")}</Text>
          <Text style={styles.sectionHint}>{t("home.section.orderHint")}</Text>
        </View>
        <View style={styles.mainServicesRow}>
          {MAIN_SERVICES.map((s) => (
            <Pressable
              key={s.id}
              style={[styles.mainServiceCard, { backgroundColor: s.bg }]}
              onPress={() => onSelectService(s.id)}
            >
              <View style={styles.mainServiceTop}>
                <View style={styles.mainServiceBadge}>
                  <Text style={[styles.mainServiceBadgeText, { color: s.fg }]}>{t(s.badgeKey)}</Text>
                </View>
                <MaterialIcons name="arrow-outward" size={18} color={s.fg} />
              </View>
              <MaterialIcons name={s.icon} size={40} color={s.fg} style={{ marginVertical: 6 }} />
              <Text style={styles.mainServiceText}>{t(s.labelKey)}</Text>
              <Text style={styles.mainServiceSub}>{t(s.subKey)}</Text>
            </Pressable>
          ))}
        </View>

        {/* Section 2 : Tous les services AZƆ̀ (Grille symétrique 3 × 2) */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t("home.section.services")}</Text>
          <Text style={styles.sectionHint}>{t("home.section.servicesHint")}</Text>
        </View>
        <View style={styles.otherServicesGrid}>
          {OTHER_SERVICES.map((s) => (
            <Pressable
              key={s.id}
              style={styles.smallTile}
              onPress={() => onSelectService(s.id)}
            >
              <View style={[styles.smallTileIcon, { backgroundColor: s.bg }]}>
                <MaterialIcons name={s.icon} size={24} color={s.fg} />
              </View>
              <Text style={styles.smallTileLabel} numberOfLines={1}>
                {t(s.labelKey)}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Bannière promo Zem Électrique */}
        <LinearGradient
          colors={["#008751", "#005a36"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.promoBanner}
        >
          <View style={{ flex: 1 }}>
            <View style={styles.promoTag}>
              <MaterialIcons name="bolt" size={14} color="#008751" />
              <Text style={styles.promoTagText}>
                {promoSavings > 0 ? t("home.promo.tagSave", { amount: promoSavings, km: PROMO_KM }) : t("home.promo.tag")}
              </Text>
            </View>
            <Text style={styles.promoTitle}>{t("home.promo.title")}</Text>
            <Text style={styles.promoSubtitle}>
              {t("home.promo.text")}
            </Text>
          </View>
          <Pressable style={styles.promoCta} onPress={() => onSelectService("zem")}>
            <Text style={styles.promoCtaText}>{t("home.promo.cta")}</Text>
            <MaterialIcons name="arrow-forward" size={16} color="#008751" />
          </Pressable>
        </LinearGradient>
      </ScrollView>

      {/* Barre de navigation basse (composant partagé avec Courses et Profil) */}
      <ClientTabBar active="home" onNavigate={onNavigateTab} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },

  // Barre d'application : fond violet clair de la charte (primaryFixed à 60 %), coins du bas arrondis.
  appBar: {
    backgroundColor: `${colors.primaryFixed}99`,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    elevation: 2,
    shadowColor: colors.primary,
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  appBarTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  // La pilule de ville se réduit (flexShrink) si la place manque, le profil garde sa taille.
  cityPill: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surfaceContainerLowest,
    paddingHorizontal: 12,
    height: 30,
    borderRadius: radius.full,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  cityPillText: {
    flexShrink: 1,
    ...typography.labelSm,
    color: colors.primary,
    fontWeight: "700",
    fontSize: 11,
  },
  greeting: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  question: { ...typography.bodyMd, color: colors.onSurfaceVariant, marginTop: 2 },
  avatar: {
    width: 42,
    height: 42,
    flexShrink: 0,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: "center",
    justifyContent: "center",
  },

  // Wallet
  walletCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    padding: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
  },
  walletInfo: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  walletIconBox: {
    width: 44,
    height: 44,
    borderRadius: radius.lg,
    backgroundColor: colors.primaryFixed,
    alignItems: "center",
    justifyContent: "center",
  },
  walletTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  walletLabel: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  walletZeroCashBadge: {
    backgroundColor: colors.secondaryFixed,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  walletZeroCashText: {
    ...typography.labelSm,
    color: colors.secondary,
    fontSize: 9,
    fontWeight: "800",
  },
  walletBalance: {
    ...typography.headlineMd,
    color: colors.onSurface,
    fontWeight: "800",
    marginTop: 2,
  },
  currency: { ...typography.labelMd, color: colors.onSurfaceVariant, fontWeight: "600" },
  rechargeBtn: {
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.full,
    gap: 4,
  },
  rechargeBtnText: { ...typography.labelMd, color: "#fff", fontWeight: "700" },

  // Quick Search + Chips
  quickSearchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: colors.primaryFixed,
    marginBottom: spacing.sm,
  },
  quickSearchIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    backgroundColor: colors.primaryFixed,
    alignItems: "center",
    justifyContent: "center",
  },
  quickSearchTitle: {
    ...typography.bodyMd,
    color: colors.onSurface,
    fontWeight: "700",
  },
  quickSearchSub: {
    ...typography.bodySm,
    color: colors.onSurfaceVariant,
    fontSize: 12,
  },
  quickChipsRow: {
    gap: 8,
    paddingBottom: spacing.md,
  },
  quickChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHigh,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.full,
  },
  quickChipText: {
    ...typography.labelMd,
    color: colors.onSurface,
    fontWeight: "600",
    fontSize: 12,
  },

  // Section Headers
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  sectionTitle: {
    ...typography.labelLg,
    color: colors.onSurface,
    fontWeight: "800",
  },
  sectionHint: {
    ...typography.bodySm,
    color: colors.onSurfaceVariant,
    fontSize: 12,
  },

  // Main Services (2 hero cards)
  mainServicesRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.lg },
  mainServiceCard: {
    flex: 1,
    borderRadius: radius.xl,
    padding: spacing.md,
    justifyContent: "space-between",
    minHeight: 138,
  },
  mainServiceTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  mainServiceBadge: {
    backgroundColor: "rgba(255,255,255,0.75)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  mainServiceBadgeText: {
    ...typography.labelSm,
    fontWeight: "800",
    fontSize: 10,
  },
  mainServiceText: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  mainServiceSub: { ...typography.bodySm, color: colors.onSurfaceVariant, fontWeight: "600", marginTop: 2 },

  // Symmetrical 3x2 Grid for Other Services
  otherServicesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: spacing.sm,
    marginBottom: spacing.lg,
  },
  smallTile: {
    width: "31.5%",
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
  },
  smallTileIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  smallTileLabel: {
    ...typography.labelSm,
    color: colors.onSurface,
    fontWeight: "700",
    textAlign: "center",
  },

  // Promo Banner
  promoBanner: {
    borderRadius: radius.xl,
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  promoTag: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
    backgroundColor: "#fff",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
    marginBottom: 6,
  },
  promoTagText: {
    ...typography.labelSm,
    color: "#008751",
    fontWeight: "800",
    fontSize: 9,
  },
  promoTitle: { ...typography.headlineSm, color: "#fff", fontWeight: "800", marginBottom: 4 },
  promoSubtitle: { ...typography.bodySm, color: "rgba(255,255,255,0.9)" },
  promoCta: {
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.full,
  },
  promoCtaText: { ...typography.labelMd, color: "#008751", fontWeight: "800" },

});
