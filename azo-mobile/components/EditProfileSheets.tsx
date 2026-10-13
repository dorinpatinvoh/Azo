import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import * as SecureStore from "expo-secure-store";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { UserProfile, errorMessage, isRouteMissing, setToken, userApi } from "../services/api";
import { cleanBeninDigits, formatBeninPhoneDisplay, formatBeninPhoneInput, isValidBeninPhone, toBeninE164 } from "../utils/phone";
import { GENDER_OPTIONS, isValidName, normalizeName, type Gender } from "../utils/registration";
import { useI18n } from "../i18n";

type SheetProps = { visible: boolean; onClose: () => void; user: UserProfile | null; onSaved: (user: UserProfile) => void };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Cadre commun : feuille qui monte du bas, remonte avec le clavier, se ferme en touchant le fond. */
function Frame({ visible, onClose, title, hint, children }: { visible: boolean; onClose: () => void; title: string; hint?: string; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t("common.close")} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>{title}</Text>
            {!!hint && <Text style={styles.hint}>{hint}</Text>}
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Input({ label, ...props }: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={{ marginTop: spacing.sm }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor={colors.outline} {...props} />
    </View>
  );
}

function Primary({ label, onPress, busy, disabled }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <Pressable style={[styles.primary, (busy || disabled) && { opacity: 0.55 }]} onPress={onPress} disabled={busy || disabled} accessibilityRole="button">
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{label}</Text>}
    </Pressable>
  );
}

/** Erreur de l'enregistrement : « pas encore disponible » si la route manque, sinon le message du serveur. */
function useFail() {
  const { t } = useI18n();
  return (e: unknown) => Alert.alert(t("common.error"), isRouteMissing(e) ? t("edit.unavailable") : errorMessage(e));
}

/* ---------------------------------------------------------------- e-mail */
export function EmailSheet({ visible, onClose, user, onSaved }: SheetProps) {
  const { t } = useI18n();
  const fail = useFail();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (visible) setValue(user?.email ?? ""); }, [visible, user?.email]);

  const clean = value.trim().toLowerCase();
  const invalid = clean.length > 0 && !EMAIL_PATTERN.test(clean);

  async function save() {
    if (invalid) return;
    setBusy(true);
    try {
      onSaved(await userApi.updateProfile({ email: clean || null }));
      onClose();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Frame visible={visible} onClose={onClose} title={t("edit.email.title")} hint={t("edit.email.hint")}>
      <Input label={t("pinfo.email")} value={value} onChangeText={setValue} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="nom@exemple.com" />
      {invalid && <Text style={styles.error}>{t("edit.email.invalid")}</Text>}
      <Primary label={t("common.save")} onPress={save} busy={busy} disabled={invalid} />
    </Frame>
  );
}

/* ---------------------------------------------------------------- contact d'urgence */
export function EmergencySheet({ visible, onClose, user, onSaved }: SheetProps) {
  const { t } = useI18n();
  const fail = useFail();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setName(user?.emergencyContact?.name ?? "");
    setPhone(user?.emergencyContact?.phone ? formatBeninPhoneInput(user.emergencyContact.phone) : "");
  }, [visible, user?.emergencyContact?.name, user?.emergencyContact?.phone]);

  const own = !!user?.phone && cleanBeninDigits(user.phone) === cleanBeninDigits(phone);
  const valid = isValidName(name) && isValidBeninPhone(phone);

  async function save(remove = false) {
    if (!remove && (!valid || own)) return;
    setBusy(true);
    try {
      onSaved(
        await userApi.updateProfile({
          emergencyContact: remove ? null : { name: normalizeName(name), phone: cleanBeninDigits(phone) },
        })
      );
      onClose();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Frame visible={visible} onClose={onClose} title={t("edit.emergency.title")} hint={t("edit.emergency.hint")}>
      <Input label={t("edit.emergency.name")} value={name} onChangeText={setName} autoCapitalize="words" maxLength={50} />
      <Input label={t("edit.emergency.phone")} value={phone} onChangeText={(v) => setPhone(formatBeninPhoneInput(v))} keyboardType="phone-pad" placeholder="01 XX XX XX XX" />
      {own ? (
        <Text style={styles.error}>{t("edit.emergency.same")}</Text>
      ) : (name.length > 0 || phone.length > 0) && !valid ? (
        <Text style={styles.error}>{t("edit.emergency.invalid")}</Text>
      ) : null}
      <Primary label={t("common.save")} onPress={() => save(false)} busy={busy} disabled={!valid || own} />
      {!!user?.emergencyContact && (
        <Pressable style={styles.link} onPress={() => save(true)} disabled={busy}>
          <Text style={styles.linkDanger}>{t("edit.emergency.remove")}</Text>
        </Pressable>
      )}
    </Frame>
  );
}

