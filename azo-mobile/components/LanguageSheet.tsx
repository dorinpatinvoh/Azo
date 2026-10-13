import React from "react";
import { Modal, View, Text, Pressable, StyleSheet } from "react-native";
import { colors, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import LanguageList from "./LanguageList";
import { useI18n } from "../i18n";

type Props = { visible: boolean; onClose: () => void };

/**
 * Feuille de choix de la langue, utilisée dans le profil. Toucher une langue change TOUTE
 * l'application tout de suite (le texte de cette feuille aussi) et ferme la feuille.
 */
export default function LanguageSheet({ visible, onClose }: Props) {
  const { t, lang, setLang } = useI18n();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Toucher le fond ferme la feuille */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t("common.close")} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>{t("lang.title")}</Text>
          <Text style={styles.subtitle}>{t("lang.subtitle")}</Text>
          <View style={{ height: spacing.md }} />
          <LanguageList
            selected={lang}
            onSelect={(code) => {
              setLang(code);
              onClose();
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(20, 0, 35, 0.55)" },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  handle: { alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: colors.outlineVariant, marginBottom: spacing.md },
  title: { ...typography.headlineMd, color: colors.onSurface },
  subtitle: { ...typography.bodyMd, color: colors.onSurfaceVariant, marginTop: 2 },
});
