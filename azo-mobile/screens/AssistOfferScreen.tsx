import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import PrimaryButton from "../components/PrimaryButton";
import { useI18n } from "../i18n";

type Props = {
  /** Il veut l'aide vocale : on lui propose ensuite de choisir sa langue */
  onYes: () => void;
  /** Il n'en veut pas : on va directement à la connexion, en français */
  onNo: () => void;
};

/**
 * Posée UNE seule fois, après l'onboarding et avant l'inscription : « veux-tu une aide vocale ? ».
 * La question est écrite dans la langue par défaut (français), puisque l'utilisateur n'a encore
 * rien choisi.
 */
export default function AssistOfferScreen({ onYes, onNo }: Props) {
  const { t } = useI18n();
  return (
    <LinearGradient
      colors={[colors.onPrimaryFixed, colors.onPrimaryFixed, colors.primary]}
      locations={[0, 0.55, 1]}
      style={styles.root}
    >
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.center}>
          {/* Icône dans des cercles concentriques : évoque l'onde sonore */}
          <View style={styles.ringOuter}>
            <View style={styles.ringInner}>
              <MaterialIcons name="record-voice-over" size={64} color={colors.onPrimary} />
            </View>
          </View>

          <Text style={styles.title}>{t("assist.offer.title")}</Text>
          <Text style={styles.subtitle}>{t("assist.offer.subtitle")}</Text>
        </View>

        <View style={styles.dock}>
          <PrimaryButton label={t("assist.offer.yes")} icon="volume-up" onPress={onYes} />
          <Pressable
            style={styles.noButton}
            onPress={onNo}
            accessibilityRole="button"
            accessibilityLabel={t("assist.offer.no")}
          >
            <Text style={styles.noText}>{t("assist.offer.no")}</Text>
          </Pressable>
          <Text style={styles.note}>{t("assist.offer.note")}</Text>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, paddingHorizontal: spacing.lg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  ringOuter: {
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: `${colors.onPrimary}12`,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  ringInner: {
    width: 136,
    height: 136,
    borderRadius: 68,
    backgroundColor: `${colors.onPrimary}26`,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { ...typography.headlineLg, color: colors.onPrimary, textAlign: "center" },
  subtitle: { ...typography.bodyLg, color: `${colors.onPrimary}D9`, textAlign: "center", paddingHorizontal: spacing.md },
  dock: { gap: spacing.sm, paddingBottom: spacing.sm },
  noButton: {
    height: 52,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: `${colors.onPrimary}66`,
    alignItems: "center",
    justifyContent: "center",
  },
  noText: { ...typography.labelLg, color: colors.onPrimary },
  note: { ...typography.bodySm, color: `${colors.onPrimary}A6`, textAlign: "center", marginTop: spacing.xs },
});
