import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  ImageBackground,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import Svg, { Rect } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import * as SecureStore from "expo-secure-store";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import PrimaryButton from "../components/PrimaryButton";
import AccountKindPicker, { type AccountKind } from "../components/AccountKindPicker";
import { useI18n, type MessageKey } from "../i18n";
import { speakKey, speakText, stopSpeaking, type VoiceKey } from "../i18n/voice";
import {
  ApiError,
  ProviderRef,
  type ProfileRole,
  type ProviderType,
  authApi,
  needsRegistration,
  errorMessage,
  userApi,
} from "../services/api";
import {
  BENIN_PHONE_LENGTH,
  cleanBeninDigits,
  formatBeninPhoneInput,
  isValidBeninPhone,
  toBeninE164,
} from "../utils/phone";
import {
  GENDER_OPTIONS,
  NPI_LENGTH,
  type Gender,
  cleanNpi,
  formatNpi,
  isValidName,
  isValidNpi,
  normalizeName,
  registrationError,
} from "../utils/registration";
import { BrandAlert } from "../components/BrandAlert";

type Step = "phone" | "code" | "register";

type Props = {
  onVerified: (role: string, provider?: ProviderRef | null, startType?: ProviderType | null, startCategory?: string | null) => void;
  /** Plus utilisé : l'écran de connexion n'a plus de retour vers l'onboarding. */
  onBack?: () => void;
  /** Application rouverte alors que l'inscription n'était pas terminée (session déjà ouverte). */
  resumeRegistration?: boolean;
};

// Tant que l'inscription n'est pas terminée, ce drapeau ramène à son écran à la réouverture
// de l'application (la session est déjà ouverte : sans lui on arriverait sur l'accueil).
export const REGISTRATION_PENDING_KEY = "registrationPending";

const SMS_BANNER_DURATION_SEC = 5;

