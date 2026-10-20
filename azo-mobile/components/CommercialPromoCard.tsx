import React from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";

type Props = {
  code: string;
  link: string;
  /** Version réduite (accueil) : le code et un seul bouton. */
  compact?: boolean;
  /** Nom du commercial, repris dans le message de partage. */
  name?: string | null;
};

/** Texte envoyé par « Partager » : le lien personnel (qui mène à la page de téléchargement) et le code promo. */
export function promoMessage(code: string, link: string, name?: string | null) {
  return `${name ? `${name} te recommande AZƆ̀ !\n` : "Télécharge AZƆ̀ !\n"}Télécharge l'application avec ce lien : ${link}\nCode promo à saisir à l'inscription : ${code}`;
}

/** Code promo et lien personnel d'un commercial, avec le partage (message prêt à envoyer sur WhatsApp, SMS…). */
export default function CommercialPromoCard({ code, link, compact, name }: Props) {
  const share = (message: string) => {
    Share.share({ message }).catch(() => undefined);
  };
  return (
    <LinearGradient colors={[colors.primary, colors.primaryContainer]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
      <View style={styles.row}>
        <MaterialIcons name="confirmation-number" size={18} color="rgba(255,255,255,0.9)" />
        <Text style={styles.label}>Code promo</Text>
      </View>
      <Text style={styles.code} selectable>{code}</Text>
      {!compact ? (
        <>
          <Text style={styles.linkLabel}>Lien personnel de téléchargement</Text>
          <Text style={styles.link} selectable numberOfLines={2}>{link}</Text>
          <Text style={styles.hint}>Touche longuement le lien ou le code pour le copier.</Text>
        </>
      ) : null}
      <Pressable style={styles.shareBtn} onPress={() => share(promoMessage(code, link, name))} accessibilityRole="button">
        <MaterialIcons name="share" size={18} color={colors.primary} />
        <Text style={styles.shareText}>Partager mon lien</Text>
      </Pressable>
      {!compact ? (
        <Pressable style={styles.ghostBtn} onPress={() => share(`Code promo AZƆ̀ : ${code}`)} accessibilityRole="button">
          <Text style={styles.ghostText}>Partager seulement le code</Text>
        </Pressable>
      ) : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.xl, padding: spacing.md, gap: 4, elevation: 4, shadowColor: colors.primary, shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  label: { ...typography.labelMd, color: "rgba(255,255,255,0.9)", textTransform: "uppercase", letterSpacing: 0.6 },
  code: { ...typography.displayLgMobile, color: "#fff", fontWeight: "800", letterSpacing: 1.5 },
  linkLabel: { ...typography.labelMd, color: "rgba(255,255,255,0.85)", marginTop: spacing.xs },
  link: { ...typography.bodyMd, color: "#fff", fontWeight: "600" },
  hint: { ...typography.bodySm, color: "rgba(255,255,255,0.8)", fontSize: 11 },
  shareBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 46, borderRadius: radius.full, backgroundColor: "#fff", marginTop: spacing.sm },
  shareText: { ...typography.labelLg, color: colors.primary, fontWeight: "800" },
  ghostBtn: { alignItems: "center", paddingVertical: spacing.sm },
  ghostText: { ...typography.labelMd, color: "#fff", fontWeight: "700", textDecorationLine: "underline" },
});
