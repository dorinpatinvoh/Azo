import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";

export type ScreenId =
  | "splash" | "otp" | "home" | "ride-request" | "ride-tracking" | "ride-rating"
  | "delivery" | "rental" | "wallet" | "courses" | "profile"
  | "driver-home" | "agency-dashboard"
  | "admin-dashboard" | "marketplace" | "artisans" | "notifications";

const SCREENS: { id: ScreenId; label: string; group: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { id: "splash", label: "1. Splash / Onboarding", group: "Client", icon: "rocket-launch" },
  { id: "otp", label: "2. Connexion OTP", group: "Client", icon: "sms" },
  { id: "home", label: "3. Accueil client", group: "Client", icon: "home" },
  { id: "ride-request", label: "4. Demande de course", group: "Client", icon: "map" },
  { id: "ride-tracking", label: "5. Suivi de course", group: "Client", icon: "near-me" },
  { id: "ride-rating", label: "6. Fin de trajet & notation", group: "Client", icon: "star" },
  { id: "delivery", label: "7. Livraison colis", group: "Client", icon: "local-shipping" },
  { id: "rental", label: "8. Location de véhicules", group: "Client", icon: "directions-car" },
  { id: "wallet", label: "9. Portefeuille / Paiement", group: "Client", icon: "account-balance-wallet" },
  { id: "courses", label: "9b. Mes courses (historique)", group: "Client", icon: "receipt-long" },
  { id: "profile", label: "9c. Mon profil", group: "Client", icon: "person" },
  { id: "marketplace", label: "10. Courses au marché (Marketplace)", group: "V2", icon: "storefront" },
  { id: "artisans", label: "11. Espace Artisans", group: "V2", icon: "build" },
  { id: "driver-home", label: "12. Accueil conducteur", group: "Professionnel", icon: "two-wheeler" },
  { id: "agency-dashboard", label: "13. Mon agence", group: "Agence", icon: "apartment" },
  { id: "admin-dashboard", label: "14. Tableau de bord admin", group: "Admin", icon: "admin-panel-settings" },
  { id: "notifications", label: "15. Notifications", group: "Commun", icon: "notifications" },
];

const GROUPS = ["Client", "V2", "Professionnel", "Agence", "Admin", "Commun"];

type Props = { onSelect: (id: ScreenId) => void };

export default function DevMenuScreen({ onSelect }: Props) {
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Tous les écrans AZƆ̀</Text>
        <Text style={styles.subtitle}>Menu de développement — à retirer avant la mise en prod</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        {GROUPS.map((group) => {
          const items = SCREENS.filter((s) => s.group === group);
          if (!items.length) return null;
          return (
            <View key={group} style={{ marginBottom: spacing.md }}>
              <Text style={styles.groupLabel}>{group}</Text>
              <View style={{ gap: spacing.sm }}>
                {items.map((s) => (
                  <Pressable key={s.id} style={styles.row} onPress={() => onSelect(s.id)}>
                    <View style={styles.rowIcon}>
                      <MaterialIcons name={s.icon} size={20} color={colors.primary} />
                    </View>
                    <Text style={styles.rowLabel}>{s.label}</Text>
                    <MaterialIcons name="chevron-right" size={20} color={colors.outline} />
                  </Pressable>
                ))}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.md, marginBottom: spacing.sm },
  title: { ...typography.headlineLg, color: colors.onSurface, fontWeight: "800" },
  subtitle: { ...typography.bodySm, color: colors.onSurfaceVariant, marginTop: 2 },
  scroll: { padding: spacing.md, paddingTop: 0 },
  groupLabel: { ...typography.labelMd, color: colors.outline, textTransform: "uppercase", marginBottom: spacing.xs },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.md, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  rowIcon: { width: 36, height: 36, borderRadius: radius.full, backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center" },
  rowLabel: { ...typography.labelMd, color: colors.onSurface, fontWeight: "600", flex: 1 },
});
