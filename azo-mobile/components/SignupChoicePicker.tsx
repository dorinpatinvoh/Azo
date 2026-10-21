import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { useI18n, type MessageKey } from "../i18n";
import type { AccountKind } from "./AccountKindPicker";
import {
  AGENCY_LEVEL_CHOICES,
  COURIER_EXPRESS_VEHICLE_OPTIONS,
  COURIER_PERSONAL_VEHICLE_OPTIONS,
  DRIVER_VEHICLE_OPTIONS,
  vehicleIcon,
} from "../utils/providerChoices";

type Props = {
  kind: AccountKind;
  /** Valeur choisie : un type de véhicule (Speeder, coursier) ou un niveau d'agence ; `null` tant que rien n'est choisi. */
  value: string | null;
  onChange: (value: string) => void;
};

const TITLE_KEY: Record<Exclude<AccountKind, "CLIENT">, MessageKey> = {
  DRIVER: "auth.choice.driver",
  COURIER_PERSONAL: "auth.choice.courierPersonal",
  COURIER_EXPRESS: "auth.choice.courierExpress",
  AGENCY: "auth.choice.agency",
};

/**
 * Deuxième choix de l'inscription professionnelle, juste sous le type de compte : le type de Speeder ou de coursier (véhicule), ou le
 * niveau de l'agence. Il se fait à la création du compte : le dossier démarre directement à l'identité.
 */
export default function SignupChoicePicker({ kind, value, onChange }: Props) {
  const { t } = useI18n();
  if (kind === "CLIENT") return null;

  const rows =
    kind === "AGENCY"
      ? AGENCY_LEVEL_CHOICES.map((a) => ({ id: a.plan as string, label: a.label, hint: a.hint, icon: "workspace-premium" as keyof typeof MaterialIcons.glyphMap }))
      : (kind === "DRIVER" ? DRIVER_VEHICLE_OPTIONS : kind === "COURIER_PERSONAL" ? COURIER_PERSONAL_VEHICLE_OPTIONS : COURIER_EXPRESS_VEHICLE_OPTIONS).map((v) => ({
          id: v.value as string,
          label: v.label,
          hint: v.hint,
          icon: vehicleIcon(v.value),
        }));

  return (
    <View style={styles.box}>
      <View style={styles.titleRow}>
        <MaterialIcons name={kind === "AGENCY" ? "apartment" : "two-wheeler"} size={16} color={colors.primary} />
        <Text style={styles.title}>{t(TITLE_KEY[kind])}</Text>
      </View>
      {rows.map((r) => {
        const selected = value === r.id;
        return (
          <Pressable
            key={r.id}
            style={[styles.row, selected && styles.rowActive]}
            onPress={() => onChange(r.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
          >
            <View style={[styles.icon, selected && styles.iconActive]}>
              <MaterialIcons name={r.icon} size={20} color={selected ? colors.onPrimary : colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, selected && styles.labelActive]}>{r.label}</Text>
              <Text style={styles.hint}>{r.hint}</Text>
            </View>
            <MaterialIcons name={selected ? "check-circle" : "radio-button-unchecked"} size={20} color={selected ? colors.primary : colors.outline} />
          </Pressable>
        );
      })}
      {!value ? <Text style={styles.required}>{t("auth.choice.required")}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.xs + 2 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.xs },
  title: { ...typography.labelLg, color: colors.onSurface, fontWeight: "800" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.surfaceContainer, backgroundColor: colors.surfaceContainerLowest },
  rowActive: { borderColor: colors.primary, backgroundColor: colors.primaryFixed },
  icon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center" },
  iconActive: { backgroundColor: colors.primary },
  label: { ...typography.bodyMd, color: colors.onSurface, fontWeight: "700" },
  labelActive: { color: colors.primary },
  hint: { ...typography.bodySm, color: colors.onSurfaceVariant, marginTop: 1 },
  required: { ...typography.labelSm, color: colors.error },
});
