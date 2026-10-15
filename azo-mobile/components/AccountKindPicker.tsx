import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { useI18n, type MessageKey } from "../i18n";

/** Profil choisi à l'inscription : Client, Spider (Zem), Coursier personnel, Livreur express ou Agence de flotte. */
export type AccountKind = "CLIENT" | "DRIVER" | "COURIER_PERSONAL" | "COURIER_EXPRESS" | "AGENCY";

const OPTIONS: { value: AccountKind; labelKey: MessageKey; descKey: MessageKey; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { value: "CLIENT", labelKey: "auth.kind.client", descKey: "auth.kind.desc.client", icon: "person" },
  { value: "DRIVER", labelKey: "auth.kind.driver", descKey: "auth.kind.desc.driver", icon: "two-wheeler" },
  { value: "COURIER_PERSONAL", labelKey: "auth.kind.courierPersonal", descKey: "auth.kind.desc.courierPersonal", icon: "directions-run" },
  { value: "COURIER_EXPRESS", labelKey: "auth.kind.courierExpress", descKey: "auth.kind.desc.courierExpress", icon: "local-shipping" },
  { value: "AGENCY", labelKey: "auth.kind.agency", descKey: "auth.kind.desc.agency", icon: "apartment" },
];

type Props = { value: AccountKind; onChange: (kind: AccountKind) => void };

/**
 * Liste déroulante (combobox) du type de compte : Client, Spider (Zem), Coursier personnel, Livreur express ou Agence de flotte.
 * Chaque profil a son icône et une phrase d'explication. Le choix détermine le parcours d'inscription proposé ensuite.
 */
export default function AccountKindPicker({ value, onChange }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0];

  return (
    <>
      <Pressable style={styles.field} onPress={() => setOpen(true)} accessibilityRole="combobox" accessibilityLabel={t("auth.kind.title")}>
        <LinearGradient colors={[colors.primary, colors.secondaryContainer]} style={styles.badge}>
          <MaterialIcons name={current.icon} size={24} color={colors.onPrimary} />
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldTitle} numberOfLines={2}>{t(current.labelKey)}</Text>
          <Text style={styles.fieldDesc} numberOfLines={2}>{t(current.descKey)}</Text>
        </View>
        <MaterialIcons name="expand-more" size={26} color={colors.primary} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <SafeAreaView edges={["bottom"]} style={styles.sheetWrap}>
            <Pressable style={styles.sheet} onPress={() => undefined}>
              <View style={styles.grabber} />
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
                      <MaterialIcons name={o.icon} size={22} color={selected ? colors.onPrimary : colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.optionText, selected && styles.optionTextActive]}>{t(o.labelKey)}</Text>
                      <Text style={styles.optionDesc}>{t(o.descKey)}</Text>
                    </View>
                    <MaterialIcons name={selected ? "check-circle" : "radio-button-unchecked"} size={22} color={selected ? colors.primary : colors.outline} />
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
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
    minHeight: 72,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.primaryFixed + "55",
  },
  badge: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  fieldTitle: { ...typography.bodyLg, color: colors.onSurface, fontWeight: "800" },
  fieldDesc: { ...typography.bodySm, color: colors.onSurfaceVariant, marginTop: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheetWrap: { backgroundColor: "transparent" },
  sheet: { backgroundColor: colors.surfaceContainerLowest, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.md, gap: spacing.sm },
  grabber: { alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: colors.outlineVariant, marginBottom: spacing.xs },
  sheetTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800", marginBottom: spacing.xs },
  option: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 68, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.surfaceContainer },
  optionActive: { borderColor: colors.primary, backgroundColor: colors.primaryFixed },
  optionIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center" },
  optionIconActive: { backgroundColor: colors.primary },
  optionText: { ...typography.bodyLg, color: colors.onSurface, fontWeight: "700" },
  optionTextActive: { color: colors.primary },
  optionDesc: { ...typography.bodySm, color: colors.onSurfaceVariant, marginTop: 1 },
});
