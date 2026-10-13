import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import PrimaryButton from "../components/PrimaryButton";
import LanguageList from "../components/LanguageList";
import { isLocalVoice, translate, useI18n, type LangCode, type LocalVoiceCode } from "../i18n";
import { hasRecordings, hasVoiceFor, localVoiceName, speak, speakKey, stopSpeaking } from "../i18n/voice";

type Props = {
  onContinue: () => void;
  onBack: () => void;
};

/**
 * Choix de la langue (après « oui, je veux une aide vocale »). Dès qu'une langue est touchée,
 * TOUTE l'application passe dans cette langue et la voix se présente dans cette langue.
 */
export default function LanguageScreen({ onContinue, onBack }: Props) {
  const { lang, setLang, t, voiceLang, setLocalVoice } = useI18n();
  const [voiceMissing, setVoiceMissing] = useState(false);
  // Langue locale choisie pour la voix seule : les enregistrements existent-ils ? sinon on prévient que la voix parle français
  const [recordingsMissing, setRecordingsMissing] = useState(false);
  const localVoice = isLocalVoice(voiceLang) ? voiceLang : null;

  // La voix s'arrête si l'on quitte l'écran
  useEffect(() => () => stopSpeaking(), []);

  function chooseLocal(code: LocalVoiceCode) {
    setLocalVoice(code);
    setVoiceMissing(false);
    setRecordingsMissing(!hasRecordings(code));
    speakKey("lang.welcome", code);
  }

  async function choose(code: LangCode) {
    setRecordingsMissing(false);
    setLang(code);
    const available = await hasVoiceFor(code);
    setVoiceMissing(!available);
    // `translate` plutôt que `t` : `t` n'a pas encore la nouvelle langue au moment de cet appel.
    if (available) speak(translate(code, "lang.welcome"), code);
  }

  return (
    <LinearGradient
      colors={[colors.onPrimaryFixed, colors.onPrimaryFixed, colors.primary]}
      locations={[0, 0.55, 1]}
      style={styles.root}
    >
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <Pressable style={styles.back} onPress={onBack} accessibilityRole="button" accessibilityLabel={t("common.back")}>
          <MaterialIcons name="arrow-back" size={24} color={colors.onPrimary} />
        </Pressable>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>{t("lang.title")}</Text>
          <Text style={styles.subtitle}>{t("lang.subtitle")}</Text>
          <View style={{ height: spacing.lg }} />
          <LanguageList
            selected={localVoice ? null : lang}
            onSelect={choose}
            variant="dark"
            local={{ selected: localVoice, onSelect: chooseLocal, title: t("lang.voiceOnlyTitle"), note: t("lang.voiceOnlyNote") }}
          />

          {recordingsMissing && localVoice && (
            <View style={styles.warning}>
              <MaterialIcons name="volume-off" size={18} color={colors.tertiaryFixed} />
              <Text style={styles.warningText}>{t("lang.voiceFallback", { name: localVoiceName(localVoice) })}</Text>
            </View>
          )}

          {voiceMissing && (
            <View style={styles.warning}>
              <MaterialIcons name="volume-off" size={18} color={colors.tertiaryFixed} />
              <Text style={styles.warningText}>{t("lang.voiceMissing")}</Text>
            </View>
          )}
        </ScrollView>

        <View style={styles.dock}>
          <PrimaryButton label={t("common.continue")} onPress={onContinue} />
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, paddingHorizontal: spacing.lg },
  back: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: `${colors.onPrimary}26`,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.xs,
  },
  content: { paddingTop: spacing.lg, paddingBottom: spacing.lg },
  title: { ...typography.headlineXl, color: colors.onPrimary },
  subtitle: { ...typography.bodyLg, color: `${colors.onPrimary}D9`, marginTop: spacing.xs },
  warning: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
    marginTop: spacing.md,
    padding: spacing.sm + 2,
    borderRadius: radius.lg,
    backgroundColor: `${colors.onPrimary}1A`,
  },
  warningText: { ...typography.bodySm, color: colors.onPrimary, flex: 1 },
  dock: { paddingBottom: spacing.sm, paddingTop: spacing.sm },
});
