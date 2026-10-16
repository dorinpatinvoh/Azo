import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";

type Props = {
  /** Titre (ex. « Distance à parcourir »). */
  title: string;
  /** Distance restante, déjà formatée (ex. « 3,2 km »). */
  remaining: string;
  /** Précision sous la distance (total, déjà parcouru). */
  sub?: string;
};

/** Distance qu'il reste à parcourir pendant la course : affichée au client et au Speeder une fois la course démarrée. */
export default function TripDistanceBanner({ title, remaining, sub }: Props) {
  return (
    <View style={styles.box} accessibilityRole="summary" accessibilityLabel={`${title} : ${remaining}`}>
      <View style={styles.icon}>
        <MaterialIcons name="route" size={22} color={colors.onPrimary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      </View>
      <Text style={styles.value}>{remaining}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.primaryFixed, borderRadius: radius.lg, padding: spacing.sm + 2 },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  title: { ...typography.labelMd, color: colors.onPrimaryFixed, fontWeight: "800" },
  sub: { ...typography.bodySm, color: colors.onPrimaryFixed },
  value: { ...typography.headlineSm, color: colors.primary, fontWeight: "800" },
});
