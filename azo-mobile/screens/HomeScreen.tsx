import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { userApi, walletApi } from "../services/api";

type Props = {
  clientName?: string;
  onSelectService: (serviceId: string) => void;
  onNavigateTab?: (tabId: "home" | "courses" | "wallet" | "profile") => void;
};

// Services principaux mis en avant avec sous-titre d'accroche
const MAIN_SERVICES = [
  {
    id: "zem",
    label: "Zem",
    sub: "Essence ou électrique",
    badge: "Populaire",
    icon: "two-wheeler" as const,
    bg: colors.secondaryFixed,
    fg: colors.secondary,
  },
  {
    id: "transport",
    label: "Voiture",
    sub: "Confort & Clim",
    badge: "Sécurisé",
    icon: "directions-car" as const,
    bg: colors.primaryFixed,
    fg: colors.primary,
  },
];

// Grille symétrique 3 × 2 (6 services complémentaires bien alignés)
const OTHER_SERVICES = [
  { id: "livraison", label: "Envoyer Colis", icon: "local-shipping" as const, bg: colors.tertiaryFixed, fg: colors.tertiary },
  { id: "coursier", label: "Coursier Pro", icon: "directions-run" as const, bg: colors.secondaryFixed, fg: colors.secondary },
  { id: "location", label: "Louer Auto", icon: "key" as const, bg: colors.tertiaryFixed, fg: colors.tertiary },
  { id: "marketplace", label: "Boutique AZƆ̀", icon: "storefront" as const, bg: colors.secondaryFixed, fg: colors.secondary },
  { id: "agence", label: "Espace Agence", icon: "apartment" as const, bg: colors.primaryFixed, fg: colors.primary },
  { id: "courses", label: "Mes Trajets", icon: "receipt-long" as const, bg: colors.primaryFixed, fg: colors.primary },
];

// Lieux favoris de Cotonou en 1 clic
const QUICK_DESTINATIONS = [
  { id: "etoile", label: "Étoile Rouge", icon: "place" as const, service: "zem" },
  { id: "dantokpa", label: "Marché Dantokpa", icon: "shopping-bag" as const, service: "zem" },
  { id: "aeroport", label: "Aéroport Cotonou", icon: "flight" as const, service: "transport" },
  { id: "ganhi", label: "Ganhi Centre", icon: "business" as const, service: "transport" },
  { id: "calavi", label: "Campus Calavi", icon: "school" as const, service: "zem" },
];

const NAV_ITEMS = [
  { id: "home", label: "Accueil", icon: "home" as const },
  { id: "courses", label: "Courses", icon: "receipt-long" as const },
  { id: "wallet", label: "AZƆ̀ Pay", icon: "account-balance-wallet" as const },
  { id: "profile", label: "Profil", icon: "person" as const },
] as const;

