import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import PrimaryButton from "../components/PrimaryButton";
import { ridesApi } from "../services/api";

const COMPLIMENTS = [
  { id: "clean", label: "Casque propre & désinfecté", icon: "sanitizer" as const },
  { id: "smooth", label: "Conduite fluide", icon: "two-wheeler" as const },
  { id: "polite", label: "Ponctuel & courtois", icon: "sentiment-satisfied" as const },
  { id: "route", label: "Itinéraire parfait", icon: "alt-route" as const },
];

const TIPS = [0, 100, 200, 500];

type Props = { onDone: () => void; rideId?: string };

export default function RideRatingScreen({ onDone, rideId }: Props) {
  const [stars, setStars] = useState(4);
  const [selectedCompliments, setSelectedCompliments] = useState<string[]>(["clean", "smooth"]);
  const [tip, setTip] = useState(100);

  // Envoie la note au backend (si on vient d'une vraie course)
  async function handleSend() {
    try {
      if (rideId) await ridesApi.rate(rideId, stars);
      onDone();
    } catch (e: any) {
      Alert.alert("Erreur", e.message);
    }
  }

  function toggleCompliment(id: string) {
    setSelectedCompliments((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.successBlock}>
          <View style={styles.successIcon}>
            <MaterialIcons name="check-circle" size={36} color={colors.primary} />
          </View>
          <Text style={styles.tripId}>Course AZƆ̀ Express #8492</Text>
          <Text style={styles.successText}>Trajet terminé avec succès !</Text>
          <Text style={styles.arrivalText}>Arrivé à Marché Dantokpa à 10:42</Text>
        </View>

        <View style={styles.driverCard}>
          <View style={styles.driverAvatar}>
            <MaterialIcons name="person" size={26} color={colors.onSurfaceVariant} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.driverName}>Moussa Adékambi</Text>
            <View style={styles.ratingRow}>
              <MaterialIcons name="star" size={14} color={colors.tertiaryFixedDim} />
              <Text style={styles.driverRating}>4.96 · Zémidjan Certifié AZƆ̀ Pro</Text>
            </View>
            <Text style={styles.plate}>RB-5421-AX · Bajaj Boxer 150cc</Text>
          </View>
        </View>

        <Text style={styles.question}>Comment s'est passée votre course ?</Text>
        <View style={styles.starsRow}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Pressable key={i} onPress={() => setStars(i)}>
              <MaterialIcons
                name="star"
                size={36}
                color={i <= stars ? colors.tertiaryFixedDim : colors.surfaceContainer}
              />
            </Pressable>
          ))}
        </View>
        <Text style={styles.starsLabel}>Très bien ! {stars}/5</Text>

        <Text style={styles.sectionLabel}>Vos compliments à Moussa</Text>
        <View style={styles.complimentGrid}>
          {COMPLIMENTS.map((c) => {
            const active = selectedCompliments.includes(c.id);
            return (
              <Pressable
                key={c.id}
                style={[styles.complimentChip, active && styles.complimentChipActive]}
                onPress={() => toggleCompliment(c.id)}
              >
                <MaterialIcons name={c.icon} size={16} color={active ? colors.onPrimary : colors.onSurfaceVariant} />
                <Text style={[styles.complimentText, active && { color: colors.onPrimary }]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>Ajouter un pourboire (100% reversé)</Text>
        <View style={styles.tipRow}>
          {TIPS.map((t) => (
            <Pressable
              key={t}
              style={[styles.tipChip, tip === t && styles.tipChipActive]}
              onPress={() => setTip(t)}
            >
              <Text style={[styles.tipText, tip === t && { color: colors.onPrimary }]}>
                {t === 0 ? "0 F" : `${t} F`}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <PrimaryButton label="Envoyer mon évaluation" icon="check" onPress={handleSend} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  successBlock: { alignItems: "center", marginBottom: spacing.md },
  successIcon: { width: 64, height: 64, borderRadius: radius.full, backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm },
  tripId: { ...typography.labelSm, color: colors.outline },
  successText: { ...typography.headlineMd, color: colors.onSurface, fontWeight: "700", marginTop: 2 },
  arrivalText: { ...typography.bodySm, color: colors.onSurfaceVariant, marginTop: 2 },
  driverCard: { flexDirection: "row", gap: spacing.sm, alignItems: "center", backgroundColor: colors.surfaceContainerLow, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  driverAvatar: { width: 48, height: 48, borderRadius: radius.full, backgroundColor: colors.surfaceContainer, alignItems: "center", justifyContent: "center" },
  driverName: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  driverRating: { ...typography.labelSm, color: colors.onSurfaceVariant },
  plate: { ...typography.bodySm, color: colors.onSurfaceVariant, marginTop: 2 },
  question: { ...typography.headlineSm, color: colors.onSurface, textAlign: "center", marginBottom: spacing.sm },
  starsRow: { flexDirection: "row", justifyContent: "center", gap: 6 },
  starsLabel: { ...typography.labelMd, color: colors.onSurfaceVariant, textAlign: "center", marginTop: 4, marginBottom: spacing.md },
  sectionLabel: { ...typography.labelMd, color: colors.onSurfaceVariant, marginBottom: spacing.xs, marginTop: spacing.sm },
  complimentGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  complimentChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.full, backgroundColor: colors.surfaceContainerLow },
  complimentChipActive: { backgroundColor: colors.primary },
  complimentText: { ...typography.labelSm, color: colors.onSurfaceVariant },
  tipRow: { flexDirection: "row", gap: 8 },
  tipChip: { flex: 1, paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.surfaceContainerLow, alignItems: "center" },
  tipChipActive: { backgroundColor: colors.secondary },
  tipText: { ...typography.labelMd, color: colors.onSurfaceVariant, fontWeight: "700" },
});
