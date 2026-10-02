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
import * as SecureStore from "expo-secure-store";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import PrimaryButton from "../components/PrimaryButton";
import {
  DEFAULT_API_URL,
  ProfileRole,
  ProviderRef,
  authApi,
  getApiUrl,
  setApiUrl,
} from "../services/api";
import {
  BENIN_LOCAL_PHONE_LENGTH,
  formatBeninLocalInput,
  isValidBeninPhone,
  toBeninE164,
} from "../utils/phone";

type Props = {
  onVerified: (role?: string | null, provider?: ProviderRef | null) => void;
  onBack: () => void;
};

// Profils AZƆ̀ disponibles à l'inscription (aucun Artisan)
const ROLES: {
  id: ProfileRole;
  label: string;
  hint: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  demoPhone: string;
}[] = [
  { id: "CLIENT", label: "Client", hint: "Courses & livraisons", icon: "person", demoPhone: "0197000042" },
  { id: "DRIVER", label: "Zem / Chauffeur", hint: "Zem indépendant ou voiture", icon: "two-wheeler", demoPhone: "0197000001" },
  { id: "COURIER", label: "Coursier / Livreur", hint: "Express, personnel & colis", icon: "local-shipping", demoPhone: "0197000004" },
  { id: "AGENCY", label: "Agence", hint: "Gestion de flotte", icon: "apartment", demoPhone: "0197000010" },
];

const DEMO_PHONES = new Set(["0197000042", "0197000001", "0197000004", "0197000010", "0197000000"]);

const SMS_BANNER_DURATION_SEC = 5;

