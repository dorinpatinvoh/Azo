import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { userApi, walletApi, ridesApi, UserProfile, Ride } from "../services/api";
import ClientTabBar, { ClientTab } from "../components/ClientTabBar";
import { fcfa, DEMO_USER, DEMO_BALANCE, DEMO_RIDES } from "../utils/rideDisplay";

type Props = {
  onNavigateTab: (tab: ClientTab) => void;
  onOpenNotifications: () => void;
  onLogout: () => void;
};

function initials(name?: string | null) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

function formatPhone(phone: string) {
  const d = phone.replace(/\D/g, "");
  const local = d.startsWith("229") ? d.slice(3) : d;
  return `+229 ${local.replace(/(\d{2})(?=\d)/g, "$1 ").trim()}`;
}

export default function ProfileScreen({ onNavigateTab, onOpenNotifications, onLogout }: Props) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [me, wallet, history] = await Promise.allSettled([userApi.me(), walletApi.get(), ridesApi.history()]);
    if (me.status === "rejected") {
      setOffline(true);
      setUser(DEMO_USER);
      setBalance(DEMO_BALANCE);
      setRides(DEMO_RIDES);
      return;
    }
    setUser(me.value);
    if (wallet.status === "fulfilled") setBalance(wallet.value.balance);
    if (history.status === "fulfilled") setRides(history.value);
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const completed = useMemo(() => rides.filter((r) => r.status === "COMPLETED").length, [rides]);
  const memberSince = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })
    : null;

  async function saveName() {
    const name = draft.trim();
    if (name.length < 2) return Alert.alert("Nom trop court", "Entrez au moins 2 caractères.");
    if (offline) {
      setUser((u) => (u ? { ...u, fullName: name } : u));
      return setEditing(false);
    }
    setSaving(true);
    try {
      const updated = await userApi.update(name);
      setUser((u) => (u ? { ...u, fullName: updated.fullName } : u));
      setEditing(false);
    } catch (e: any) {
      Alert.alert("Erreur", e.message || "Impossible d'enregistrer le nom.");
    } finally {
      setSaving(false);
    }
  }

  function confirmLogout() {
    Alert.alert("Déconnexion", "Voulez-vous vraiment vous déconnecter ?", [
      { text: "Annuler", style: "cancel" },
      { text: "Se déconnecter", style: "destructive", onPress: onLogout },
    ]);
  }

  const MENU = [
    { id: "wallet", label: "Mon portefeuille", meta: balance !== null ? fcfa(balance) : undefined, icon: "account-balance-wallet" as const, onPress: () => onNavigateTab("wallet") },
    { id: "courses", label: "Mes courses", meta: `${rides.length}`, icon: "receipt-long" as const, onPress: () => onNavigateTab("courses") },
    { id: "notifs", label: "Notifications", icon: "notifications-none" as const, onPress: onOpenNotifications },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Mon profil</Text>

        {offline && (
          <View style={styles.offlineBanner}>
            <MaterialIcons name="cloud-off" size={16} color={colors.tertiary} />
            <Text style={styles.offlineText}>Serveur injoignable · données de démonstration</Text>
          </View>
        )}

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
        ) : (
          <>
            {/* Identité */}
            <View style={styles.identity}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials(user?.fullName)}</Text>
              </View>

              {editing ? (
                <View style={styles.editRow}>
                  <TextInput
                    value={draft}
                    onChangeText={setDraft}
                    placeholder="Votre nom complet"
                    placeholderTextColor={colors.outline}
                    style={styles.input}
                    autoFocus
                    maxLength={60}
                    returnKeyType="done"
                    onSubmitEditing={saveName}
                  />
                  <Pressable style={styles.saveBtn} onPress={saveName} disabled={saving}>
                    {saving ? <ActivityIndicator color="#fff" size="small" /> : <MaterialIcons name="check" size={20} color="#fff" />}
                  </Pressable>
                  <Pressable style={styles.cancelBtn} onPress={() => setEditing(false)}>
                    <MaterialIcons name="close" size={20} color={colors.onSurfaceVariant} />
                  </Pressable>
                </View>
              ) : (
                <Pressable style={styles.nameRow} onPress={() => { setDraft(user?.fullName || ""); setEditing(true); }}>
                  <Text style={styles.name}>{user?.fullName || "Ajouter mon nom"}</Text>
                  <MaterialIcons name="edit" size={16} color={colors.primary} />
                </Pressable>
              )}

              <Text style={styles.phone}>{user ? formatPhone(user.phone) : ""}</Text>
              <View style={styles.rolePill}>
                <MaterialIcons name="verified-user" size={13} color={colors.primary} />
                <Text style={styles.roleText}>Client{memberSince ? ` · depuis ${memberSince}` : ""}</Text>
              </View>
            </View>

            {/* Chiffres clés */}
            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{completed}</Text>
                <Text style={styles.statLabel}>Trajets terminés</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{balance !== null ? fcfa(balance) : "—"}</Text>
                <Text style={styles.statLabel}>Solde</Text>
              </View>
            </View>

            {/* Raccourcis */}
            <View style={styles.menu}>
              {MENU.map((m, i) => (
                <Pressable key={m.id} style={[styles.menuRow, i < MENU.length - 1 && styles.menuDivider]} onPress={m.onPress}>
                  <View style={styles.menuIcon}>
                    <MaterialIcons name={m.icon} size={20} color={colors.primary} />
                  </View>
                  <Text style={styles.menuLabel}>{m.label}</Text>
                  {m.meta && <Text style={styles.menuMeta}>{m.meta}</Text>}
                  <MaterialIcons name="chevron-right" size={20} color={colors.outline} />
                </Pressable>
              ))}
            </View>

            <Pressable style={styles.logout} onPress={confirmLogout} accessibilityRole="button">
              <MaterialIcons name="logout" size={20} color={colors.error} />
              <Text style={styles.logoutText}>Se déconnecter</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      <ClientTabBar active="profile" onNavigate={onNavigateTab} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  title: { ...typography.headlineLg, color: colors.onSurface, fontWeight: "800", marginBottom: spacing.md },
  offlineBanner: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.tertiaryFixed, borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 8, marginBottom: spacing.md },
  offlineText: { ...typography.labelSm, color: colors.tertiary },
  identity: { alignItems: "center", backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, padding: spacing.lg, borderWidth: 1, borderColor: colors.surfaceContainer, marginBottom: spacing.md },
  avatar: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  avatarText: { ...typography.headlineXl, color: "#fff", fontWeight: "800" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { ...typography.headlineMd, color: colors.onSurface, fontWeight: "800" },
  editRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, width: "100%" },
  input: { flex: 1, height: 44, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.primary, paddingHorizontal: 12, ...typography.bodyLg, color: colors.onSurface, backgroundColor: colors.surface },
  saveBtn: { width: 44, height: 44, borderRadius: radius.lg, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  cancelBtn: { width: 44, height: 44, borderRadius: radius.lg, backgroundColor: colors.surfaceContainer, alignItems: "center", justifyContent: "center" },
  phone: { ...typography.bodyMd, color: colors.onSurfaceVariant, marginTop: 4 },
  rolePill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.primaryFixed, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full, marginTop: spacing.sm },
  roleText: { ...typography.labelSm, color: colors.primary },
  statsRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  stat: { flex: 1, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.surfaceContainer },
  statValue: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  statLabel: { ...typography.bodySm, color: colors.onSurfaceVariant, marginTop: 2 },
  menu: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.surfaceContainer, marginBottom: spacing.lg, overflow: "hidden" },
  menuRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  menuDivider: { borderBottomWidth: 1, borderBottomColor: colors.surfaceContainer },
  menuIcon: { width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center" },
  menuLabel: { ...typography.labelLg, color: colors.onSurface, flex: 1 },
  menuMeta: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  logout: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 52, borderRadius: radius.xl, backgroundColor: colors.errorContainer },
  logoutText: { ...typography.labelLg, color: colors.error, fontWeight: "800" },
});
