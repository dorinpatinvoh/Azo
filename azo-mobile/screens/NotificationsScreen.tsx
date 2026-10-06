import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { AppNotification, errorMessage, notificationsApi } from "../services/api";

/**
 * Notifications AZƆ̀ — **alimentées par le serveur** (`GET /notifications`).
 *
 * Chaque événement de la vie d'une course y dépose une ligne côté serveur : nouvelle
 * demande publiée (chauffeurs), chauffeur trouvé, course terminée, paiement reçu,
 * demande expirée faute de chauffeur, annulation… Aucune donnée de démonstration n'est
 * affichée : si le serveur ne répond pas, l'écran le dit clairement.
 */

type Props = { onBack: () => void };

type IconName = keyof typeof MaterialIcons.glyphMap;

/** Icône d'une notification selon son type serveur. */
function iconFor(type: string): IconName {
  switch ((type ?? "").toLowerCase()) {
    case "ride":
      return "two-wheeler";
    case "payment":
      return "payments";
    case "delivery":
      return "local-shipping";
    case "provider":
      return "verified-user";
    default:
      return "notifications-none";
  }
}

/** Regroupement par jour, dans l'esprit de l'ancien écran (« Aujourd'hui », « Hier »). */
function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOfDay(today) - startOfDay(date)) / 86400000);
  if (diff <= 0) return "Aujourd'hui";
  if (diff === 1) return "Hier";
  return date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

const heure = (iso: string) =>
  new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

export default function NotificationsScreen({ onBack }: Props) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await notificationsApi.list();
      setItems(Array.isArray(list) ? list : []);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const unreadCount = useMemo(() => items.filter((n) => !n.read).length, [items]);

  const onMarkAllRead = useCallback(async () => {
    if (unreadCount === 0 || marking) return;
    setMarking(true);
    // Marque aussi l'affichage local : l'utilisateur voit le résultat immédiatement.
    setItems((current) => current.map((n) => ({ ...n, read: true })));
    try {
      await notificationsApi.readAll();
    } catch (e) {
      setError(errorMessage(e));
      await load();
    } finally {
      setMarking(false);
    }
  }, [unreadCount, marking, load]);

  /* Regroupe les notifications par jour, du plus récent au plus ancien (ordre serveur). */
  const groups = useMemo(() => {
    const ordered: { day: string; items: AppNotification[] }[] = [];
    for (const n of items) {
      const day = dayLabel(n.createdAt);
      const last = ordered[ordered.length - 1];
      if (last && last.day === day) last.items.push(n);
      else ordered.push({ day, items: [n] });
    }
    return ordered;
  }, [items]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.iconButton}>
          <MaterialIcons name="arrow-back-ios-new" size={18} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>
          Notifications{unreadCount > 0 ? ` (${unreadCount})` : ""}
        </Text>
        <Pressable onPress={onMarkAllRead} disabled={unreadCount === 0 || marking}>
          <Text style={[styles.markRead, unreadCount === 0 && { color: colors.outline }]}>
            {marking ? "…" : "Tout marquer lu"}
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {error && (
            <View style={styles.banner}>
              <MaterialIcons name="wifi-off" size={18} color={colors.error} />
              <Text style={styles.bannerText}>{error}</Text>
            </View>
          )}

          {items.length === 0 ? (
            <View style={styles.center}>
              <MaterialIcons name="notifications-none" size={40} color={colors.outline} />
              <Text style={styles.emptyTitle}>Aucune notification</Text>
              <Text style={styles.emptyText}>
                Les nouvelles demandes, les courses acceptées et les paiements AZƆ̀ Pay
                apparaîtront ici. Tire vers le bas pour actualiser.
              </Text>
            </View>
          ) : (
            groups.map((g) => (
              <View key={g.day} style={{ marginBottom: spacing.md }}>
                <Text style={styles.dayLabel}>{g.day}</Text>
                <View style={{ gap: spacing.sm }}>
                  {g.items.map((n) => (
                    <View key={n.id} style={styles.notifRow}>
                      <View style={[styles.notifIcon, !n.read && { backgroundColor: colors.primaryFixed }]}>
                        <MaterialIcons
                          name={iconFor(n.type)}
                          size={20}
                          color={n.read ? colors.onSurfaceVariant : colors.primary}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.notifTitle}>{n.title}</Text>
                        <Text style={styles.notifMeta}>{n.body}</Text>
                      </View>
                      <View style={{ alignItems: "flex-end", gap: 4 }}>
                        <Text style={styles.notifTime}>{heure(n.createdAt)}</Text>
                        {!n.read && <View style={styles.unreadDot} />}
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
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
  center: { alignItems: "center", gap: 8, padding: spacing.lg },
  emptyTitle: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  emptyText: { ...typography.bodySm, color: colors.onSurfaceVariant, textAlign: "center" },
  banner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.errorContainer, padding: spacing.sm, borderRadius: radius.lg, marginBottom: spacing.sm },
  bannerText: { ...typography.bodySm, color: colors.error, flex: 1 },
  dayLabel: { ...typography.labelMd, color: colors.outline, textTransform: "uppercase", marginBottom: spacing.sm },
  notifRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.md, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  notifIcon: { width: 40, height: 40, borderRadius: radius.full, backgroundColor: colors.surfaceContainer, alignItems: "center", justifyContent: "center" },
  notifTitle: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  notifMeta: { ...typography.bodySm, color: colors.onSurfaceVariant, marginTop: 2 },
  notifTime: { ...typography.labelSm, color: colors.outline },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.secondary },
});