/* ---------------------------------------------------------------- nom, prénom, sexe */
/**
 * `direct` = la fenêtre de correction est ouverte (une seule fois, 24 h après l'inscription) :
 * l'enregistrement est immédiat. Sinon c'est une DEMANDE vérifiée par l'équipe AZƆ̀, avec un motif.
 */
export function IdentitySheet({ visible, onClose, user, onSaved, direct }: SheetProps & { direct: boolean }) {
  const { t, locale } = useI18n();
  const fail = useFail();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setFirstName(user?.firstName ?? "");
    setLastName(user?.lastName ?? "");
    setGender(user?.gender ?? null);
    setReason("");
  }, [visible, user?.firstName, user?.lastName, user?.gender]);

  const changes = {
    ...(normalizeName(firstName) !== (user?.firstName ?? "") ? { firstName: normalizeName(firstName) } : {}),
    ...(normalizeName(lastName) !== (user?.lastName ?? "") ? { lastName: normalizeName(lastName) } : {}),
    ...(gender && gender !== user?.gender ? { gender } : {}),
  };
  const nothing = Object.keys(changes).length === 0;
  const namesOk = isValidName(firstName) && isValidName(lastName) && !!gender;
  const reasonOk = direct || reason.trim().length >= 10;
  const until = user?.identityEditableUntil
    ? new Date(user.identityEditableUntil).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";

  async function save() {
    if (nothing || !namesOk || !reasonOk) return;
    setBusy(true);
    try {
      if (direct) {
        onSaved(await userApi.correctIdentity(changes));
        Alert.alert(t("edit.saved"));
      } else {
        await userApi.requestIdentityCorrection({ ...changes, reason: reason.trim() });
        Alert.alert(t("edit.identity.sent"));
      }
      onClose();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Frame
      visible={visible}
      onClose={onClose}
      title={t("edit.identity.title")}
      hint={direct ? t("edit.identity.direct", { date: until }) : t("edit.identity.request")}
    >
      <Input label={t("auth.field.firstName")} value={firstName} onChangeText={setFirstName} autoCapitalize="words" maxLength={50} />
      <Input label={t("auth.field.lastName")} value={lastName} onChangeText={setLastName} autoCapitalize="words" maxLength={50} />
      <Text style={[styles.label, { marginTop: spacing.sm }]}>{t("auth.field.gender")}</Text>
      <View style={styles.chips}>
        {GENDER_OPTIONS.map((option) => {
          const active = gender === option.value;
          return (
            <Pressable key={option.value} style={[styles.chip, active && styles.chipActive]} onPress={() => setGender(option.value)} accessibilityRole="button">
              <MaterialIcons name={option.icon} size={18} color={active ? colors.onPrimary : colors.primary} />
              <Text style={[styles.chipText, active && { color: colors.onPrimary }]}>{t(option.labelKey)}</Text>
            </Pressable>
          );
        })}
      </View>
      {!direct && (
        <Input label={t("edit.identity.reason")} value={reason} onChangeText={setReason} multiline maxLength={300} style={[styles.input, { height: 90, textAlignVertical: "top" }]} />
      )}
      {nothing ? <Text style={styles.hintSmall}>{t("edit.identity.noChange")}</Text> : !reasonOk ? <Text style={styles.hintSmall}>{t("edit.identity.reasonShort")}</Text> : null}
      <Primary label={direct ? t("common.save") : t("edit.identity.send")} onPress={save} busy={busy} disabled={nothing || !namesOk || !reasonOk} />
    </Frame>
  );
}

