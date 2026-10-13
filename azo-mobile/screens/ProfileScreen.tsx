import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Switch } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Constants from "expo-constants";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { userApi, walletApi, ridesApi, UserProfile, Ride } from "../services/api";
import ClientTabBar, { ClientTab } from "../components/ClientTabBar";
import LanguageSheet from "../components/LanguageSheet";
import Avatar from "../components/Avatar";
import AvatarSheet from "../components/AvatarSheet";
import { useAvatar } from "../utils/avatar";
import { fcfa } from "../utils/rideDisplay";
import { formatBeninPhoneDisplay } from "../utils/phone";
import { languageInfo, useI18n } from "../i18n";
import { speakKey, stopSpeaking } from "../i18n/voice";

type Props = {
  onNavigateTab: (tab: ClientTab) => void;
  onOpenNotifications: () => void;
  onOpenProvider: () => void;
  onOpenInfo: () => void;
  onOpenHelp: () => void;
  onLogout: () => void;
};

/** « Sergio AHOSSAN » : le prénom tel quel, le nom en majuscules (comme sur une pièce d'identité). */
export function displayName(user?: Pick<UserProfile, "firstName" | "lastName" | "fullName"> | null) {
  if (user?.firstName && user?.lastName) return `${user.firstName} ${user.lastName.toUpperCase()}`;
  return user?.fullName ?? "";
}

export function initials(user?: Pick<UserProfile, "firstName" | "lastName" | "fullName"> | null) {
  const first = user?.firstName?.[0] ?? user?.fullName?.trim().split(/\s+/)[0]?.[0];
  const last = user?.lastName?.[0] ?? user?.fullName?.trim().split(/\s+/)[1]?.[0];
  return `${first ?? ""}${last ?? ""}`.toUpperCase() || "?";
}

