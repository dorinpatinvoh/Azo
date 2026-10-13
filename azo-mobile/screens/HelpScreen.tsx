import React, { useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { useI18n, type MessageKey } from "../i18n";
import { EMERGENCY_NUMBERS } from "../config/emergency";

type Props = { onBack: () => void };

const FAQ: { q: MessageKey; a: MessageKey }[] = [
  { q: "help.q1", a: "help.a1" },
  { q: "help.q2", a: "help.a2" },
  { q: "help.q3", a: "help.a3" },
  { q: "help.q4", a: "help.a4" },
  { q: "help.q5", a: "help.a5" },
  { q: "help.q6", a: "help.a6" },
  { q: "help.q7", a: "help.a7" },
];

/** Aide : numéros d'urgence (appel direct) et questions fréquentes. Aucun serveur nécessaire. */
export default function HelpScreen({ onBack }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const [open, setOpen] = useState<number | null>(null);

  const emergency: { id: string; label: string; icon: keyof typeof MaterialIcons.glyphMap; number: string }[] = [
    { id: "police", label: t("sos.police", { number: EMERGENCY_NUMBERS.police }), icon: "local-police", number: EMERGENCY_NUMBERS.police },
    { id: "fire", label: t("sos.fire", { number: EMERGENCY_NUMBERS.fire }), icon: "local-fire-department", number: EMERGENCY_NUMBERS.fire },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={[styles.appBar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.back} onPress={onBack} accessibilityRole="button" accessibilityLabel={t("common.back")}>
          <MaterialIcons name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{t("help.title")}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.section}>{t("help.emergency")}</Text>
        <Text style={styles.hint}>{t("help.emergency.sub")}</Text>
        <View style={styles.emergencyRow}>
          {emergency.map((e) => (
            <Pressable
              key={e.id}
              style={styles.emergencyCard}
              onPress={() => Linking.openURL(`tel:${e.number}`)}
              accessibilityRole="button"
              accessibilityLabel={e.label}
            >
              <MaterialIcons name={e.icon} size={26} color={colors.error} />
              <Text style={styles.emergencyText}>{e.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.section, { marginTop: spacing.lg }]}>{t("help.faq")}</Text>
        <View style={styles.faq}>
          {FAQ.map((item, i) => {
            const isOpen = open === i;
            return (
              <View key={item.q} style={i < FAQ.length - 1 && styles.divider}>
                <Pressable
                  style={styles.question}
                  onPress={() => setOpen(isOpen ? null : i)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isOpen }}
                >
                  <Text style={styles.questionText}>{t(item.q)}</Text>
                  <MaterialIcons name={isOpen ? "expand-less" : "expand-more"} size={24} color={colors.primary} />
                </Pressable>
                {isOpen && <Text style={styles.answer}>{t(item.a)}</Text>}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  appBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: `${colors.primaryFixed}99`,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceContainerLowest, alignItems: "center", justifyContent: "center" },
  title: { ...typography.headlineMd, color: colors.onSurface, flex: 1 },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  section: { ...typography.headlineSm, color: colors.onSurface },
  hint: { ...typography.bodyMd, color: colors.onSurfaceVariant, marginTop: 2, marginBottom: spacing.sm },
  emergencyRow: { flexDirection: "row", gap: spacing.sm },
  emergencyCard: {
    flex: 1,
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: colors.errorContainer,
  },
  emergencyText: { ...typography.labelMd, color: colors.error, fontWeight: "700", textAlign: "center" },
  faq: {
    marginTop: spacing.sm,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
    overflow: "hidden",
  },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.surfaceContainer },
  question: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  questionText: { ...typography.bodyLg, color: colors.onSurface, flex: 1, fontWeight: "600" },
  answer: { ...typography.bodyMd, color: colors.onSurfaceVariant, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
});
