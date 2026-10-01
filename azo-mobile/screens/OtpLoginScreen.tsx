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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import Svg, { Rect } from "react-native-svg";
import * as SecureStore from "expo-secure-store";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import PrimaryButton from "../components/PrimaryButton";
import { authApi, errorMessage } from "../services/api";

type Step = "phone" | "code";
type ProfileRole = "CLIENT" | "DRIVER" | "AGENCY";

type Props = {
  onVerified: (role: string) => void;
  onBack: () => void;
};

export default function OtpLoginScreen({ onVerified, onBack }: Props) {
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState(["", "", "", ""]);
  const [sending, setSending] = useState(false);
  const [profile, setProfile] = useState<ProfileRole>("CLIENT");
  const inputsRef = useRef<Array<TextInput | null>>([]);

  const isPhoneValid = phone.replace(/\D/g, "").length >= 8;

  async function handleSendCode() {
    if (!isPhoneValid) return;
    setSending(true);
    try {
      await authApi.requestOtp(phone.replace(/\D/g, ""));
      setCode(["", "", "", ""]);
      setStep("code");
    } catch (e) {
      // Sans code envoyé, l'étape suivante ne sert à rien : on prévient et on reste ici.
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
      const response = await authApi.verifyOtp(phone.replace(/\D/g, ""), fullCode, profile);

      await SecureStore.setItemAsync("userToken", response.token);

      // Le rôle qui compte est celui du serveur : il est signé dans le jeton JWT.
      // (Le profil choisi n'est appliqué qu'à la création du compte ; sinon c'est le rôle existant.)
      const role = String(response.user.role || "CLIENT").toUpperCase().trim();
      await SecureStore.setItemAsync("userRole", role);

      // Déclenchement de la redirection dans App.tsx
      onVerified(role);
    } catch (e) {
      // Code faux, expiré, ou serveur injoignable : on NE connecte PAS l'utilisateur.
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
        <View style={styles.content}>
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
              <Text style={styles.countryText}>BÉNIN (+229)</Text>
            </View>
          </View>

          <View style={styles.headerBlock}>
            <Text style={styles.brand}>AZƆ̀</Text>
            <Text style={styles.headline}>
              {step === "phone" ? "Bienvenue sur AZƆ̀" : "Vérifie ton téléphone"}
            </Text>
            <Text style={styles.subtitle}>
              {step === "phone"
                ? "Entre ton numéro pour recevoir ton code de vérification instantané par SMS ou WhatsApp."
                : `Code envoyé au +229 ${phone || "•• •• •• ••"}`}
            </Text>
          </View>

          {step === "phone" && (
            <View style={styles.profileRow}>
              {(
                [
                  ["CLIENT", "Client"],
                  ["DRIVER", "Conducteur"],
                  ["AGENCY", "Agence"],
                ] as const
              ).map(([id, label]) => (
                <Pressable
                  key={id}
                  onPress={() => setProfile(id as ProfileRole)}
                  style={[styles.profileChip, profile === id && styles.profileChipActive]}
                >
                  <Text style={[styles.profileText, profile === id && styles.profileTextActive]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {step === "phone" ? (
            <View style={styles.card}>
              <Text style={styles.label}>Numéro de mobile</Text>
              <View style={styles.phoneRow}>
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
                  placeholder="97 00 00 42"
                  placeholderTextColor={colors.outline}
                  keyboardType="phone-pad"
                  value={phone}
                  onChangeText={setPhone}
                  maxLength={12}
                />
                {isPhoneValid && (
                  <MaterialIcons name="check-circle" size={22} color={colors.primary} />
                )}
              </View>

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
                  ref={(el) => { inputsRef.current[i] = el; }}
                  style={[styles.codeBox, digit ? styles.codeBoxFilled : null]}
                  keyboardType="number-pad"
                  maxLength={1}
                  value={digit}
                  onChangeText={(v) => updateDigit(v, i)}
                />
              ))}
            </View>
          )}

          <View style={{ flex: 1 }} />

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
        </View>
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
  content: { flex: 1, padding: spacing.md },
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
  headerBlock: { alignItems: "center", marginTop: spacing.md, marginBottom: spacing.lg },
  brand: { ...typography.headlineLg, color: colors.primary, fontWeight: "800", marginBottom: spacing.xs },
  headline: { ...typography.headlineXl, color: colors.onSurface, textAlign: "center" },
  subtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    textAlign: "center",
    marginTop: spacing.xs,
    maxWidth: 300,
  },
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.md,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  label: { ...typography.labelMd, color: colors.onSurfaceVariant, marginBottom: spacing.xs },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 54,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceContainerLow,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
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
  phoneInput: { flex: 1, ...typography.headlineSm, color: colors.onSurface, paddingHorizontal: 4 },
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
  profileRow: { flexDirection: "row", gap: spacing.xs, marginBottom: spacing.sm },
  profileChip: {
    flex: 1,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: "center",
    justifyContent: "center",
  },
  profileChipActive: { backgroundColor: colors.primary },
  profileText: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  profileTextActive: { color: "#fff" },
  resend: { alignSelf: "center", marginTop: spacing.md },
  resendText: { ...typography.labelMd, color: colors.primary, fontWeight: "700" },
});