/* ---------------------------------------------------------------- numéro de téléphone (code SMS) */
export function PhoneChangeSheet({ visible, onClose, user, onSaved }: SheetProps) {
  const { t } = useI18n();
  const fail = useFail();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (visible) { setStep("phone"); setPhone(""); setCode(""); } }, [visible]);

  const same = !!user?.phone && cleanBeninDigits(user.phone) === cleanBeninDigits(phone);
  const validPhone = isValidBeninPhone(phone) && !same;

  async function sendCode() {
    if (!validPhone) return;
    setBusy(true);
    try {
      await userApi.requestPhoneChange(toBeninE164(phone));
      setStep("code");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    const clean = code.replace(/\D/g, "");
    if (clean.length < 4) return;
    setBusy(true);
    try {
      const result = await userApi.confirmPhoneChange(clean);
      // Si le serveur réémet un jeton (le numéro en faisait partie), on le garde pour la suite
      if (result.token) {
        setToken(result.token);
        await SecureStore.setItemAsync("userToken", result.token).catch(() => undefined);
      }
      onSaved(result);
      Alert.alert(t("edit.phone.done"));
      onClose();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Frame visible={visible} onClose={onClose} title={t("edit.phone.title")} hint={step === "phone" ? t("edit.phone.hint") : t("edit.phone.sentTo", { phone: formatBeninPhoneDisplay(toBeninE164(phone)) })}>
      {step === "phone" ? (
        <>
          <Input label={t("edit.phone.new")} value={phone} onChangeText={(v) => setPhone(formatBeninPhoneInput(v))} keyboardType="phone-pad" placeholder="01 XX XX XX XX" />
          {phone.length > 0 && !validPhone && <Text style={styles.error}>{t("edit.phone.invalid")}</Text>}
          <Primary label={t("edit.phone.sendCode")} onPress={sendCode} busy={busy} disabled={!validPhone} />
        </>
      ) : (
        <>
          <Input label={t("edit.phone.code")} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" maxLength={6} />
          {code.length > 0 && code.length < 4 && <Text style={styles.error}>{t("edit.phone.codeInvalid")}</Text>}
          <Primary label={t("edit.phone.confirm")} onPress={confirm} busy={busy} disabled={code.length < 4} />
          <Pressable style={styles.link} onPress={() => setStep("phone")} disabled={busy}>
            <Text style={styles.linkText}>{t("common.back")}</Text>
          </Pressable>
        </>
      )}
    </Frame>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(20, 0, 35, 0.55)" },
  sheet: {
    maxHeight: "90%",
    backgroundColor: colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  handle: { alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: colors.outlineVariant, marginBottom: spacing.md },
  title: { ...typography.headlineMd, color: colors.onSurface },
  hint: { ...typography.bodyMd, color: colors.onSurfaceVariant, marginTop: 2 },
  hintSmall: { ...typography.bodySm, color: colors.onSurfaceVariant, marginTop: spacing.xs },
  label: { ...typography.labelMd, color: colors.onSurfaceVariant, marginBottom: 4 },
  input: { height: 50, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.outlineVariant, backgroundColor: colors.surfaceContainerLowest, paddingHorizontal: spacing.md, ...typography.bodyLg, color: colors.onSurface },
  error: { ...typography.bodySm, color: colors.error, marginTop: spacing.xs },
  primary: { height: 52, borderRadius: radius.full, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", marginTop: spacing.md },
  primaryText: { ...typography.labelLg, color: "#fff", fontWeight: "800" },
  link: { alignItems: "center", justifyContent: "center", height: 44, marginTop: spacing.xs },
  linkText: { ...typography.labelLg, color: colors.primary, fontWeight: "700" },
  linkDanger: { ...typography.labelLg, color: colors.error, fontWeight: "700" },
  chips: { flexDirection: "row", gap: spacing.sm },
  chip: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 46, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.outlineVariant, backgroundColor: colors.surfaceContainerLowest },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
});
