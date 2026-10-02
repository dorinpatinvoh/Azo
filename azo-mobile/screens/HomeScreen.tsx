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

// Séparation des services principaux et secondaires
const MAIN_SERVICES = [
  { id: "transport", label: "Voiture", icon: "directions-car" as const, bg: colors.primaryFixed, fg: colors.primary },
  { id: "zem", label: "Zem", icon: "electric-moped" as const, bg: colors.secondaryFixed, fg: colors.secondary },
];

const OTHER_SERVICES = [
  { id: "livraison", label: "Livraison", icon: "local-shipping" as const, bg: colors.tertiaryFixed, fg: colors.tertiary },
  { id: "coursier", label: "Coursier", icon: "directions-run" as const, bg: colors.secondaryFixed, fg: colors.secondary },
  { id: "courses", label: "Courses", icon: "shopping-bag" as const, bg: colors.primaryFixed, fg: colors.primary },
  { id: "agence", label: "Agence", icon: "apartment" as const, bg: colors.primaryFixed, fg: colors.primary },
  { id: "location", label: "Location", icon: "key" as const, bg: colors.tertiaryFixed, fg: colors.tertiary },
  { id: "marketplace", label: "Boutique", icon: "storefront" as const, bg: colors.secondaryFixed, fg: colors.secondary },
];

