import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { useI18n } from "../i18n";
import { SCHEDULE_MAX_DAYS, SCHEDULE_MIN_LEAD_MIN } from "../config/schedule";

type Props = {
  value: Date | null;
  onChange: (value: Date | null) => void;
  /** Appelé quand on bascule entre « Maintenant » et « Programmer » (pour bloquer la confirmation tant qu'aucune heure n'est choisie). */
  onModeChange?: (later: boolean) => void;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Créneaux d'un jour donné : au plus tôt dans (délai minimal + 5 min), au plus tard dans 7 jours. Pas de 15 min aujourd'hui, 30 min ensuite. */
export function slotsForDay(dayOffset: number, now: Date = new Date()): Date[] {
  const earliest = new Date(now.getTime() + (SCHEDULE_MIN_LEAD_MIN + 5) * 60_000);
  const latest = new Date(now.getTime() + SCHEDULE_MAX_DAYS * 24 * 3600_000 - 3600_000);
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, 0, 0, 0, 0);
  const step = dayOffset === 0 ? 15 : 30;
  const slots: Date[] = [];
  for (let t = dayStart.getTime(); t < dayStart.getTime() + 24 * 3600_000; t += step * 60_000) {
    const slot = new Date(t);
    if (slot >= earliest && slot <= latest) slots.push(slot);
  }
  return slots;
}

/** Choix « Maintenant » ou « Programmer » avec jour puis heure de prise en charge. */
export default function SchedulePicker({ value, onChange, onModeChange }: Props) {
  const { t, locale } = useI18n();
  const [later, setLater] = useState(value !== null);
  const [day, setDay] = useState(0);
  const slots = useMemo(() => slotsForDay(day), [day]);

  const dayLabel = (offset: number) => {
    if (offset === 0) return t("sched.today");
    if (offset === 1) return t("sched.tomorrow");
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString(locale, { weekday: "short", day: "numeric" });
  };

  return (
    <View style={styles.box}>
      <View style={styles.row}>
        {[false, true].map((isLater) => (
          <Pressable
            key={String(isLater)}
            style={[styles.chip, later === isLater && styles.chipActive]}
            onPress={() => {
              setLater(isLater);
              onModeChange?.(isLater);
              if (!isLater) onChange(null);
            }}
          >
            <Text style={[styles.chipText, later === isLater && styles.chipTextActive]}>{isLater ? t("sched.later") : t("sched.now")}</Text>
          </Pressable>
        ))}
      </View>

      {later && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {Array.from({ length: SCHEDULE_MAX_DAYS }, (_, offset) => (
              <Pressable key={offset} style={[styles.chip, day === offset && styles.chipActive]} onPress={() => { setDay(offset); onChange(null); }}>
                <Text style={[styles.chipText, day === offset && styles.chipTextActive]}>{dayLabel(offset)}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {slots.length === 0 ? (
            <Text style={styles.hint}>{t("sched.none")}</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {slots.map((slot) => {
                const selected = value?.getTime() === slot.getTime();
                return (
                  <Pressable key={slot.getTime()} style={[styles.chip, selected && styles.chipActive]} onPress={() => onChange(slot)}>
                    <Text style={[styles.chipText, selected && styles.chipTextActive]}>{pad(slot.getHours())}:{pad(slot.getMinutes())}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
          {value ? (
            <Text style={styles.at}>
              {t("sched.at", {
                date: value.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" }),
                time: `${pad(value.getHours())}:${pad(value.getMinutes())}`,
              })}
            </Text>
          ) : null}
          <Text style={styles.hint}>{t("sched.hint")}</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.xs, marginVertical: spacing.xs },
  row: { flexDirection: "row", gap: spacing.xs, alignItems: "center" },
  chip: { paddingHorizontal: 14, height: 36, borderRadius: radius.full, backgroundColor: colors.surfaceContainer, alignItems: "center", justifyContent: "center" },
  chipActive: { backgroundColor: colors.primary },
  chipText: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  chipTextActive: { color: "#fff" },
  hint: { ...typography.bodySm, color: colors.onSurfaceVariant },
  at: { ...typography.labelMd, color: colors.primary, fontWeight: "800" },
});