export default function OtpLoginScreen({ onVerified, onBack }: Props) {
  const [phoneDigits, setPhoneDigits] = useState("0197000042");
  const [role, setRole] = useState<ProfileRole>("CLIENT");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [otp, setOtp] = useState(["", "", "", ""]);
  const [loading, setLoading] = useState(false);

  // Bannière SMS simulée (affichée 5 secondes puis disparaît automatiquement)
  const [simulatedOtp, setSimulatedOtp] = useState<string | null>(null);
  const [bannerSecondsLeft, setBannerSecondsLeft] = useState<number>(0);
  const bannerAnim = useRef(new Animated.Value(-120)).current;

  // Configuration dynamique de l'URL du serveur pour tester l'APK sans recompiler
  const [serverModalOpen, setServerModalOpen] = useState(false);
  const [serverUrlDraft, setServerUrlDraft] = useState(getApiUrl());

  const otpRefs = [
    useRef<TextInput>(null),
    useRef<TextInput>(null),
    useRef<TextInput>(null),
    useRef<TextInput>(null),
  ];

  // Affiche la notification SMS pendant 5 secondes puis la cache
  function triggerSimulatedSmsBanner(code: string) {
    setSimulatedOtp(code);
    setBannerSecondsLeft(SMS_BANNER_DURATION_SEC);
    Animated.spring(bannerAnim, {
      toValue: 0,
      useNativeDriver: true,
      Speed: 14,
      bounciness: 6,
    } as any).start();
  }

  useEffect(() => {
    if (!simulatedOtp) return;
    const interval = setInterval(() => {
      setBannerSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          Animated.timing(bannerAnim, {
            toValue: -140,
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

  const handlePhoneChange = (text: string) => {
    const digits = text.replace(/\D/g, "").slice(0, BENIN_LOCAL_PHONE_LENGTH);
    setPhoneDigits(digits);
  };

  const handleRequestOtp = async () => {
    if (!isValidBeninPhone(phoneDigits)) {
      Alert.alert(
        "Numéro à 10 chiffres requis",
        "Au Bénin (+229), saisis les 10 chiffres de ton numéro en commençant par 01 (ex. 01 97 00 00 42)."
      );
      return;
    }

    setLoading(true);
    try {
      const normalized = toBeninE164(phoneDigits);
      const res = await authApi.requestOtp(normalized);
      setStep("otp");
      setOtp(["", "", "", ""]);
      if (res?.otpCode) {
        triggerSimulatedSmsBanner(res.otpCode);
      }
      setTimeout(() => otpRefs[0].current?.focus(), 150);
    } catch (error: any) {
      Alert.alert(
        "Connexion au serveur",
        error.message ||
          "Impossible de contacter le serveur. Touche « Serveur » en haut à droite pour vérifier l'adresse IP du backend."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    const code = otp.join("");
    if (code.length < 4) {
      Alert.alert("Code incomplet", "Saisis les 4 chiffres du code reçu par SMS.");
      return;
    }

    setLoading(true);
    try {
      const normalized = toBeninE164(phoneDigits);
      const res = await authApi.verifyOtp(normalized, code, role);
      const resolvedRole = (res?.user?.role || "CLIENT").toUpperCase().trim();
      const provider = res?.provider ?? null;

      await SecureStore.setItemAsync("userRole", resolvedRole);
      if (res?.token) {
        await SecureStore.setItemAsync("userToken", res.token);
      }
      if (provider?.status) {
        await SecureStore.setItemAsync("providerStatus", provider.status);
        await SecureStore.setItemAsync("providerType", provider.type);
      } else {
        await SecureStore.deleteItemAsync("providerStatus");
        await SecureStore.deleteItemAsync("providerType");
      }

      onVerified(resolvedRole, provider);
    } catch (error: any) {
      Alert.alert("Erreur de vérification", error.message || "Code OTP invalide ou expiré.");
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (val: string, idx: number) => {
    const digit = val.replace(/\D/g, "").slice(-1);
    const next = [...otp];
    next[idx] = digit;
    setOtp(next);
    if (digit && idx < 3) {
      otpRefs[idx + 1].current?.focus();
    }
  };

  const fillOtpFromBanner = (code: string) => {
    const chars = code.slice(0, 4).split("");
    if (chars.length === 4) {
      setOtp(chars);
    }
  };

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
    Alert.alert("Serveur mis à jour", `L'application communique maintenant avec :\n${getApiUrl()}`);
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Bannière SMS simulée (visible pendant 5 secondes puis disparaît toute seule) */}
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
                Votre code de vérification AZƆ̀ est :{" "}
                <Text style={styles.smsCodeHighlight}>{simulatedOtp}</Text>
              </Text>
              <Text style={styles.smsTapHint}>Touche cette notification pour remplir automatiquement</Text>
            </View>
          </Pressable>
        </Animated.View>
      ) : null}

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <View style={styles.header}>
          <Pressable
            onPress={step === "otp" ? () => setStep("phone") : onBack}
            style={styles.backBtn}
          >
            <MaterialIcons name="arrow-back-ios-new" size={18} color={colors.onSurface} />
          </Pressable>

          <Pressable
            style={styles.serverChip}
            onPress={() => {
              setServerUrlDraft(getApiUrl());
              setServerModalOpen(true);
            }}
          >
            <MaterialIcons name="dns" size={14} color={colors.primary} />
            <Text style={styles.serverChipText}>Serveur</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.badge}>
            <MaterialIcons name="verified-user" size={26} color={colors.primary} />
          </View>

          <Text style={styles.title}>
            {step === "phone" ? "Bienvenue sur AZƆ̀" : "Vérification SMS"}
          </Text>
          <Text style={styles.subtitle}>
            {step === "phone"
              ? "Entre ton numéro béninois à 10 chiffres (01…) pour recevoir un code de sécurité."
              : `Nous avons envoyé un code à 4 chiffres au +229 ${formatBeninLocalInput(phoneDigits)}.`}
          </Text>

          {step === "phone" ? (
            <>
              <Text style={styles.fieldLabel}>Numéro de téléphone (10 chiffres)</Text>
              <View style={styles.phoneRow}>
                <View style={styles.countryBox}>
                  <Text style={styles.flag}>🇧🇯</Text>
                  <Text style={styles.prefix}>+229</Text>
                </View>
                <TextInput
                  style={styles.phoneInput}
                  value={formatBeninLocalInput(phoneDigits)}
                  onChangeText={handlePhoneChange}
                  keyboardType="phone-pad"
                  placeholder="01 97 00 00 42"
                  placeholderTextColor={colors.outline}
                  maxLength={14}
                />
              </View>
              <Text style={styles.phoneHint}>
                Format national à 10 chiffres (01 XX XX XX XX) — {phoneDigits.length}/10 chiffres
              </Text>

              <Text style={[styles.fieldLabel, { marginTop: spacing.lg }]}>
                Je me connecte comme
              </Text>
              <View style={styles.roleGrid}>
                {ROLES.map((r) => {
                  const active = r.id === role;
                  return (
                    <Pressable
                      key={r.id}
                      style={[styles.roleChip, active && styles.roleChipActive]}
                      onPress={() => {
                        setRole(r.id);
                        if (DEMO_PHONES.has(phoneDigits)) {
                          setPhoneDigits(r.demoPhone);
                        }
                      }}
                    >
                      <MaterialIcons
                        name={r.icon}
                        size={20}
                        color={active ? colors.onPrimary : colors.onSurfaceVariant}
                      />
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[styles.roleLabel, active && { color: colors.onPrimary }]}
                          numberOfLines={1}
                        >
                          {r.label}
                        </Text>
                        <Text
                          style={[
                            styles.roleHint,
                            active && { color: "rgba(255,255,255,0.82)" },
                          ]}
                          numberOfLines={1}
                        >
                          {r.hint}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              {role !== "CLIENT" && (
                <Text style={styles.roleNote}>
                  Les comptes Zem, Coursier / Livreur et Agence sont ouverts après vérification
                  de ton dossier par l'équipe AZƆ̀.
                </Text>
              )}
            </>
          ) : (
            <>
              <View style={styles.otpRow}>
                {otp.map((digit, i) => (
                  <TextInput
                    key={i}
                    ref={otpRefs[i]}
                    style={[styles.otpBox, digit ? styles.otpBoxFilled : null]}
                    value={digit}
                    onChangeText={(val) => handleOtpChange(val, i)}
                    keyboardType="number-pad"
                    maxLength={1}
                    textAlign="center"
                  />
                ))}
              </View>
              <Pressable onPress={handleRequestOtp} disabled={loading}>
                <Text style={styles.resend}>
                  Tu n'as pas vu le code ?{" "}
                  <Text style={styles.resendLink}>Renvoyer le code (5s)</Text>
                </Text>
              </Pressable>
            </>
          )}

          <View style={{ flex: 1, minHeight: spacing.xl }} />

          <PrimaryButton
            label={step === "phone" ? "Recevoir mon code OTP" : "Vérifier et continuer"}
            icon="arrow-forward"
            onPress={step === "phone" ? handleRequestOtp : handleVerifyOtp}
            loading={loading}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Modal de configuration de l'URL du serveur pour les tests APK */}
      <Modal
        visible={serverModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setServerModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Adresse du serveur Backend</Text>
            <Text style={styles.modalHint}>
              Pratique pour tester l'APK sur téléphone : indique l'IP locale de ton ordinateur
              (même Wi-Fi / partage de connexion) ou ton URL publique (ngrok / Cloudflare Tunnel / Render).
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
            <Text style={[styles.modalHint, { marginTop: 4, fontWeight: "700" }]}>
              Accès rapide compte Administrateur :
            </Text>
            <Pressable
              style={styles.modalCancelBtn}
              onPress={() => {
                setPhoneDigits("0197000000");
                setServerModalOpen(false);
              }}
            >
              <Text style={[styles.modalCancelText, { color: colors.primary }]}>
                Remplir n° Admin (+229 01 97 00 00 00)
              </Text>
            </Pressable>
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancelBtn}
                onPress={() => {
                  setServerUrlDraft(DEFAULT_API_URL);
                }}
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: "center",
    justifyContent: "center",
  },
  serverChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
  },
  serverChipText: { ...typography.labelSm, color: colors.primary, fontWeight: "700" },

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

  body: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl },
  badge: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.primaryFixed,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  title: { ...typography.headlineLg, color: colors.onSurface, fontWeight: "800" },
  subtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },
  fieldLabel: {
    ...typography.labelMd,
    color: colors.onSurfaceVariant,
    marginBottom: spacing.xs,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  phoneRow: { flexDirection: "row", gap: spacing.sm },
  countryBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLow,
  },
  flag: { fontSize: 20 },
  prefix: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
  phoneInput: {
    flex: 1,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLow,
    paddingHorizontal: spacing.md,
    ...typography.headlineSm,
    color: colors.onSurface,
    letterSpacing: 1.2,
  },
  phoneHint: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
    marginTop: 6,
  },
  roleGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  roleChip: {
    width: "48%",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLow,
  },
  roleChipActive: { backgroundColor: colors.primary },
  roleLabel: { ...typography.labelMd, color: colors.onSurfaceVariant, fontWeight: "700" },
  roleHint: { ...typography.labelSm, color: colors.outline, fontSize: 10 },
  roleNote: {
    ...typography.bodySm,
    color: colors.onSurfaceVariant,
    marginTop: spacing.sm,
  },
  otpRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginVertical: spacing.md,
  },
  otpBox: {
    flex: 1,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLow,
    ...typography.displayLg,
    fontSize: 26,
    color: colors.onSurface,
  },
  otpBoxFilled: {
    backgroundColor: colors.primaryFixed,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  resend: {
    ...typography.bodySm,
    color: colors.onSurfaceVariant,
    textAlign: "center",
    marginTop: spacing.md,
  },
  resendLink: { color: colors.primary, fontWeight: "700" },

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