const NAV_ITEMS = [
  { id: "home", label: "Accueil", icon: "home" as const },
  { id: "courses", label: "Courses", icon: "receipt-long" as const },
  { id: "wallet", label: "Wallet", icon: "account-balance-wallet" as const },
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
    // CORRECTION : edges "bottom" ajouté pour que la barre d'onglets ne passe pas
    // sous la barre système (Android / iPhone) et reste cliquable.
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        
        {/* En-tête */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.greeting}>Bonjour{name ? `, ${name}` : ""} 👋</Text>
            <Text style={styles.question}>Où allons-nous aujourd'hui ?</Text>
          </View>
          {/* CORRECTION : l'avatar ouvre maintenant le profil */}
          <Pressable style={styles.avatar} onPress={() => onNavigateTab?.("profile")} accessibilityLabel="Profil">
            <MaterialIcons name="person" size={24} color={colors.onSurfaceVariant} />
          </Pressable>
        </View>

        {/* Carte Portefeuille (Wallet) - Plus compacte et élégante */}
        <View style={styles.walletCard}>
          <View style={styles.walletInfo}>
            <MaterialIcons name="account-balance-wallet" size={20} color={colors.primary} />
            <View>
              <Text style={styles.walletLabel}>Solde AZƆ̀ Pay</Text>
              {loadingWallet ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={styles.walletBalance}>
                  {balance !== null ? balance.toLocaleString("fr-FR") : "---"} <Text style={styles.currency}>FCFA</Text>
                </Text>
              )}
            </View>
          </View>
          <Pressable style={styles.rechargeBtn} onPress={() => onNavigateTab?.("wallet")}>
            <MaterialIcons name="add" size={20} color="#fff" />
            <Text style={styles.rechargeBtnText}>Recharger</Text>
          </Pressable>
        </View>

        {/* Services Principaux (Grosses cartes) */}
        <View style={styles.mainServicesRow}>
          {MAIN_SERVICES.map((s) => (
            <Pressable key={s.id} style={[styles.mainServiceCard, { backgroundColor: s.bg }]} onPress={() => onSelectService(s.id)}>
              <MaterialIcons name={s.icon} size={42} color={s.fg} style={{ marginBottom: 8 }} />
              <Text style={styles.mainServiceText}>{s.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* Autres Services (Petite grille à 4 colonnes) */}
        <View style={styles.otherServicesGrid}>
          {OTHER_SERVICES.map((s) => (
            <Pressable key={s.id} style={styles.smallTile} onPress={() => onSelectService(s.id)}>
              <View style={[styles.smallTileIcon, { backgroundColor: s.bg }]}>
                <MaterialIcons name={s.icon} size={24} color={s.fg} />
              </View>
              <Text style={styles.smallTileLabel} numberOfLines={1}>{s.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* Bannière promo */}
        <LinearGradient
          colors={["#008751", "#005a36"]} 
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={styles.promoBanner}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.promoTitle}>Écologique & Économique</Text>
            <Text style={styles.promoSubtitle}>Essayez nos nouveaux Zem électriques</Text>
          </View>
          <Pressable style={styles.promoCta} onPress={() => onSelectService("zem")}>
            <Text style={styles.promoCtaText}>Go</Text>
            <MaterialIcons name="arrow-forward" size={16} color="#008751" />
          </Pressable>
        </LinearGradient>
      </ScrollView>

      {/* Barre de navigation basse */}
      <View style={styles.bottomNav}>
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === "home";
          return (
            <Pressable key={item.id} style={styles.navItem} onPress={() => onNavigateTab?.(item.id)}>
              <View style={[styles.navIconWrapper, isActive && { backgroundColor: colors.primaryFixed }]}>
                <MaterialIcons name={item.icon} size={24} color={isActive ? colors.primary : colors.outline} />
              </View>
              <Text style={[styles.navLabel, isActive && { color: colors.primary, fontWeight: "700" }]}>{item.label}</Text>
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
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.lg, paddingTop: spacing.sm },
  greeting: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  question: { ...typography.bodyMd, color: colors.onSurfaceVariant, marginTop: 2 },
  avatar: { width: 44, height: 44, borderRadius: radius.full, backgroundColor: colors.surfaceContainer, alignItems: "center", justifyContent: "center" },

  // Wallet
  walletCard: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, padding: spacing.md, flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xl, borderWidth: 1, borderColor: colors.surfaceContainerLow, elevation: 2, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8 },
  walletInfo: { flexDirection: "row", alignItems: "center", gap: 12 },
  walletLabel: { ...typography.labelSm, color: colors.onSurfaceVariant, textTransform: "uppercase", letterSpacing: 0.5 },
  walletBalance: { ...typography.headlineMd, color: colors.onSurface, fontWeight: "800", marginTop: 2 },
  currency: { ...typography.labelMd, color: colors.onSurfaceVariant, fontWeight: "600" },
  rechargeBtn: { backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.full, gap: 4 },
  rechargeBtnText: { ...typography.labelMd, color: "#fff", fontWeight: "700" },

  // Main Services
  mainServicesRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.lg },
  mainServiceCard: { flex: 1, height: 110, borderRadius: radius.xl, padding: spacing.md, justifyContent: "center" },
  mainServiceText: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "700" },

  // Other Services
  otherServicesGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-start", gap: spacing.md, marginBottom: spacing.xl },
  smallTile: { width: "21%", alignItems: "center", gap: 6, marginBottom: spacing.sm },
  smallTileIcon: { width: 52, height: 52, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
  smallTileLabel: { ...typography.labelSm, color: colors.onSurface, textAlign: "center" },

  // Promo Banner
  promoBanner: { borderRadius: radius.xl, padding: spacing.lg, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  promoTitle: { ...typography.headlineSm, color: "#fff", marginBottom: 4 },
  promoSubtitle: { ...typography.bodySm, color: "rgba(255,255,255,0.85)" },
  promoCta: { backgroundColor: "#fff", flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.full },
  promoCtaText: { ...typography.labelMd, color: "#008751", fontWeight: "800" },

  // Bottom Nav
  bottomNav: { flexDirection: "row", justifyContent: "space-around", paddingTop: 8, paddingBottom: spacing.md, borderTopWidth: 1, borderTopColor: colors.surfaceContainer, backgroundColor: colors.surfaceContainerLowest },
  navItem: { alignItems: "center", gap: 4, flex: 1 },
  navIconWrapper: { width: 44, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  navLabel: { ...typography.labelSm, color: colors.outline, fontSize: 10 },
});
