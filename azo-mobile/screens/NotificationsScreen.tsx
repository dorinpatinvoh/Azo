import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";

const GROUPS = [
  {
    day: "Aujourd'hui",
    items: [
      { id: 1, icon: "two-wheeler" as const, title: "Nouvelle course acceptée", meta: "Moussa Adékambi arrive dans 3 min", time: "10:39", unread: true },
      { id: 2, icon: "payments" as const, title: "Paiement reçu", meta: "650 FCFA débités · Trajet #AZ-912", time: "10:42", unread: true },
      { id: 3, icon: "star" as const, title: "Évaluation enregistrée", meta: "Merci d'avoir noté votre course", time: "10:45", unread: false },
    ],
  },
  {
    day: "Hier",
    items: [
      { id: 4, icon: "local-shipping" as const, title: "Colis livré", meta: "Code de remise validé à Akpakpa", time: "16:12", unread: false },
      { id: 5, icon: "campaign" as const, title: "Nouvelle offre AZƆ̀", meta: "-100 FCFA sur ta prochaine course", time: "09:00", unread: false },
    ],
  },
];

type Props = { onBack: () => void };

export default function NotificationsScreen({ onBack }: Props) {
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.iconButton}>
          <MaterialIcons name="arrow-back-ios-new" size={18} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Notifications</Text>
        <Pressable>
          <Text style={styles.markRead}>Tout marquer lu</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {GROUPS.map((g) => (
          <View key={g.day} style={{ marginBottom: spacing.md }}>
            <Text style={styles.dayLabel}>{g.day}</Text>
            <View style={{ gap: spacing.sm }}>
              {g.items.map((n) => (
                <View key={n.id} style={styles.notifRow}>
                  <View style={[styles.notifIcon, n.unread && { backgroundColor: colors.primaryFixed }]}>
                    <MaterialIcons name={n.icon} size={20} color={n.unread ? colors.primary : colors.onSurfaceVariant} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.notifTitle}>{n.title}</Text>
                    <Text style={styles.notifMeta}>{n.meta}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Text style={styles.notifTime}>{n.time}</Text>
                    {n.unread && <View style={styles.unreadDot} />}
                  </View>
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { height: 56, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  iconButton: { width: 40, height: 40, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...typography.headlineSm, color: colors.onSurface },
  markRead: { ...typography.labelMd, color: colors.primary, fontWeight: "700" },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  dayLabel: { ...typography.labelMd, color: colors.outline, textTransform: "uppercase", marginBottom: spacing.sm },
  notifRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.md, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  notifIcon: { width: 40, height: 40, borderRadius: radius.full, backgroundColor: colors.surfaceContainer, alignItems: "center", justifyContent: "center" },
  notifTitle: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  notifMeta: { ...typography.bodySm, color: colors.onSurfaceVariant, marginTop: 2 },
  notifTime: { ...typography.labelSm, color: colors.outline },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.secondary },
});
