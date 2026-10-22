import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { providersApi, type PhoneSupportInfo } from "../services/api";

const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });

/**
 * Prestataire (Speeder, coursier, livreur) dont le téléphone a été fourni par une boutique partenaire : il doit savoir clairement qu'une
 * commission téléphone est prélevée en plus de celle de l'entreprise, quand, et jusqu'à quelle date. N'affiche rien sans téléphone fourni
 * ou une fois les mois de prélèvement écoulés.
 */
export default function PhoneSupportBanner() {
  const [info, setInfo] = useState<PhoneSupportInfo | null>(null);
  useEffect(() => {
    providersApi
      .me()
      .then((me) => setInfo(me.provider?.phoneSupport ?? null))
      .catch(() => undefined);
  }, []);

  if (!info || !info.enrolled || !info.active || !info.until) return null;
  return (
    <View style={styles.box} accessibilityRole="summary">
      <View style={styles.icon}>
        <MaterialIcons name="smartphone" size={22} color={colors.primary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.title}>Téléphone fourni{info.shop ? ` par ${info.shop}` : " par une boutique partenaire"}</Text>
        <Text style={styles.body}>
          Pour rembourser ce téléphone, <Text style={styles.strong}>{String(info.commissionPct).replace(".", ",")} % de commission téléphone</Text> est prélevé sur
          {info.applyOn === "WEEKDAYS"
            ? " tes courses et livraisons du lundi au vendredi (pas le week-end)"
            : info.applyOn === "WEEKENDS"
              ? " tes courses et livraisons du samedi et du dimanche"
              : " chacune de tes courses et livraisons"}
          , en plus des 15 % de l'entreprise.
        </Text>
        <Text style={styles.until}>
          Depuis le {info.since ? day(info.since) : "—"} · jusqu'au {day(info.until)} ({info.durationMonths} mois)
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: colors.primaryFixed,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.primary,
    padding: spacing.sm + 2,
    marginBottom: spacing.sm,
  },
  icon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surfaceContainerLowest, alignItems: "center", justifyContent: "center" },
  title: { ...typography.labelLg, color: colors.onPrimaryFixed, fontWeight: "800" },
  body: { ...typography.bodySm, color: colors.onPrimaryFixed, lineHeight: 19 },
  strong: { fontWeight: "800" },
  until: { ...typography.labelSm, color: colors.onPrimaryFixed, opacity: 0.8, marginTop: 2 },
});