export default function OtpLoginScreen({ onVerified, resumeRegistration = false }: Props) {
  const [step, setStep] = useState<Step>(resumeRegistration ? "register" : "phone");
  // Type de compte choisi à l'inscription : « Agence » ouvre ensuite le dossier d'agence (seul endroit où l'on peut en créer une)
  const [accountKind, setAccountKind] = useState<AccountKind>("CLIENT");
  // Bouton retour du téléphone : code → numéro ; sur le numéro et pendant l'inscription (étape obligatoire) il quitte l'application
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (step === "code") {
        setStep("phone");
        return true;
      }
      // Écran du numéro et inscription : le retour du téléphone quitte l'application (pas de retour à l'onboarding)
      return false;
    });
    return () => sub.remove();
  }, [step]);

  // « Créer un compte » depuis l'écran du numéro : le profil est choisi avant le numéro et le code, puis le parcours dédié suit
  const [signupMode, setSignupMode] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState(["", "", "", ""]);
  // Inscription (après l'OTP) : nom, prénom, sexe et NPI
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);
  const [npi, setNpi] = useState("");
  const { t, voiceAssist, voiceLang } = useI18n();
  // Pause : coupe la voix pour cette inscription sans changer le réglage du profil
  const [paused, setPaused] = useState(false);
  const talk = voiceAssist && !paused;

  // Aide vocale : à chaque étape, la voix explique ce qu'il faut faire. Les alertes sont aussi
  // lues à voix haute : une personne qui lit difficilement entend ce qui ne va pas.
  const spokenDone = useRef(false);
  const stepKey: MessageKey =
    step === "phone" ? "voice.step.phone" : step === "code" ? "voice.step.code" : "voice.step.register";
  useEffect(() => {
    if (!talk) return;
    // Court délai : on laisse l'écran (et le clavier) s'installer avant de parler
    const timer = setTimeout(() => speakKey(stepKey as VoiceKey, voiceLang), 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, talk, voiceLang]);
  // La voix se tait quand on quitte l'écran, sauf le message de fin d'inscription
  useEffect(() => () => { if (!spokenDone.current) stopSpeaking(); }, []);
  function notify(title: string, message: string) {
    BrandAlert.alert(title, message);
    if (talk) speakText(`${title}. ${message}`, voiceLang);
  }

  const firstNameRef = useRef<TextInput | null>(null);
  const npiRef = useRef<TextInput | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  // Le clavier recouvre le bas de l'écran : à la saisie du NPI on fait défiler jusqu'en bas pour que ce qu'on tape reste
  // visible (le NPI est le dernier champ du formulaire). On n'utilise plus `measureLayout` : sur cette version de React Native
  // il exige une référence à un composant natif et affichait l'avertissement « ref.measureLayout must be called with a ref to a native component ».
  const scrollToNpi = () => {
    scrollRef.current?.scrollToEnd({ animated: true });
  };
  const [sending, setSending] = useState(false);
  const inputsRef = useRef<Array<TextInput | null>>([]);

  // Bannière SMS simulée (affichée 5 secondes puis disparaît automatiquement)
  const [simulatedOtp, setSimulatedOtp] = useState<string | null>(null);
  const [bannerSecondsLeft, setBannerSecondsLeft] = useState<number>(0);
  const bannerAnim = useRef(new Animated.Value(-140)).current;

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
      notify(t("auth.alert.phoneTitle"), t("auth.alert.phoneBody"));
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
      notify(t("auth.alert.sendFailed"), errorMessage(e));
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
      // Profil professionnel : seul le numéro est demandé (pas de nom, sexe ni NPI à l'inscription)
      const proProfile = signupMode && accountKind !== "CLIENT" ? (accountKind === "COURIER_PERSONAL" || accountKind === "COURIER_EXPRESS" ? "COURIER" : accountKind) : "CLIENT";
      const response = await authApi.verifyOtp(normalized, fullCode, proProfile as ProfileRole);

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

      // Compte professionnel sans fiche d'identité : on va directement au dossier dédié
      const proKind = response.signupKind && response.signupKind !== "CLIENT" && response.user.profileComplete !== true ? response.signupKind : null;
      if (proKind) {
        await SecureStore.deleteItemAsync(REGISTRATION_PENDING_KEY);
        await SecureStore.setItemAsync("lastLoginPhone", digits).catch(() => undefined);
        // dossier à remplir (brouillon) : on l'ouvre ; sinon (déposé, validé…) le parcours habituel du prestataire
        if (provider?.status && provider.status !== "DRAFT") {
          onVerified(role, provider);
          return;
        }
        const category = proKind === "COURIER" && accountKind === "COURIER_PERSONAL" ? "COURSIER_PERSONNEL" : proKind === "COURIER" && accountKind === "COURIER_EXPRESS" ? "COURSIER_EXPRESS" : null;
        onVerified("CLIENT", null, proKind as ProviderType, category);
        return;
      }

      // Nouveau compte client (ou compte sans inscription terminée) : formulaire obligatoire.
      if (!proKind && needsRegistration(response.user)) {
        await SecureStore.setItemAsync(REGISTRATION_PENDING_KEY, "1");
        setStep("register");
        return;
      }
      await SecureStore.deleteItemAsync(REGISTRATION_PENDING_KEY);

      await SecureStore.setItemAsync("lastLoginPhone", digits).catch(() => undefined);
      onVerified(role, provider);
    } catch (e) {
      notify(t("auth.alert.loginFailed"), errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  const problem = registrationError({ lastName, firstName, gender, npi });
  const registrationProblem = problem ? t(problem.key, problem.vars) : null;

  async function handleRegister() {
    if (registrationProblem || !gender) {
      notify(t("auth.alert.incompleteTitle"), registrationProblem ?? t("auth.alert.fillAll"));
      return;
    }

    setSending(true);
    try {
      const updated = await userApi.register({
        lastName: normalizeName(lastName),
        firstName: normalizeName(firstName),
        gender,
        npi: cleanNpi(npi),
        accountKind: "CLIENT",
      });
      // Le serveur doit confirmer l'enregistrement : sinon (serveur pas à jour) on ne laisse
      // pas l'utilisateur entrer comme si tout était sauvegardé.
      if (updated.profileComplete !== true) {
        notify(t("auth.alert.notConfirmedTitle"), t("auth.alert.notConfirmedBody"));
        return;
      }
      await SecureStore.deleteItemAsync(REGISTRATION_PENDING_KEY);
      // Message de fin : il doit être prononcé jusqu'au bout même si l'écran change aussitôt
      spokenDone.current = true;
      if (talk) speakKey("voice.done", voiceLang);
      await SecureStore.setItemAsync("lastLoginPhone", digits).catch(() => undefined);
      // L'identité (nom, sexe, NPI) ne concerne que le client ; les profils professionnels n'arrivent jamais ici
      onVerified("CLIENT", null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        notify(t("auth.alert.outdatedTitle"), t("auth.alert.outdatedBody"));
      } else if (e instanceof ApiError && e.status >= 500) {
        // Panne du serveur : rien n'a été enregistré. On ne montre pas « Internal server error »,
        // et on garde les champs saisis pour réessayer sans tout retaper.
        notify(t("auth.alert.downTitle"), t("auth.alert.downBody"));
      } else if (e instanceof ApiError && e.status === 409) {
        notify(t("auth.alert.npiUsedTitle"), t("auth.alert.npiUsedBody"));
      } else {
        notify(t("auth.alert.registerFailed"), errorMessage(e));
      }
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
                <Text style={styles.smsSender}>{t("auth.sms.sender")}</Text>
                <View style={styles.smsTimerPill}>
                  <Text style={styles.smsTimerText}>{bannerSecondsLeft}s</Text>
                </View>
              </View>
              <Text style={styles.smsBody}>
                {t("auth.sms.body")}{" "}
                <Text style={styles.smsCodeHighlight}>{simulatedOtp}</Text>
              </Text>
              <Text style={styles.smsTapHint}>{t("auth.sms.tap")}</Text>
            </View>
          </Pressable>
        </Animated.View>
      ) : null}

      {/* « padding » aussi sur Android : sans cela le clavier recouvre les champs du bas (NPI).
          Les applications Expo récentes n'ajustent plus la fenêtre toutes seules. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Bandeau d'accueil de l'écran du numéro : aucun retour, jamais vers l'onboarding */}
          {step === "phone" ? (
            <ImageBackground source={require("../assets/zemback.png")} resizeMode="cover" style={styles.hero} imageStyle={{ borderRadius: 28 }}>
              {/* voile violet : garde le texte blanc lisible sur la photo */}
              <LinearGradient
                colors={["rgba(47,0,76,0.82)", "rgba(113,0,175,0.72)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
              <View style={styles.heroCircleA} pointerEvents="none" />
              <View style={styles.heroCircleB} pointerEvents="none" />
              <View style={styles.heroTop}>
              {voiceAssist && (
                <>
                  {talk && (
                    <Pressable
                      onPress={() => speakKey(stepKey as VoiceKey, voiceLang)}
                      style={styles.heroIcon}
                      accessibilityRole="button"
                      accessibilityLabel={t("voice.replay")}
                    >
                      <MaterialIcons name="volume-up" size={20} color={colors.onPrimary} />
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => {
                      if (talk) stopSpeaking();
                      setPaused(talk);
                    }}
                    style={styles.heroIcon}
                    accessibilityRole="button"
                    accessibilityLabel={talk ? t("voice.pause") : t("voice.resume")}
                  >
                    <MaterialIcons name={talk ? "pause" : "play-arrow"} size={22} color={colors.onPrimary} />
                  </Pressable>
                </>
              )}
              </View>
              <Text style={styles.heroBrand}>AZƆ̀</Text>
              <Text style={styles.heroTitle}>{signupMode ? t("auth.signup.title") : t("auth.phone.title")}</Text>
              <Text style={styles.heroSub}>{signupMode ? t("auth.signup.subtitle") : t("auth.hero.tagline")}</Text>
              <View style={styles.perks}>
                {([
                  ["flash-on", "auth.perk.fast"],
                  ["verified-user", "auth.perk.safe"],
                  ["account-balance-wallet", "auth.perk.pay"],
                ] as const).map(([icon, key]) => (
                  <View key={key} style={styles.perk}>
                    <MaterialIcons name={icon} size={14} color={colors.onPrimary} />
                    <Text style={styles.perkText}>{t(key)}</Text>
                  </View>
                ))}
              </View>
            </ImageBackground>
          ) : (
            <>
          {/* En-tête épuré : flèche retour à gauche (code), verrou (inscription) */}
          <View style={styles.topRow}>
            <Pressable
              onPress={step === "code" ? () => setStep("phone") : undefined}
              style={styles.iconButton}
              accessibilityLabel={step === "register" ? t("auth.mandatoryStep") : t("common.back")}
              disabled={step === "register"}
            >
              <MaterialIcons
                name={step === "register" ? "lock" : "arrow-back"}
                size={20}
                color={step === "register" ? colors.outline : colors.onSurface}
              />
            </Pressable>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              {voiceAssist && (
                <>
                  {talk && (
                    <Pressable
                      onPress={() => speakKey(stepKey as VoiceKey, voiceLang)}
                      style={styles.iconButton}
                      accessibilityRole="button"
                      accessibilityLabel={t("voice.replay")}
                    >
                      <MaterialIcons name="volume-up" size={20} color={colors.primary} />
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => {
                      if (talk) stopSpeaking();
                      setPaused(talk);
                    }}
                    style={styles.iconButton}
                    accessibilityRole="button"
                    accessibilityLabel={talk ? t("voice.pause") : t("voice.resume")}
                  >
                    <MaterialIcons name={talk ? "pause" : "play-arrow"} size={22} color={colors.primary} />
                  </Pressable>
                </>
              )}
            </View>
          </View>

          {/* Titre aéré (sans le sous-titre sur l'étape téléphone) */}
          <View style={styles.headerBlock}>
            <Text style={styles.brand}>AZƆ̀</Text>
            <Text style={styles.headline}>
              {step === "code" ? t("auth.code.title") : t("auth.register.title")}
            </Text>
            {step === "code" ? (
              <Text style={styles.subtitle}>
                {t("auth.code.subtitle", { phone: phone || "01 •• •• •• ••" })}
              </Text>
            ) : step === "register" ? (
              <Text style={styles.subtitle}>
                {t("auth.register.subtitle")}
              </Text>
            ) : null}
          </View>


            </>
          )}
          {step === "phone" ? (
            <View style={[styles.card, styles.cardOverlap]}>
              {signupMode ? (
                <View style={{ marginBottom: spacing.md, gap: spacing.sm }}>
                  <View style={styles.kindLabelRow}>
                    <MaterialIcons name="how-to-reg" size={16} color={colors.primary} />
                    <Text style={styles.kindLabel}>{t("auth.kind.title")}</Text>
                  </View>
                  <AccountKindPicker value={accountKind} onChange={setAccountKind} />
                  {accountKind !== "CLIENT" ? (
                    <View style={styles.kindHint}>
                      <MaterialIcons name="info-outline" size={16} color={colors.primary} />
                      <Text style={styles.kindHintText}>{t("auth.kind.hint")}</Text>
                    </View>
                  ) : null}
                  <Pressable
                    onPress={() => {
                      setSignupMode(false);
                      setAccountKind("CLIENT");
                    }}
                    accessibilityRole="button"
                    style={styles.signupSwitch}
                  >
                    <MaterialIcons name="login" size={18} color={colors.primary} />
                    <Text style={styles.signupSwitchText}>{t("auth.signup.have")}</Text>
                  </Pressable>
                  <View style={styles.kindDivider} />
                </View>
              ) : (
                <Pressable onPress={() => setSignupMode(true)} accessibilityRole="button" style={[styles.signupSwitch, { marginBottom: spacing.md }]}>
                  <MaterialIcons name="person-add-alt-1" size={18} color={colors.primary} />
                  <Text style={styles.signupSwitchText}>{t("auth.signup.create")}</Text>
                </Pressable>
              )}
              <View style={styles.labelRow}>
                <Text style={styles.label}>{signupMode && accountKind === "AGENCY" ? t("auth.phone.labelAgency") : t("auth.phone.label")}</Text>
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
                <Text style={styles.operatorsLabel}>{t("auth.phone.operators")}</Text>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <OperatorPill label="MTN" bg={colors.tertiaryFixed} fg={colors.onTertiaryFixed} />
                  <OperatorPill label="Moov" bg={colors.secondaryFixed} fg={colors.onSecondaryFixed} />
                  <OperatorPill label="Celtiis" bg={colors.primaryFixed} fg={colors.onPrimaryFixed} />
                </View>
              </View>
            </View>
          ) : step === "code" ? (
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
          ) : (
            <View style={styles.card}>
              <Text style={styles.label}>{t("auth.field.lastName")}</Text>
              <TextInput
                style={[styles.nameInput, !!lastName && !isValidName(lastName) && styles.inputInvalid]}
                value={lastName}
                onChangeText={setLastName}
                placeholder={t("auth.placeholder.lastName")}
                placeholderTextColor={colors.outline}
                autoCapitalize="words"
                autoCorrect={false}
                autoFocus
                maxLength={50}
                returnKeyType="next"
                onSubmitEditing={() => firstNameRef.current?.focus()}
                accessibilityLabel={t("auth.field.lastName")}
              />

              <Text style={[styles.label, styles.fieldGap]}>{t("auth.field.firstName")}</Text>
              <TextInput
                ref={firstNameRef}
                style={[styles.nameInput, !!firstName && !isValidName(firstName) && styles.inputInvalid]}
                value={firstName}
                onChangeText={setFirstName}
                placeholder={t("auth.placeholder.firstName")}
                placeholderTextColor={colors.outline}
                autoCapitalize="words"
                autoCorrect={false}
                maxLength={50}
                returnKeyType="next"
                onSubmitEditing={() => npiRef.current?.focus()}
                accessibilityLabel={t("auth.field.firstName")}
              />

              <Text style={[styles.label, styles.fieldGap]}>{t("auth.field.gender")}</Text>
              <View style={styles.genderRow}>
                {GENDER_OPTIONS.map((option) => {
                  const selected = gender === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      style={[styles.genderChip, selected && styles.genderChipActive]}
                      onPress={() => setGender(option.value)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={t(option.labelKey)}
                    >
                      <MaterialIcons
                        name={option.icon}
                        size={20}
                        color={selected ? colors.primary : colors.onSurfaceVariant}
                      />
                      <Text style={[styles.genderText, selected && styles.genderTextActive]}>{t(option.labelKey)}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* `collapsable={false}` : Android ne doit pas supprimer cette vue, sinon sa position
                  n'est pas mesurable pour la faire remonter au-dessus du clavier */}
              <View>
                <View style={[styles.labelRow, styles.fieldGap]}>
                  <Text style={styles.label}>{t("auth.field.npi")}</Text>
                  <Text style={styles.digitCount}>
                    {cleanNpi(npi).length}/{NPI_LENGTH}
                  </Text>
                </View>
                <TextInput
                  ref={npiRef}
                  style={[styles.nameInput, isValidNpi(npi) && styles.inputValid]}
                  value={formatNpi(npi)}
                  onChangeText={(value) => setNpi(cleanNpi(value))}
                  // Le clavier met un instant à s'ouvrir : on attend avant de faire remonter le champ
                  onFocus={() => setTimeout(scrollToNpi, 300)}
                  placeholder="1234 5678 90"
                  placeholderTextColor={colors.outline}
                  keyboardType="number-pad"
                  maxLength={NPI_LENGTH + 2}
                  returnKeyType="done"
                  onSubmitEditing={handleRegister}
                  accessibilityLabel="NPI"
                />
              </View>
              <Text style={styles.nameHint}>
                {t("auth.npi.hint")}
              </Text>
            </View>
          )}

          <View style={{ flex: 1, minHeight: spacing.xl }} />

          <PrimaryButton
            label={step === "phone" ? t("auth.phone.send") : step === "code" ? t("auth.code.verify") : t("auth.register.submit")}
            onPress={step === "phone" ? handleSendCode : step === "code" ? handleVerify : handleRegister}
            loading={sending}
            disabled={step === "phone" ? !isPhoneValid : step === "code" ? code.join("").length < 4 : !!registrationProblem}
            icon={step === "phone" ? "sms" : step === "code" ? "check" : "arrow-forward"}
          />

          {step === "code" && (
            <Pressable style={styles.resend} onPress={handleSendCode}>
              <Text style={styles.resendText}>{t("auth.code.resend")}</Text>
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
  hero: { borderRadius: 28, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl + spacing.lg, overflow: "hidden", alignItems: "center", marginTop: spacing.xs },
  heroCircleA: { position: "absolute", width: 190, height: 190, borderRadius: 95, right: -60, top: -70, backgroundColor: "rgba(255,255,255,0.09)" },
  heroCircleB: { position: "absolute", width: 130, height: 130, borderRadius: 65, left: -45, bottom: -40, backgroundColor: "rgba(255,255,255,0.07)" },
  heroTop: { alignSelf: "stretch", flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, minHeight: 38 },
  heroIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  heroBrand: { ...typography.displayLgMobile, color: colors.onPrimary, fontSize: 40, lineHeight: 46, letterSpacing: 3, textAlign: "center" },
  heroTitle: { ...typography.headlineLg, color: colors.onPrimary, textAlign: "center", marginTop: spacing.xs },
  heroSub: { ...typography.bodyMd, color: "rgba(255,255,255,0.88)", textAlign: "center", marginTop: 4 },
  perks: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: spacing.md },
  perk: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.16)" },
  perkText: { ...typography.labelSm, color: colors.onPrimary, fontWeight: "700" },
  cardOverlap: { marginTop: -spacing.lg },
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
  kindLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  kindLabel: { ...typography.labelMd, color: colors.primary, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase" },
  kindHint: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: colors.primaryFixed + "66", borderRadius: radius.md, padding: spacing.sm },
  kindHintText: { ...typography.bodySm, color: colors.onSurface, flex: 1 },
  signupSwitch: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 44, borderRadius: radius.full, backgroundColor: colors.primaryFixed + "55", paddingHorizontal: spacing.md },
  signupSwitchText: { ...typography.labelMd, color: colors.primary, fontWeight: "700" },
  kindDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.outlineVariant, marginTop: spacing.xs },
  resend: { alignSelf: "center", marginTop: spacing.md },
  resendText: { ...typography.labelMd, color: colors.primary, fontWeight: "700" },

  nameInput: {
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1.5,
    borderColor: colors.primary,
    paddingHorizontal: 12,
    ...typography.bodyMd,
    color: colors.onSurface,
    marginTop: spacing.xs,
  },
  nameHint: { ...typography.bodySm, color: colors.onSurfaceVariant, marginTop: spacing.sm },
  fieldGap: { marginTop: spacing.md },
  inputInvalid: { borderColor: colors.error },
  inputValid: { borderColor: colors.primary, backgroundColor: colors.surfaceContainerLowest },
  genderRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  genderChip: {
    flex: 1,
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  genderChipActive: { borderColor: colors.primary, backgroundColor: colors.surfaceContainerLowest },
  genderText: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  genderTextActive: { color: colors.primary, fontWeight: "700" },
});
