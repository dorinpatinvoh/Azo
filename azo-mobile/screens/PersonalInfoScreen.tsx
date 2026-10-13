import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { userApi, UserProfile } from "../services/api";
import LanguageSheet from "../components/LanguageSheet";
import Avatar from "../components/Avatar";
import AvatarSheet from "../components/AvatarSheet";
import { EmailSheet, EmergencySheet, IdentitySheet, PhoneChangeSheet } from "../components/EditProfileSheets";
import { useAvatar } from "../utils/avatar";
import { formatBeninPhoneDisplay } from "../utils/phone";
import { languageInfo, useI18n } from "../i18n";
import { displayName, initials } from "./ProfileScreen";

type Props = { onBack: () => void };

/** Drapeau du Bénin dessiné avec ses trois couleurs (vert, jaune, rouge). */
function BeninFlag() {
  return (
    <View style={styles.flag} accessibilityLabel="Bénin">
      <View style={{ flex: 2, backgroundColor: "#008751" }} />
      <View style={{ flex: 3 }}>
        <View style={{ flex: 1, backgroundColor: "#FCD116" }} />
        <View style={{ flex: 1, backgroundColor: "#E8112D" }} />
      </View>
    </View>
  );
}

type FieldProps = {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  value: string;
  /** Le champ n'est pas modifiable ici : on affiche un cadenas */
  locked?: boolean;
  right?: React.ReactNode;
  onPress?: () => void;
};

function Field({ icon, label, value, locked, right, onPress }: FieldProps) {
  const content = (
    <>
      <View style={styles.fieldIcon}>
        <MaterialIcons name={icon} size={20} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.fieldValue} numberOfLines={1}>{value}</Text>
      </View>
      {right}
      {locked && <MaterialIcons name="lock-outline" size={18} color={colors.outline} />}
      {onPress && <MaterialIcons name="chevron-right" size={22} color={colors.outline} />}
    </>
  );
  return onPress ? (
    <Pressable style={styles.field} onPress={onPress} accessibilityRole="button">{content}</Pressable>
  ) : (
    <View style={styles.field}>{content}</View>
  );
}

