import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { useI18n, type MessageKey } from "../i18n";

/** Type de compte choisi à l'inscription : « CLIENT » ou l'activité professionnelle (même valeurs que ProviderType). */
export type AccountKind = "CLIENT" | "DRIVER" | "COURIER" | "AGENCY";

const OPTIONS: { value: AccountKind; labelKey: MessageKey; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { value: "CLIENT", labelKey: "auth.kind.client", icon: "person" },
  { value: "DRIVER", labelKey: "auth.kind.driver", icon: "two-wheeler" },
  { value: "COURIER", labelKey: "auth.kind.courier", icon: "local-shipping" },
  { value: "AGENCY", labelKey: "auth.kind.agency", icon: "apartment" },
];

type Props = { value: AccountKind; onChange: (kind: AccountKind) => void };

/**
 * Liste déroulante (combobox) du type de compte : Client, Zem & Conducteur indépendant, Coursier & Livreur ou Agence.
 * Le choix détermine le parcours d'inscription proposé juste après l'identité.
 */
export default function AccountKindPicker({ value, onChange }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0];

  return (
    <>
      <Pressable style={styles.field} onPress={() => setOpen(true)} accessibilityRole="combobox" accessibilityLabel={t("auth.kind.title")}>
        <MaterialIcons name={current.icon} size={22} color={colors.primary} />
        <Text style={styles.fieldText} numberOfLines={2}>{t(current.labelKey)}</Text>
        <MaterialIcons name="arrow-drop-down" size={26} color={colors.onSurfaceVariant} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <SafeAreaView edges={["bottom"]} style={styles.sheetWrap}>
            <Pressable style={styles.sheet} onPress={() => undefined}>
              <Text style={styles.sheetTitle}>{t("auth.kind.title")}</Text>
              {OPTIONS.map((o) => {
                const selected = o.value === value;
                return (
                  <Pressable
                    key={o.value}
                    style={[styles.option, selected && styles.optionActive]}
                    onPress={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                  >
                    <View style={[styles.optionIcon, selected && styles.optionIconActive]}>
                      <MaterialIcons name={o.icon} size={20} color={selected ? colors.onPrimary : colors.primary} />
                    </View>
                    <Text style={[styles.optionText, selected && styles.optionTextActive]}>{t(o.labelKey)}</Text>
                    <MaterialIcons name={selected ? "radio-button-checked" : "radio-button-unchecked"} size={20} color={selected ? colors.primary : colors.outline} />
                  </Pressable>
                );
              })}
            </Pressable>
          </SafeAreaView>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 54, paddingHorizontal: spacing.md, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.outlineVariant, backgroundColor: colors.surfaceContainerLowest },
  fieldText: { ...typography.bodyLg, color: colors.onSurface, flex: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheetWrap: { backgroundColor: "transparent" },
  sheet: { backgroundColor: colors.surfaceContainerLowest, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.md, gap: spacing.sm },
  sheetTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800", marginBottom: spacing.xs },
  option: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 58, paddingHorizontal: spacing.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.surfaceContainer },
  optionActive: { borderColor: colors.primary, backgroundColor: colors.primaryFixed },
  optionIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center" },
  optionIconActive: { backgroundColor: colors.primary },
  optionText: { ...typography.bodyLg, color: colors.onSurface, flex: 1 },
  optionTextActive: { fontWeight: "700", color: colors.primary },
});
