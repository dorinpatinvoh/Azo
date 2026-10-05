import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import Svg, { Rect } from "react-native-svg";
import * as SecureStore from "expo-secure-store";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import PrimaryButton from "../components/PrimaryButton";
import {
  DEFAULT_API_URL,
  ProviderRef,
  authApi,
  errorMessage,
  getApiUrl,
  setApiUrl,
} from "../services/api";
import {
  BENIN_PHONE_LENGTH,
  cleanBeninDigits,
  formatBeninPhoneInput,
  isValidBeninPhone,
  toBeninE164,
} from "../utils/phone";

type Step = "phone" | "code";

type Props = {
  onVerified: (role: string, provider?: ProviderRef | null) => void;
  onBack: () => void;
};

const SMS_BANNER_DURATION_SEC = 5;

export default function OtpLoginScreen({ onVerified, onBack }: Props) {
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState(["", "", "", ""]);
  const [sending, setSending] = useState(false);
  const inputsRef = useRef<Array<TextInput | null>>([]);

  // Bannière SMS simulée (affichée 5 secondes puis disparaît automatiquement)
  const [simulatedOtp, setSimulatedOtp] = useState<string | null>(null);
  const [bannerSecondsLeft, setBannerSecondsLeft] = useState<number>(0);
  const bannerAnim = useRef(new Animated.Value(-140)).current;

  // Modale discrète pour configurer l'URL du serveur (Render / IP locale)
  const [serverModalOpen, setServerModalOpen] = useState(false);
  const [serverUrlDraft, setServerUrlDraft] = useState(getApiUrl());

  const digits = cleanBeninDigits(phone);
  const isPhoneValid = isValidBeninPhone(digits);

  function triggerSimulatedSmsBanner(otpCode: string) {
    setSimulatedOtp(otpCode);
    setBannerSecondsLeft(SMS_BANNER_DURATION_SEC);
    Animated.spring(bannerAnim, {
      toValue: 0,
      useNativeDriver: true,
      speed: 14,
      bounciness: 6,
    }).start();
  }

  useEffect(() => {
    if (!simulatedOtp) return;
    const interval = setInterval(() => {
      setBannerSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          Animated.timing(bannerAnim, {
            toValue: -150,
            duration: 250,
            useNativeDriver: true,
          }).start(() => setSimulatedOtp(null));
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [simulatedOtp, bannerAnim]);

  function handlePhoneChange(raw: string) {
    setPhone(formatBeninPhoneInput(raw));
  }

  async function handleSendCode() {
    if (!isPhoneValid) {
      Alert.alert(
        "Numéro à 10 chiffres requis",
        "Entre les 10 chiffres commençant par 01 (ex. 01 XX XX XX XX)."
      );
      return;
    }
    setSending(true);
    try {
      const normalized = toBeninE164(digits);
      const res = await authApi.requestOtp(normalized);
      setCode(["", "", "", ""]);
      setStep("code");
      if (res?.otpCode) {
        triggerSimulatedSmsBanner(res.otpCode);
      }
      setTimeout(() => inputsRef.current[0]?.focus(), 150);
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
      const normalized = toBeninE164(digits);
      const response = await authApi.verifyOtp(normalized, fullCode);

      await SecureStore.setItemAsync("userToken", response.token);

      const role = String(response.user.role || "CLIENT").toUpperCase().trim();
      await SecureStore.setItemAsync("userRole", role);

      const provider = response.provider ?? null;
      if (provider?.status) {
        await SecureStore.setItemAsync("providerStatus", provider.status);
        await SecureStore.setItemAsync("providerType", provider.type);
      } else {
        await SecureStore.deleteItemAsync("providerStatus");
        await SecureStore.deleteItemAsync("providerType");
      }

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

  function fillOtpFromBanner(otpCode: string) {
    const chars = otpCode.slice(0, 4).split("");
    if (chars.length === 4) {
      setCode(chars);
    }
  }

  async function saveCustomServerUrl() {
    const trimmed = serverUrlDraft.trim();
    setApiUrl(trimmed || null);
    try {
      if (trimmed) {
        await SecureStore.setItemAsync("customApiUrl", trimmed);
      } else {
        await SecureStore.deleteItemAsync("customApiUrl");
      }
    } catch {
      // ignore
    }
    setServerUrlDraft(getApiUrl());
    setServerModalOpen(false);
    Alert.alert("Serveur configuré", `Connecté à :\n${getApiUrl()}`);
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      {/* Bannière SMS simulée : apparaît 5 secondes puis disparaît automatiquement */}
      {simulatedOtp ? (
        <Animated.View
          style={[
            styles.smsBanner,
            { transform: [{ translateY: bannerAnim }] },
          ]}
        >
          <Pressable
            style={styles.smsBannerInner}
            onPress={() => fillOtpFromBanner(simulatedOtp)}
          >
            <View style={styles.smsIconWrap}>
              <MaterialIcons name="sms" size={22} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.smsTopRow}>
                <Text style={styles.smsSender}>SMS · AZƆ̀ Bénin</Text>
                <View style={styles.smsTimerPill}>
                  <Text style={styles.smsTimerText}>{bannerSecondsLeft}s</Text>
                </View>
              </View>
              <Text style={styles.smsBody}>
                Code de vérification AZƆ̀ :{" "}
                <Text style={styles.smsCodeHighlight}>{simulatedOtp}</Text>
              </Text>
              <Text style={styles.smsTapHint}>Touche pour remplir automatiquement</Text>
            </View>
          </Pressable>
        </Animated.View>
      ) : null}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* En-tête épuré : flèche retour à gauche, rien qui encombre à droite */}
          <View style={styles.topRow}>
            <Pressable
              onPress={step === "phone" ? onBack : () => setStep("phone")}
              style={styles.iconButton}
              accessibilityLabel="Retour"
            >
              <MaterialIcons name="arrow-back" size={20} color={colors.onSurface} />
            </Pressable>
            <Pressable
              onPress={() => {
                setServerUrlDraft(getApiUrl());
                setServerModalOpen(true);
              }}
              style={styles.iconButton}
              accessibilityLabel="Paramètres serveur"
            >
              <MaterialIcons name="tune" size={19} color={colors.onSurfaceVariant} />
            </Pressable>
          </View>

          {/* Titre aéré (sans le sous-titre sur l'étape téléphone) */}
          <View style={styles.headerBlock}>
            <Pressable
              onLongPress={() => {
                setServerUrlDraft(getApiUrl());
                setServerModalOpen(true);
              }}
            >
              <Text style={styles.brand}>AZƆ̀</Text>
            </Pressable>
            <Text style={styles.headline}>
              {step === "phone" ? "Bienvenue sur AZƆ̀" : "Vérifie ton téléphone"}
            </Text>
            {step === "code" ? (
              <Text style={styles.subtitle}>
                Code à 4 chiffres envoyé au +229 {phone || "01 •• •• •• ••"}
              </Text>
            ) : null}
          </View>

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
                  placeholder="01 XX XX XX XX"
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

          <View style={{ flex: 1, minHeight: spacing.xl }} />

          <PrimaryButton
            label={step === "phone" ? "Recevoir mon code" : "Vérifier et continuer"}
            onPress={step === "phone" ? handleSendCode : handleVerify}
            loading={sending}
            disabled={step === "phone" ? !isPhoneValid : code.join("").length < 4}
            icon={step === "phone" ? "sms" : "check"}
          />

          {step === "code" && (
            <Pressable style={styles.resend} onPress={handleSendCode}>
              <Text style={styles.resendText}>Renvoyer le code (5s)</Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Modale de configuration Serveur (Render / IP) & accès rapide Admin */}
      <Modal
        visible={serverModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setServerModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Connexion au serveur AZƆ̀</Text>
            <Text style={styles.modalHint}>
              Colle ici ton adresse Render (ex. https://azo-backend.onrender.com) ou l'IP locale de
              ton ordinateur.
            </Text>
            <TextInput
              style={styles.modalInput}
              value={serverUrlDraft}
              onChangeText={setServerUrlDraft}
              placeholder={DEFAULT_API_URL}
              placeholderTextColor={colors.outline}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Pressable
              style={styles.adminQuickBtn}
              onPress={() => {
                setPhone("01 97 00 00 00");
                setServerModalOpen(false);
              }}
            >
              <MaterialIcons name="admin-panel-settings" size={18} color={colors.primary} />
              <Text style={styles.adminQuickText}>
                Se connecter en Administrateur (01 97 00 00 00)
              </Text>
            </Pressable>
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancelBtn}
                onPress={() => setServerUrlDraft(DEFAULT_API_URL)}
              >
                <Text style={styles.modalCancelText}>Par défaut</Text>
              </Pressable>
              <Pressable
                style={styles.modalCancelBtn}
                onPress={() => setServerModalOpen(false)}
              >
                <Text style={styles.modalCancelText}>Fermer</Text>
              </Pressable>
              <Pressable style={styles.modalSaveBtn} onPress={saveCustomServerUrl}>
                <Text style={styles.modalSaveText}>Enregistrer</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  headerBlock: { alignItems: "center", marginTop: spacing.lg, marginBottom: spacing.xl },
  brand: {
    ...typography.headlineLg,
    color: colors.primary,
    fontWeight: "800",
    marginBottom: spacing.xs,
  },
  headline: { ...typography.headlineXl, color: colors.onSurface, textAlign: "center" },
  subtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    textAlign: "center",
    marginTop: spacing.xs,
    maxWidth: 320,
  },

  // Bannière SMS simulée (5 secondes)
  smsBanner: {
    position: "absolute",
    top: Platform.OS === "ios" ? 54 : 16,
    left: spacing.md,
    right: spacing.md,
    zIndex: 100,
    elevation: 12,
  },
  smsBannerInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#14291D",
    borderRadius: radius.xl,
    padding: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  smsIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  smsTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
  },
  smsSender: { ...typography.labelSm, color: "#8CF0B4", fontWeight: "800" },
  smsTimerPill: {
    backgroundColor: "rgba(255,255,255,0.16)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  smsTimerText: { ...typography.labelSm, color: "#fff", fontWeight: "800" },
  smsBody: { ...typography.bodyMd, color: "#fff", fontWeight: "600" },
  smsCodeHighlight: {
    ...typography.headlineSm,
    color: "#52FF9B",
    fontWeight: "800",
    letterSpacing: 2,
  },
  smsTapHint: {
    ...typography.labelSm,
    color: "rgba(255,255,255,0.68)",
    marginTop: 2,
  },

  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    padding: spacing.md + 2,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  label: { ...typography.labelMd, color: colors.onSurfaceVariant },
  digitCount: { ...typography.labelSm, color: colors.primary, fontWeight: "700" },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 56,
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
  operatorsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.md,
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
  codeBoxFilled: {
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surfaceContainerLowest,
  },
  resend: { alignSelf: "center", marginTop: spacing.md },
  resendText: { ...typography.labelMd, color: colors.primary, fontWeight: "700" },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: spacing.md,
  },
  modalSheet: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  modalTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  modalHint: { ...typography.bodySm, color: colors.onSurfaceVariant },
  modalInput: {
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLow,
    paddingHorizontal: 12,
    ...typography.bodyMd,
    color: colors.onSurface,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHigh,
  },
  adminQuickBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    backgroundColor: colors.primaryFixed,
  },
  adminQuickText: {
    ...typography.labelMd,
    color: colors.primary,
    fontWeight: "700",
    flex: 1,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: spacing.xs,
  },
  modalCancelBtn: {
    height: 40,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: "center",
    justifyContent: "center",
  },
  modalCancelText: { ...typography.labelMd, color: colors.onSurfaceVariant, fontWeight: "700" },
  modalSaveBtn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  modalSaveText: { ...typography.labelMd, color: "#fff", fontWeight: "800" },
});