export default function PersonalInfoScreen({ onBack }: Props) {
  const insets = useSafeAreaInsets();
  const { t, lang, locale } = useI18n();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const avatarUri = useAvatar();

  useEffect(() => {
    userApi
      .me()
      .then(setUser)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  // Après un enregistrement, le serveur renvoie le profil à jour
  const applySaved = (next: UserProfile) => setUser((prev) => (prev ? { ...prev, ...next } : next));
  // Fenêtre de correction directe ouverte (une fois, 24 h après l'inscription) ; sinon : demande à l'équipe
  const identityDirect = !!user?.identityEditableUntil && Date.parse(user.identityEditableUntil) > Date.now();
  const identityPending = !!user?.identityCorrectionPending;
  const emergency = user?.emergencyContact;

  const registered = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" })
    : null;
  const unknown = t("profile.unknown");
  const genderLabel = user?.gender === "M" ? t("profile.gender.M") : user?.gender === "F" ? t("profile.gender.F") : unknown;

  return (
    <View style={styles.root}>
      {/* En-tête en dégradé : l'avatar le chevauche */}
      <StatusBar style="light" />
      <LinearGradient
        colors={[colors.onPrimaryFixed, colors.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, { paddingTop: insets.top + spacing.sm }]}
      >
        <Pressable style={styles.back} onPress={onBack} accessibilityRole="button" accessibilityLabel={t("common.back")}>
          <MaterialIcons name="arrow-back" size={24} color={colors.onPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>{t("profile.info.title")}</Text>
      </LinearGradient>

      <View style={styles.identityRow}>
        <Pressable onPress={() => setAvatarOpen(true)} accessibilityRole="button" accessibilityLabel={t("avatar.edit")}>
          <View style={styles.avatar}>
            <Avatar uri={avatarUri} initials={initials(user)} size={88} fontSize={30} />
          </View>
          <View style={styles.avatarBadge}>
            <MaterialIcons name="photo-camera" size={16} color={colors.onPrimary} />
          </View>
        </Pressable>
        <View style={{ flex: 1, paddingBottom: spacing.xs }}>
          <Text style={styles.name} numberOfLines={2}>{displayName(user) || unknown}</Text>
          {registered && <Text style={styles.registered}>{t("profile.info.registered", { date: registered })}</Text>}
        </View>
      </View>

      <SafeAreaView style={{ flex: 1 }} edges={["bottom"]}>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
        ) : (
          <ScrollView contentContainerStyle={styles.fields} showsVerticalScrollIndicator={false}>
            {failed && (
              <View style={styles.offline}>
                <MaterialIcons name="cloud-off" size={16} color={colors.tertiary} />
                <Text style={styles.offlineText}>{t("profile.offline")}</Text>
              </View>
            )}

            <Field icon="phone-iphone" label={t("profile.info.phone")} value={user ? formatBeninPhoneDisplay(user.phone) : unknown} onPress={() => setPhoneOpen(true)} />
            <Field icon="public" label={t("profile.info.country")} value={t("profile.info.countryValue")} right={<BeninFlag />} />
            <Field icon="mail-outline" label={t("pinfo.email")} value={user?.email || t("pinfo.notSet")} onPress={() => setEmailOpen(true)} />
            <Field
              icon="contact-phone"
              label={t("pinfo.emergency")}
              value={emergency ? `${emergency.name} · ${formatBeninPhoneDisplay(emergency.phone)}` : t("pinfo.notSet")}
              onPress={() => setEmergencyOpen(true)}
            />
            {identityPending && (
              <View style={styles.offline}>
                <MaterialIcons name="hourglass-top" size={16} color={colors.tertiary} />
                <Text style={styles.offlineText}>{t("pinfo.identityPending")}</Text>
              </View>
            )}
            <Field icon="badge" label={t("auth.field.firstName")} value={user?.firstName || unknown} locked={identityPending} onPress={identityPending ? undefined : () => setIdentityOpen(true)} />
            <Field icon="badge" label={t("auth.field.lastName")} value={user?.lastName || unknown} locked={identityPending} onPress={identityPending ? undefined : () => setIdentityOpen(true)} />
            <Field icon="wc" label={t("auth.field.gender")} value={genderLabel} locked={identityPending} onPress={identityPending ? undefined : () => setIdentityOpen(true)} />
            <Field icon="fingerprint" label={t("profile.info.npi")} value={user?.npiMasked || unknown} locked />
            <Field
              icon="translate"
              label={t("profile.menu.language")}
              value={`${languageInfo(lang).flag} ${languageInfo(lang).native}`}
              onPress={() => setLangOpen(true)}
            />

            <View style={styles.note}>
              <MaterialIcons name="info-outline" size={16} color={colors.onSurfaceVariant} />
              <Text style={styles.noteText}>{t("profile.info.note")}</Text>
            </View>
          </ScrollView>
        )}
      </SafeAreaView>

      <LanguageSheet visible={langOpen} onClose={() => setLangOpen(false)} />
      <AvatarSheet visible={avatarOpen} onClose={() => setAvatarOpen(false)} />
      <EmailSheet visible={emailOpen} onClose={() => setEmailOpen(false)} user={user} onSaved={applySaved} />
      <EmergencySheet visible={emergencyOpen} onClose={() => setEmergencyOpen(false)} user={user} onSaved={applySaved} />
      <IdentitySheet visible={identityOpen} onClose={() => setIdentityOpen(false)} user={user} onSaved={applySaved} direct={identityDirect} />
      <PhoneChangeSheet visible={phoneOpen} onClose={() => setPhoneOpen(false)} user={user} onSaved={applySaved} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.md, paddingBottom: 64, gap: spacing.sm },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: `${colors.onPrimary}26`, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...typography.headlineLg, color: colors.onPrimary },
  // L'avatar remonte de 48 px sur l'en-tête (chevauchement)
  identityRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.md, paddingHorizontal: spacing.md, marginTop: -48, marginBottom: spacing.md },
  avatarBadge: { position: "absolute", right: 0, bottom: 2, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.background },
  avatar: { width: 96, height: 96, borderRadius: 48, overflow: "hidden", backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center", borderWidth: 4, borderColor: colors.background },
  avatarText: { ...typography.displayLgMobile, color: colors.primary },
  name: { ...typography.headlineSm, color: colors.onSurface },
  registered: { ...typography.bodySm, color: colors.onSurfaceVariant, marginTop: 2 },
  fields: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
  field: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 2, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.surfaceContainer, paddingHorizontal: spacing.md, minHeight: 66 },
  fieldIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center" },
  fieldLabel: { ...typography.bodySm, color: colors.onSurfaceVariant },
  fieldValue: { ...typography.labelLg, color: colors.onSurface, marginTop: 1 },
  flag: { width: 34, height: 22, borderRadius: 4, overflow: "hidden", flexDirection: "row" },
  offline: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.tertiaryFixed, borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 8 },
  offlineText: { ...typography.labelSm, color: colors.tertiary, flex: 1 },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: colors.surfaceContainer, borderRadius: radius.lg, padding: spacing.sm + 2, marginTop: spacing.xs },
  noteText: { ...typography.bodySm, color: colors.onSurfaceVariant, flex: 1 },
});
