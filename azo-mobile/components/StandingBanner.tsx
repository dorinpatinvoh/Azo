import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { Standing, ridesApi } from "../services/api";
import { useI18n } from "../i18n";

/**
 * Avertissement (note récente basse) ou restriction (note trop basse) : même règle pour les clients et les chauffeurs.
 * N'affiche rien quand tout va bien ou quand la situation n'a pas pu être lue.
 */
export default function StandingBanner() {
  const { t } = useI18n();
  const [standing, setStanding] = useState<Standing | null>(null);
  useEffect(() => {
    ridesApi.standing().then(setStanding).catch(() => undefined);
  }, []);

  if (!standing || standing.level === "OK" || standing.rating === null) return null;
  const restricted = standing.level === "RESTRICTED";
  const text = t(restricted ? "stand.restricted" : "stand.warn", {
    rating: standing.rating.toFixed(1),
    count: standing.count,
    days: standing.windowDays,
    restrict: standing.restrictBelow.toFixed(1),
  });
  return (
    <View style={[styles.box, restricted ? styles.boxRestricted : styles.boxWarning]} accessibilityRole="alert">
      <MaterialIcons name={restricted ? "block" : "warning"} size={20} color={restricted ? colors.error : "#b45309"} />
      <Text style={[styles.text, { color: restricted ? colors.error : "#7a3d00" }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", padding: spacing.md, borderRadius: radius.lg, marginVertical: spacing.xs },
  boxWarning: { backgroundColor: "#fff3d6" },
  boxRestricted: { backgroundColor: colors.errorContainer },
  text: { ...typography.bodySm, flex: 1, lineHeight: 19 },
});
