import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius } from "../theme/colors";
import { useI18n } from "../i18n";

/** Bouton retour de la barre d'application : revient à la page d'où l'on vient (historique géré par App.tsx). */
export default function BackButton({ onPress }: { onPress: () => void }) {
  const { t } = useI18n();
  return (
    <Pressable onPress={onPress} style={styles.button} accessibilityRole="button" accessibilityLabel={t("common.back")} hitSlop={8}>
      <MaterialIcons name="arrow-back-ios-new" size={18} color={colors.onSurface} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 40, height: 40, borderRadius: radius.full, backgroundColor: colors.surfaceContainerLowest, alignItems: "center", justifyContent: "center" },
});
