import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { useI18n } from "../i18n";

type Props = { visible: boolean; clientName: string; onRate: (stars: number) => void; onSkip: () => void };

/** Après une course terminée, le chauffeur note son client (1 à 5 étoiles). Les autres chauffeurs voient la moyenne sur le radar. */
export default function RateClientModal({ visible, clientName, onRate, onSkip }: Props) {
  const { t } = useI18n();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onSkip}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{t("cr.title")}</Text>
          <Text style={styles.body}>{t("cr.body", { name: clientName })}</Text>
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} onPress={() => onRate(n)} accessibilityLabel={String(n)} hitSlop={6}>
                <MaterialIcons name="star" size={40} color={colors.tertiaryFixedDim} />
              </Pressable>
            ))}
          </View>
          <Pressable onPress={onSkip} style={styles.skip}>
            <Text style={styles.skipText}>{t("cr.skip")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: spacing.lg },
  card: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.sm, alignItems: "center" },
  title: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  body: { ...typography.bodyMd, color: colors.onSurfaceVariant, textAlign: "center" },
  stars: { flexDirection: "row", gap: 4, marginVertical: spacing.xs },
  skip: { paddingVertical: 10, paddingHorizontal: 20 },
  skipText: { ...typography.labelLg, color: colors.primary, fontWeight: "700" },
});