export default function HomeScreen({ clientName = "", onSelectService, onNavigateTab }: Props) {
  const [name, setName] = useState(clientName);
  const [balance, setBalance] = useState<number | null>(null);
  const [loadingWallet, setLoadingWallet] = useState(true);

  useEffect(() => {
    userApi
      .me()
      .then((u) => {
        if (u.fullName) setName(u.fullName.split(" ")[0]);
      })
      .catch(() => {
        if (!name) setName("Kossi");
      });
    walletApi
      .get()
      .then((w) => setBalance(w.balance))
      .catch(() => setBalance(48500))
      .finally(() => setLoadingWallet(false));
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* En-tête aéré avec badge ville + profil */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <View style={styles.cityPill}>
              <View style={styles.liveDot} />
              <Text style={styles.cityPillText}>Cotonou & Grand Nokoué</Text>
            </View>
            <Text style={styles.greeting}>Bonjour{name ? `, ${name}` : ""} 👋</Text>
            <Text style={styles.question}>Où allons-nous aujourd'hui ?</Text>
          </View>
          <Pressable
            style={styles.avatar}
            onPress={() => onNavigateTab?.("profile")}
            accessibilityLabel="Profil"
          >
            <MaterialIcons name="person" size={24} color={colors.primary} />
          </Pressable>
        </View>

        {/* Carte Portefeuille AZƆ̀ Pay (Point focal financier) */}
        <View style={styles.walletCard}>
          <View style={styles.walletInfo}>
            <View style={styles.walletIconBox}>
              <MaterialIcons name="account-balance-wallet" size={22} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.walletLabel}>Solde AZƆ̀ Pay</Text>
              {loadingWallet ? (
                <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 4 }} />
              ) : (
                <Text style={styles.walletBalance} numberOfLines={1}>
                  {balance !== null ? balance.toLocaleString("fr-FR") : "---"}{" "}
                  <Text style={styles.currency}>FCFA</Text>
                </Text>
              )}
            </View>
          </View>
          <Pressable style={styles.rechargeBtn} onPress={() => onNavigateTab?.("wallet")}>
            <MaterialIcons name="add" size={18} color="#fff" />
            <Text style={styles.rechargeBtnText}>Recharger</Text>
          </Pressable>
        </View>

        {/* Barre de recherche rapide + Destinations en 1 clic */}
        <Pressable style={styles.quickSearchBox} onPress={() => onSelectService("zem")}>
          <View style={styles.quickSearchIcon}>
            <MaterialIcons name="search" size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.quickSearchTitle}>Chercher une destination…</Text>
            <Text style={styles.quickSearchSub}>Tarif connu à l'avance • Chauffeur vérifié</Text>
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
              <Text style={styles.quickChipText}>{d.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Section 1 : Déplacement immédiat (2 grandes cartes côte à côte) */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Commander une course</Text>
          <Text style={styles.sectionHint}>Départ immédiat</Text>
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
                  <Text style={[styles.mainServiceBadgeText, { color: s.fg }]}>{s.badge}</Text>
                </View>
                <MaterialIcons name="arrow-outward" size={18} color={s.fg} />
              </View>
              <MaterialIcons name={s.icon} size={40} color={s.fg} style={{ marginVertical: 6 }} />
              <Text style={styles.mainServiceText}>{s.label}</Text>
              <Text style={styles.mainServiceSub}>{s.sub}</Text>
            </Pressable>
          ))}
        </View>

        {/* Section 2 : Tous les services AZƆ̀ (Grille symétrique 3 × 2) */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Services & Partenaires</Text>
          <Text style={styles.sectionHint}>Tout l'écosystème AZƆ̀</Text>
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
                {s.label}
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
              <Text style={styles.promoTagText}>ZÉRO ÉMISSION • -50 FCFA</Text>
            </View>
            <Text style={styles.promoTitle}>Écologique & Économique</Text>
            <Text style={styles.promoSubtitle}>
              Essaie nos nouveaux Zem électriques silencieux dans tout Cotonou
            </Text>
          </View>
          <Pressable style={styles.promoCta} onPress={() => onSelectService("zem")}>
            <Text style={styles.promoCtaText}>Réserver</Text>
            <MaterialIcons name="arrow-forward" size={16} color="#008751" />
          </Pressable>
        </LinearGradient>
      </ScrollView>

      {/* Barre de navigation basse */}
      <View style={styles.bottomNav}>
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === "home";
          return (
            <Pressable
              key={item.id}
              style={styles.navItem}
              onPress={() => onNavigateTab?.(item.id)}
            >
              <View
                style={[
                  styles.navIconWrapper,
                  isActive && { backgroundColor: colors.primaryFixed },
                ]}
              >
                <MaterialIcons
                  name={item.icon}
                  size={24}
                  color={isActive ? colors.primary : colors.outline}
                />
              </View>
              <Text
                style={[
                  styles.navLabel,
                  isActive && { color: colors.primary, fontWeight: "700" },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },

  // Header
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
    paddingTop: spacing.xs,
  },
  cityPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    backgroundColor: colors.primaryFixed,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
    marginBottom: 6,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  cityPillText: {
    ...typography.labelSm,
    color: colors.primary,
    fontWeight: "700",
    fontSize: 11,
  },
  greeting: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  question: { ...typography.bodyMd, color: colors.onSurfaceVariant, marginTop: 2 },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: radius.full,
    backgroundColor: colors.primaryFixed,
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

  // Bottom Nav
  bottomNav: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingTop: 8,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceContainer,
    backgroundColor: colors.surfaceContainerLowest,
  },
  navItem: { alignItems: "center", gap: 4, flex: 1 },
  navIconWrapper: {
    width: 44,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  navLabel: { ...typography.labelSm, color: colors.outline, fontSize: 10 },
});