export default function ProfileScreen({ onNavigateTab, onOpenNotifications, onOpenProvider, onOpenInfo, onOpenHelp, onLogout }: Props) {
  const insets = useSafeAreaInsets();
  const { t, lang, locale, voiceAssist, setVoiceAssist, voiceLang } = useI18n();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const avatarUri = useAvatar();

  const load = useCallback(async () => {
    const [me, wallet, history] = await Promise.allSettled([userApi.me(), walletApi.get(), ridesApi.history()]);
    // Serveur injoignable : on le dit, sans afficher de fausses données à la place.
    if (me.status === "rejected") setOffline(true);
    else setUser(me.value);
    if (wallet.status === "fulfilled") setBalance(wallet.value.balance);
    if (history.status === "fulfilled") setRides(history.value);
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const completed = useMemo(() => rides.filter((r) => r.status === "COMPLETED").length, [rides]);
  const memberSince = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString(locale, { month: "long", year: "numeric" })
    : null;
  const isClient = !user?.role || user.role === "CLIENT";

  function confirmLogout() {
    Alert.alert(t("profile.logout.title"), t("profile.logout.body"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("profile.logout"), style: "destructive", onPress: onLogout },
    ]);
  }

  function toggleVoice(on: boolean) {
    setVoiceAssist(on);
    if (on) speakKey("voice.hintOn", voiceLang);
    else stopSpeaking();
  }

  const MENU: { id: string; label: string; meta?: string; icon: keyof typeof MaterialIcons.glyphMap; onPress: () => void }[] = [
    { id: "history", label: t("profile.menu.history"), meta: rides.length ? `${rides.length}` : undefined, icon: "receipt-long", onPress: () => onNavigateTab("courses") },
    { id: "wallet", label: t("profile.menu.wallet"), meta: balance !== null ? fcfa(balance) : undefined, icon: "account-balance-wallet", onPress: () => onNavigateTab("wallet") },
    { id: "notifs", label: t("profile.menu.notifications"), icon: "notifications-none", onPress: onOpenNotifications },
    { id: "info", label: t("profile.menu.info"), icon: "badge", onPress: onOpenInfo },
    { id: "help", label: t("profile.menu.help"), icon: "help-outline", onPress: onOpenHelp },
    { id: "lang", label: t("profile.menu.language"), meta: `${languageInfo(lang).flag} ${languageInfo(lang).native}`, icon: "translate", onPress: () => setLangOpen(true) },
  ];
  if (!isClient) {
    MENU.push({ id: "partner", label: t("profile.menu.partnerSpace"), meta: user?.role?.toLowerCase(), icon: "how-to-reg", onPress: onOpenProvider });
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      {/* Barre d'application : même fond violet clair que l'accueil, coins du bas arrondis */}
      <View style={[styles.appBar, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.appBarTitle}>{t("profile.title")}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {offline && (
          <View style={styles.offlineBanner}>
            <MaterialIcons name="cloud-off" size={16} color={colors.tertiary} />
            <Text style={styles.offlineText}>{t("profile.offline")}</Text>
          </View>
        )}

        {/* Invitation à devenir partenaire (clients seulement) */}
        {isClient && (
          <View style={styles.banner}>
            <View style={styles.bannerIcon}>
              <MaterialIcons name="two-wheeler" size={22} color={colors.onTertiary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle}>{t("profile.partner.title")}</Text>
              <Text style={styles.bannerText}>{t("profile.partner.text")}</Text>
            </View>
            <Pressable style={styles.bannerBtn} onPress={onOpenProvider} accessibilityRole="button">
              <Text style={styles.bannerBtnText}>{t("common.start")}</Text>
            </Pressable>
          </View>
        )}

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
        ) : (
          <>
            {/* Identité : avatar à anneau dégradé, nom, ancienneté */}
            <Pressable style={styles.identity} onPress={onOpenInfo} accessibilityRole="button" accessibilityLabel={t("profile.menu.info")}>
              {/* Toucher la photo : la changer (appareil photo, galerie) ou la retirer */}
              <Pressable onPress={() => setAvatarOpen(true)} accessibilityRole="button" accessibilityLabel={t("avatar.edit")}>
                <LinearGradient colors={[colors.primary, colors.secondaryContainer]} style={styles.avatarRing}>
                  <View style={styles.avatar}>
                    <Avatar uri={avatarUri} initials={initials(user)} size={70} />
                  </View>
                </LinearGradient>
                <View style={styles.avatarBadge}>
                  <MaterialIcons name="photo-camera" size={14} color={colors.onPrimary} />
                </View>
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={2}>{displayName(user) || t("profile.unknown")}</Text>
                <Text style={styles.phone}>{user ? formatBeninPhoneDisplay(user.phone) : ""}</Text>
                {memberSince && (
                  <View style={styles.memberPill}>
                    <MaterialIcons name="verified-user" size={13} color={colors.primary} />
                    <Text style={styles.memberText}>{t("profile.memberSince", { date: memberSince })}</Text>
                  </View>
                )}
              </View>
              <MaterialIcons name="chevron-right" size={24} color={colors.outline} />
            </Pressable>

            {/* Chiffres clés */}
            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{completed}</Text>
                <Text style={styles.statLabel}>{t("profile.stats.rides")}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{balance !== null ? fcfa(balance) : "—"}</Text>
                <Text style={styles.statLabel}>{t("profile.stats.balance")}</Text>
              </View>
            </View>

            {/* Liste de réglages */}
            <View style={styles.menu}>
              {MENU.map((m, i) => (
                <Pressable key={m.id} style={[styles.menuRow, styles.menuDivider]} onPress={m.onPress} accessibilityRole="button">
                  <View style={styles.menuIcon}>
                    <MaterialIcons name={m.icon} size={20} color={colors.primary} />
                  </View>
                  <Text style={styles.menuLabel}>{m.label}</Text>
                  {m.meta && <Text style={styles.menuMeta} numberOfLines={1}>{m.meta}</Text>}
                  <MaterialIcons name="chevron-right" size={20} color={colors.outline} />
                </Pressable>
              ))}
              {/* Aide vocale : interrupteur, la voix du parcours d'inscription */}
              <View style={styles.menuRow}>
                <View style={styles.menuIcon}>
                  <MaterialIcons name="record-voice-over" size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.menuLabel}>{t("voice.on")}</Text>
                  <Text style={styles.menuHint}>{voiceAssist ? t("voice.hintOn") : t("voice.hintOff")}</Text>
                </View>
                <Switch
                  value={voiceAssist}
                  onValueChange={toggleVoice}
                  trackColor={{ true: colors.primaryContainer, false: colors.surfaceContainerHigh }}
                  thumbColor={colors.onPrimary}
                  accessibilityLabel={t("voice.on")}
                />
              </View>
            </View>

            <Pressable style={styles.logout} onPress={confirmLogout} accessibilityRole="button">
              <MaterialIcons name="logout" size={20} color={colors.error} />
              <Text style={styles.logoutText}>{t("profile.logout")}</Text>
            </Pressable>

            <Text style={styles.version}>{t("profile.version", { version: Constants.expoConfig?.version ?? "1.0.0" })}</Text>
          </>
        )}
      </ScrollView>

      <ClientTabBar active="profile" onNavigate={onNavigateTab} />
      <LanguageSheet visible={langOpen} onClose={() => setLangOpen(false)} />
      <AvatarSheet visible={avatarOpen} onClose={() => setAvatarOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
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
  appBarTitle: { ...typography.headlineLg, color: colors.onSurface },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },

  offlineBanner: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.tertiaryFixed, borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 8 },
  offlineText: { ...typography.labelSm, color: colors.tertiary, flex: 1 },

  // Bandeau d'invitation (comme le bandeau jaune de l'écran « Compte » de Gozem), aux couleurs AZƆ̀
  banner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.tertiaryFixed, borderRadius: radius.xl, padding: spacing.sm + 2 },
  bannerIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.tertiaryContainer, alignItems: "center", justifyContent: "center" },
  bannerTitle: { ...typography.labelLg, color: colors.onTertiaryFixed },
  bannerText: { ...typography.bodySm, color: colors.onTertiaryFixed },
  bannerBtn: { backgroundColor: colors.secondaryContainer, borderRadius: radius.full, paddingHorizontal: 14, height: 38, alignItems: "center", justifyContent: "center" },
  bannerBtnText: { ...typography.labelMd, color: colors.onSecondaryFixed },

  identity: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, padding: spacing.md, borderWidth: 1, borderColor: colors.surfaceContainer },
  avatarRing: { width: 84, height: 84, borderRadius: 42, alignItems: "center", justifyContent: "center" },
  avatar: { width: 76, height: 76, borderRadius: 38, overflow: "hidden", backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: colors.surfaceContainerLowest },
  avatarText: { ...typography.headlineLg, color: colors.primary },
  avatarBadge: { position: "absolute", right: -2, bottom: -2, width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.surfaceContainerLowest },
  name: { ...typography.headlineSm, color: colors.onSurface },
  phone: { ...typography.bodyMd, color: colors.onSurfaceVariant, marginTop: 2 },
  memberPill: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 5, backgroundColor: colors.primaryFixed, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4, marginTop: spacing.xs },
  memberText: { ...typography.labelSm, color: colors.primary },

  statsRow: { flexDirection: "row", gap: spacing.sm },
  stat: { flex: 1, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, padding: spacing.md, borderWidth: 1, borderColor: colors.surfaceContainer },
  statValue: { ...typography.headlineMd, color: colors.primary },
  statLabel: { ...typography.bodySm, color: colors.onSurfaceVariant, marginTop: 2 },

  menu: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.surfaceContainer, overflow: "hidden" },
  menuRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 2, paddingHorizontal: spacing.md, minHeight: 60 },
  menuDivider: { borderBottomWidth: 1, borderBottomColor: colors.surfaceContainer },
  menuIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center" },
  menuLabel: { ...typography.bodyLg, color: colors.onSurface, flex: 1 },
  menuHint: { ...typography.bodySm, color: colors.onSurfaceVariant },
  menuMeta: { ...typography.labelMd, color: colors.onSurfaceVariant, maxWidth: 130 },

  logout: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 52, borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.error },
  logoutText: { ...typography.labelLg, color: colors.error },
  version: { ...typography.bodySm, color: colors.outline, textAlign: "center" },
});
