import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { LANGUAGES, LOCAL_VOICE_LANGUAGES, type LangCode, type LocalVoiceCode } from "../i18n";

type Props = {
  /** Langue d'application active (null quand une langue locale de voix est choisie) */
  selected: LangCode | null;
  onSelect: (lang: LangCode) => void;
  /** Option : langues locales pour la VOIX seule (Fon, Yoruba), avec titre et note */
  local?: { selected: LocalVoiceCode | null; onSelect: (code: LocalVoiceCode) => void; title: string; note: string };
  /** `dark` : sur le fond violet de l'onboarding · `light` : dans le profil (fond clair) */
  variant?: "dark" | "light";
};

/** Liste des langues proposées : drapeau, nom dans sa propre langue, coche sur la langue active. */
export default function LanguageList({ selected, onSelect, local, variant = "light" }: Props) {
  const dark = variant === "dark";
  return (
    <View style={styles.list} accessibilityRole="radiogroup">
      {LANGUAGES.map((language) => {
        const active = language.code === selected;
        return (
          <Pressable
            key={language.code}
            onPress={() => onSelect(language.code)}
            style={[
              styles.row,
              dark ? styles.rowDark : styles.rowLight,
              active && (dark ? styles.rowDarkActive : styles.rowLightActive),
            ]}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={language.native}
          >
            <Text style={styles.flag}>{language.flag}</Text>
            <Text
              style={[
                styles.name,
                dark ? styles.nameDark : styles.nameLight,
                active && (dark ? styles.nameDarkActive : styles.nameLightActive),
              ]}
            >
              {language.native}
            </Text>
            <View style={[styles.radio, active ? styles.radioActive : dark ? styles.radioDark : styles.radioLight]}>
              {active && <MaterialIcons name="check" size={16} color={colors.onPrimary} />}
            </View>
          </Pressable>
        );
      })}

      {local && (
        <>
          <Text style={[styles.sectionTitle, dark ? styles.nameDark : styles.nameLight]}>{local.title}</Text>
          <Text style={[styles.note, dark ? styles.noteDark : styles.noteLight]}>{local.note}</Text>
          {LOCAL_VOICE_LANGUAGES.map((language) => {
            const active = language.code === local.selected;
            return (
              <Pressable
                key={language.code}
                onPress={() => local.onSelect(language.code)}
                style={[styles.row, dark ? styles.rowDark : styles.rowLight, active && (dark ? styles.rowDarkActive : styles.rowLightActive)]}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={language.native}
              >
                <Text style={styles.flag}>{language.flag}</Text>
                <Text style={[styles.name, dark ? styles.nameDark : styles.nameLight, active && (dark ? styles.nameDarkActive : styles.nameLightActive)]}>{language.native}</Text>
                <View style={[styles.radio, active ? styles.radioActive : dark ? styles.radioDark : styles.radioLight]}>
                  {active && <MaterialIcons name="check" size={16} color={colors.onPrimary} />}
                </View>
              </Pressable>
            );
          })}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { ...typography.headlineSm, marginTop: spacing.md },
  note: { ...typography.bodySm, marginTop: -spacing.xs },
  noteDark: { color: `${colors.onPrimary}CC` },
  noteLight: { color: colors.onSurfaceVariant },
  list: { gap: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 60,
    paddingHorizontal: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1.5,
  },
  rowDark: { backgroundColor: `${colors.onPrimary}1A`, borderColor: `${colors.onPrimary}33` },
  rowDarkActive: { backgroundColor: colors.onPrimary, borderColor: colors.onPrimary },
  rowLight: { backgroundColor: colors.surfaceContainerLowest, borderColor: colors.surfaceContainer },
  rowLightActive: { backgroundColor: colors.primaryFixed, borderColor: colors.primary },
  flag: { fontSize: 28 },
  name: { ...typography.headlineSm, flex: 1 },
  nameDark: { color: colors.onPrimary },
  nameDarkActive: { color: colors.primary },
  nameLight: { color: colors.onSurface },
  nameLightActive: { color: colors.primary },
  radio: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  radioActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  radioDark: { borderColor: `${colors.onPrimary}66` },
  radioLight: { borderColor: colors.outlineVariant },
});
