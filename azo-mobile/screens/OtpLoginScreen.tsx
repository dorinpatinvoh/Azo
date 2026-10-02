import React, { useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import Svg, { Rect } from "react-native-svg";
import * as SecureStore from "expo-secure-store";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import PrimaryButton from "../components/PrimaryButton";
import { ProfileRole, ProviderRef, authApi, errorMessage } from "../services/api";
import {
  BENIN_PHONE_LENGTH,
  cleanBeninDigits,
  formatBeninPhoneInput,
  isValidBeninPhone,
} from "../utils/phone";

type Step = "phone" | "code";

type Props = {
  // `provider` = le dossier prestataire ouvert par le profil choisi (null si simple client).
  onVerified: (role: string, provider?: ProviderRef | null) => void;
  onBack: () => void;
};

const PROFILES: { id: ProfileRole; label: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { id: "CLIENT", label: "Client", icon: "person" },
  { id: "DRIVER", label: "Zem / Chauffeur", icon: "two-wheeler" },
  { id: "COURIER", label: "Coursier / Livreur", icon: "local-shipping" },
  { id: "AGENCY", label: "Agence", icon: "apartment" },
];

export default function OtpLoginScreen({ onVerified, onBack }: Props) {
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState(["", "", "", ""]);
  const [sending, setSending] = useState(false);
  const [profile, setProfile] = useState<ProfileRole>("CLIENT");
  const inputsRef = useRef<Array<TextInput | null>>([]);

  const digits = cleanBeninDigits(phone);
  const isPhoneValid = isValidBeninPhone(digits);
  const needsPrefix01 = digits.length > 0 && !digits.startsWith("01");

  function handlePhoneChange(raw: string) {
    setPhone(formatBeninPhoneInput(raw));
  }

  function handleAddPrefix01() {
    const withoutPrefix = digits.replace(/^01/, "").slice(0, 8);
    setPhone(formatBeninPhoneInput(`01${withoutPrefix}`));
  }

  async function handleSendCode() {
    if (!isPhoneValid) {
      Alert.alert(
        "Numéro à 10 chiffres requis",
        "Au Bénin (+229), entre les 10 chiffres commençant par 01 (ex. 01 97 00 00 42)."
      );
      return;
    }
    setSending(true);
    try {
      await authApi.requestOtp(digits);
      setCode(["", "", "", ""]);
      setStep("code");
    } catch (e) {
      Alert.alert("Envoi impossible", errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  async function handleVerify() {
    const fullCode = code.join("");
    if (fullCode.length < 4) return;
    setSending(true);

    try {
      const response = await authApi.verifyOtp(digits, fullCode, profile);

      await SecureStore.setItemAsync("userToken", response.token);

      const role = String(response.user.role || "CLIENT").toUpperCase().trim();
      await SecureStore.setItemAsync("userRole", role);

      const provider = response.provider ?? null;
      await SecureStore.setItemAsync("providerStatus", provider?.status ?? "");
      await SecureStore.setItemAsync("providerType", provider?.type ?? "");

      onVerified(role, provider);
    } catch (e) {
      Alert.alert("Connexion impossible", errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  function updateDigit(value: string, index: number) {
    const next = [...code];
    next[index] = value.replace(/\D/g, "").slice(-1);
    setCode(next);
    if (value && index < 3) inputsRef.current[index + 1]?.focus();
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topRow}>
            <Pressable
              onPress={step === "phone" ? onBack : () => setStep("phone")}
              style={styles.iconButton}
              accessibilityLabel="Retour"
            >
              <MaterialIcons name="arrow-back" size={20} color={colors.onSurface} />
            </Pressable>
            <View style={styles.countryPill}>
              <View style={styles.liveDot} />
              <Text style={styles.countryText}>BÉNIN (+229 · 10 CHIFFRES)</Text>
            </View>
          </View>

          <View style={styles.headerBlock}>
            <Text style={styles.brand}>AZƆ̀</Text>
            <Text style={styles.headline}>
              {step === "phone" ? "Bienvenue sur AZƆ̀" : "Vérifie ton téléphone"}
            </Text>
            <Text style={styles.subtitle}>
              {step === "phone"
                ? "Entre ton numéro béninois à 10 chiffres (01 + 8 chiffres) pour recevoir ton code SMS."
                : `Code à 4 chiffres envoyé au +229 ${phone || "01 •• •• •• ••"}`}
            </Text>
          </View>

          {step === "phone" && (
            <View style={styles.profileGrid}>
              {PROFILES.map((p) => {
                const active = profile === p.id;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => setProfile(p.id)}
                    style={[styles.profileChip, active && styles.profileChipActive]}
                  >
                    <MaterialIcons
                      name={p.icon}
                      size={16}
                      color={active ? "#fff" : colors.onSurfaceVariant}
                    />
                    <Text
                      style={[styles.profileText, active && styles.profileTextActive]}
                      numberOfLines={1}
                    >
                      {p.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          {step === "phone" && profile !== "CLIENT" && (
            <View style={styles.profileHint}>
              <MaterialIcons name="shield" size={16} color={colors.primary} />
              <Text style={styles.profileHintText}>
                {profile === "DRIVER"
                  ? "Zem / Conducteur indépendant : tu déposeras un dossier (identité, véhicule, photos) validé par un administrateur AZƆ̀."
                  : profile === "COURIER"
                    ? "Coursier / Coursier personnel / Livreur : dépose ton dossier (identité, moto/véhicule, photos) pour activer tes missions."
                    : "Agence : dépose le dossier de ta flotte (raison sociale, formule, pièces) pour validation par un administrateur AZƆ̀."}
              </Text>
            </View>
          )}

          {step === "phone" ? (
            <View style={styles.card}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>Numéro de mobile (10 chiffres)</Text>
                <Text style={styles.digitCount}>
                  {digits.length}/{BENIN_PHONE_LENGTH}
                </Text>
              </View>

              <View style={[styles.phoneRow, isPhoneValid && styles.phoneRowValid]}>
                <View style={styles.flagBadge}>
                  <Svg width={20} height={14} viewBox="0 0 450 300">
                    <Rect fill="#008751" width="180" height="300" />
                    <Rect fill="#FCD116" x="180" width="270" height="150" />
                    <Rect fill="#E8112D" x="180" y="150" width="270" height="150" />
                  </Svg>
                  <Text style={styles.flagCode}>+229</Text>
                </View>
                <TextInput
                  style={styles.phoneInput}
                  placeholder="01 97 00 00 42"
                  placeholderTextColor={colors.outline}
                  keyboardType="phone-pad"
                  value={phone}
                  onChangeText={handlePhoneChange}
                  maxLength={14}
                />
                {isPhoneValid && (
                  <MaterialIcons name="check-circle" size={22} color={colors.primary} />
                )}
              </View>

              {needsPrefix01 ? (
                <Pressable style={styles.prefixHelper} onPress={handleAddPrefix01}>
                  <MaterialIcons name="auto-fix-high" size={15} color={colors.primary} />
                  <Text style={styles.prefixHelperText}>
                    Le numéro doit commencer par 01 — appuyer pour préfixer en 01
                  </Text>
                </Pressable>
              ) : (
                <Text style={styles.formatHint}>
                  Plan national Bénin : <Text style={{ fontWeight: "700" }}>01</Text> suivi des 8 chiffres de ton numéro
                </Text>
              )}

              <View style={styles.operatorsRow}>
                <Text style={styles.operatorsLabel}>Réseaux certifiés :</Text>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <OperatorPill label="MTN" bg={colors.tertiaryFixed} fg={colors.onTertiaryFixed} />
                  <OperatorPill label="Moov" bg={colors.secondaryFixed} fg={colors.onSecondaryFixed} />
                  <OperatorPill label="Celtiis" bg={colors.primaryFixed} fg={colors.onPrimaryFixed} />
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.codeRow}>
              {code.map((digit, i) => (
                <TextInput
                  key={i}
                  ref={(el) => {
                    inputsRef.current[i] = el;
                  }}
                  style={[styles.codeBox, digit ? styles.codeBoxFilled : null]}
                  keyboardType="number-pad"
                  maxLength={1}
                  value={digit}
                  onChangeText={(v) => updateDigit(v, i)}
                />
              ))}
            </View>
          )}

          <View style={{ flex: 1, minHeight: spacing.lg }} />

          <PrimaryButton
            label={step === "phone" ? "Recevoir mon code" : "Vérifier et continuer"}
            onPress={step === "phone" ? handleSendCode : handleVerify}
            loading={sending}
            disabled={step === "phone" ? !isPhoneValid : code.join("").length < 4}
            icon={step === "phone" ? "sms" : "check"}
          />

          {step === "code" && (
            <Pressable style={styles.resend} onPress={handleSendCode}>
              <Text style={styles.resendText}>Renvoyer le code</Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function OperatorPill({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View style={[styles.operatorPill, { backgroundColor: bg }]}>
      <Text style={[styles.operatorText, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, padding: spacing.md },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: "center",
    justifyContent: "center",
  },
  countryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surfaceContainerLow,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.secondary },
  countryText: { ...typography.labelSm, color: colors.onSurface, fontWeight: "700" },
  headerBlock: { alignItems: "center", marginTop: spacing.md, marginBottom: spacing.md },
  brand: { ...typography.headlineLg, color: colors.primary, fontWeight: "800", marginBottom: spacing.xs },
  headline: { ...typography.headlineXl, color: colors.onSurface, textAlign: "center" },
  subtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    textAlign: "center",
    marginTop: spacing.xs,
    maxWidth: 320,
  },
  profileGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: spacing.sm,
  },
  profileChip: {
    width: "48.5%",
    height: 42,
    flexDirection: "row",
    gap: 6,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  profileChipActive: { backgroundColor: colors.primary },
  profileText: { ...typography.labelSm, color: colors.onSurface, fontWeight: "700" },
  profileTextActive: { color: "#fff" },
  profileHint: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    backgroundColor: colors.primaryFixed,
    borderRadius: radius.lg,
    padding: spacing.sm + 2,
    marginBottom: spacing.sm,
  },
  profileHintText: { ...typography.labelSm, color: colors.onPrimaryFixed, flex: 1, lineHeight: 18 },
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.md,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  label: { ...typography.labelMd, color: colors.onSurfaceVariant },
  digitCount: { ...typography.labelSm, color: colors.primary, fontWeight: "700" },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 54,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceContainerLow,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  phoneRowValid: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceContainerLowest,
  },
  flagBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surfaceContainerLowest,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.md,
  },
  flagCode: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  phoneInput: {
    flex: 1,
    ...typography.headlineSm,
    color: colors.onSurface,
    paddingHorizontal: 4,
    letterSpacing: 0.5,
  },
  prefixHelper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.primaryFixed,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 8,
  },
  prefixHelperText: { ...typography.labelSm, color: colors.primary, fontWeight: "700", flex: 1 },
  formatHint: { ...typography.labelSm, color: colors.onSurfaceVariant, marginTop: 8, paddingHorizontal: 2 },
  operatorsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.sm,
    paddingHorizontal: 4,
  },
  operatorsLabel: { ...typography.labelSm, color: colors.onSurfaceVariant },
  operatorPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full },
  operatorText: { fontSize: 10, fontWeight: "700" },
  codeRow: { flexDirection: "row", justifyContent: "center", gap: spacing.sm, marginTop: spacing.md },
  codeBox: {
    width: 56,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLow,
    textAlign: "center",
    ...typography.headlineLg,
    color: colors.onSurface,
  },
  codeBoxFilled: { borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.surfaceContainerLowest },
  resend: { alignSelf: "center", marginTop: spacing.md },
  resendText: { ...typography.labelMd, color: colors.primary, fontWeight: "700" },
});
