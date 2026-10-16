import React, { useState } from "react";
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { useI18n } from "../i18n";
import { clearAvatar, pickAvatar, useAvatar } from "../utils/avatar";
import { BrandAlert } from ".//BrandAlert";

type Props = { visible: boolean; onClose: () => void };

/** Feuille « Photo de profil » : prendre une photo, choisir dans la galerie, ou retirer la photo. */
export default function AvatarSheet({ visible, onClose }: Props) {
  const { t } = useI18n();
  const avatar = useAvatar();
  const [busy, setBusy] = useState(false);

  async function pick(mode: "camera" | "library") {
    setBusy(true);
    try {
      const result = await pickAvatar(mode);
      if (result === "ok") onClose();
      else if (result === "denied") {
        BrandAlert.alert(
          t(mode === "camera" ? "avatar.denied.camera" : "avatar.denied.library"),
          t("avatar.denied.body"),
          [
            { text: t("common.cancel"), style: "cancel" },
            { text: t("ride.settings"), onPress: () => Linking.openSettings() },
          ]
        );
      }
    } catch {
      BrandAlert.alert(t("common.error"), t("avatar.failed"));
    } finally {
      setBusy(false);
    }
  }

  const rows: { id: string; icon: keyof typeof MaterialIcons.glyphMap; label: string; danger?: boolean; onPress: () => void }[] = [
    { id: "camera", icon: "photo-camera", label: t("avatar.camera"), onPress: () => pick("camera") },
    { id: "library", icon: "photo-library", label: t("avatar.library"), onPress: () => pick("library") },
  ];
  if (avatar) {
    rows.push({ id: "remove", icon: "delete-outline", label: t("avatar.remove"), danger: true, onPress: () => { clearAvatar(); onClose(); } });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t("common.close")} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>{t("avatar.title")}</Text>
          <Text style={styles.subtitle}>{t("avatar.note")}</Text>
          <View style={{ height: spacing.md }} />
          {busy ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
          ) : (
            rows.map((row) => (
              <Pressable key={row.id} style={styles.row} onPress={row.onPress} accessibilityRole="button">
                <View style={[styles.icon, row.danger && { backgroundColor: colors.errorContainer }]}>
                  <MaterialIcons name={row.icon} size={22} color={row.danger ? colors.error : colors.primary} />
                </View>
                <Text style={[styles.rowLabel, row.danger && { color: colors.error }]}>{row.label}</Text>
              </Pressable>
            ))
          )}
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
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  icon: { width: 44, height: 44, borderRadius: radius.full, backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center" },
  rowLabel: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
});
