import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { Conversation, Ride, RideChatMessage, messagesApi, ridesApi } from "../services/api";
import ClientTabBar, { ClientTab } from "../components/ClientTabBar";
import BackButton from "../components/BackButton";
import RideChatModal from "../components/RideChatModal";
import Avatar from "../components/Avatar";
import { maskPersonName } from "../utils/phone";
import { useI18n } from "../i18n";

type Props = {
  /** Retour à la page précédente (barre d'application). */
  onBack?: () => void;
  onNavigateTab: (tab: ClientTab) => void;
};

const ACTIVE = ["MATCHED", "ARRIVED", "IN_PROGRESS"];
const MAX_FALLBACK = 8;

const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "Z";

/**
 * Liste de secours tant que le serveur ne fournit pas `GET /messages/conversations` : on retrouve les
 * Speeder des courses passées (historique) et on lit les messages que le serveur a encore en mémoire.
 * Elle est donc incomplète — c'est justement la raison de la demande faite au backend.
 */
async function conversationsFromHistory(unknownName: string): Promise<Conversation[]> {
  const rides = await ridesApi.history();
  // Une entrée par Speeder : sa course la plus récente (l'historique arrive du plus récent au plus ancien)
  const latestByDriver = new Map<string, Ride>();
  for (const ride of rides) {
    if (!ride.driverId || !ride.driver || ride.status === "PENDING" || ride.status === "OFFERED") continue;
    if (!latestByDriver.has(ride.driverId)) latestByDriver.set(ride.driverId, ride);
  }
  const candidates = [...latestByDriver.values()].slice(0, MAX_FALLBACK);
  const withMessages = await Promise.all(
    candidates.map(async (ride) => {
      const messages: RideChatMessage[] = await ridesApi.messages(ride.id).catch(() => []);
      return { ride, messages };
    })
  );
  return withMessages
    .filter(({ messages }) => messages.length > 0)
    .map(({ ride, messages }): Conversation => {
      const last = messages[messages.length - 1];
      const active = ACTIVE.includes(ride.status);
      return {
        peer: {
          displayName: ride.driver?.profile?.displayName || ride.driver?.displayName || maskPersonName(ride.driver?.fullName, unknownName),
          role: "DRIVER",
          verified: ride.driver?.profile?.verified,
        },
        lastRideId: ride.id,
        lastRideStatus: ride.status,
        lastMessage: { text: last.text, at: last.createdAt, fromMe: last.senderRole === "CLIENT" },
        unreadCount: 0,
        activeRideId: active ? ride.id : null,
        canReply: active,
      };
    })
    .sort((a, b) => Date.parse(b.lastMessage?.at ?? "") - Date.parse(a.lastMessage?.at ?? ""));
}

/** Onglet « Messages » : les Speeder avec qui le client a déjà échangé, du plus récent au plus ancien. */
export default function MessagesScreen({ onBack, onNavigateTab }: Props) {
  const insets = useSafeAreaInsets();
  const { t, locale } = useI18n();
  const [items, setItems] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [limited, setLimited] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<{ rideId: string; name: string; locked: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await messagesApi.conversations();
      setItems(res.items ?? []);
      setLimited(false);
      setFailed(false);
    } catch {
      // Route pas encore disponible (ou serveur lent) : liste de secours à partir de l'historique
      try {
        setItems(await conversationsFromHistory(t("live.driverDefault")));
        setLimited(true);
        setFailed(false);
      } catch {
        setFailed(true);
      }
    }
  }, [t]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  function whenLabel(iso?: string) {
    if (!iso) return "";
    const d = new Date(iso);
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay
      ? d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString(locale, { day: "numeric", month: "short" });
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <View style={[styles.appBar, { paddingTop: insets.top + spacing.sm }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          {onBack ? <BackButton onPress={onBack} /> : null}
          <Text style={styles.appBarTitle}>{t("msg.title")}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {limited && items.length > 0 && (
          <View style={styles.note}>
            <MaterialIcons name="info-outline" size={16} color={colors.onSurfaceVariant} />
            <Text style={styles.noteText}>{t("msg.fallback")}</Text>
          </View>
        )}

        {loading && <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />}

        {!loading && failed && (
          <View style={styles.empty}>
            <MaterialIcons name="cloud-off" size={44} color={colors.outlineVariant} />
            <Text style={styles.emptyText}>{t("msg.loadFailed")}</Text>
          </View>
        )}

        {!loading && !failed && items.length === 0 && (
          <View style={styles.empty}>
            <MaterialIcons name="chat-bubble-outline" size={48} color={colors.outlineVariant} />
            <Text style={styles.emptyTitle}>{t("msg.empty.title")}</Text>
            <Text style={styles.emptyText}>{t("msg.empty.text")}</Text>
          </View>
        )}

        <View style={{ gap: spacing.sm }}>
          {items.map((c) => {
            const name = c.peer.displayName || t("live.driverDefault");
            const unread = c.unreadCount ?? 0;
            const rideId = c.activeRideId ?? c.lastRideId;
            const locked = !(c.canReply ?? !!c.activeRideId);
            const preview = c.lastMessage
              ? c.lastMessage.fromMe
                ? t("msg.you", { text: c.lastMessage.text })
                : c.lastMessage.text
              : "";
            return (
              <Pressable
                key={`${c.lastRideId}`}
                style={styles.row}
                onPress={() => setOpen({ rideId, name, locked })}
                accessibilityRole="button"
              >
                <Avatar uri={c.peer.photoUrl ?? null} initials={initialsOf(name)} size={48} fontSize={17} />
                <View style={{ flex: 1 }}>
                  <View style={styles.titleRow}>
                    <Text style={[styles.name, unread > 0 && styles.nameUnread]} numberOfLines={1}>{name}</Text>
                    {c.peer.verified && <MaterialIcons name="verified" size={14} color={colors.primary} />}
                  </View>
                  <Text style={[styles.preview, unread > 0 && styles.previewUnread]} numberOfLines={1}>{preview}</Text>
                  <View style={styles.metaRow}>
                    {locked ? (
                      <View style={styles.lockPill}>
                        <MaterialIcons name="lock-outline" size={11} color={colors.onSurfaceVariant} />
                        <Text style={styles.lockText}>{t("msg.readOnly")}</Text>
                      </View>
                    ) : null}
                    {typeof c.ridesCount === "number" && c.ridesCount > 1 && (
                      <Text style={styles.metaText}>{t("msg.rides", { n: c.ridesCount })}</Text>
                    )}
                  </View>
                </View>
                <View style={styles.side}>
                  <Text style={styles.when}>{whenLabel(c.lastMessage?.at)}</Text>
                  {unread > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{unread > 99 ? "99+" : unread}</Text>
                    </View>
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <ClientTabBar active="messages" onNavigate={onNavigateTab} />

      {open && (
        <RideChatModal
          visible
          rideId={open.rideId}
          myRole="CLIENT"
          peerName={open.name}
          locked={open.locked}
          onClose={() => {
            setOpen(null);
            load();
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  appBar: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: `${colors.primaryFixed}99`,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  appBarTitle: { ...typography.headlineLg, color: colors.onSurface },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  note: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.surfaceContainer, borderRadius: radius.lg, padding: spacing.sm, marginBottom: spacing.sm },
  noteText: { ...typography.bodySm, color: colors.onSurfaceVariant, flex: 1 },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl },
  emptyTitle: { ...typography.headlineSm, color: colors.onSurface },
  emptyText: { ...typography.bodyMd, color: colors.onSurfaceVariant, textAlign: "center", paddingHorizontal: spacing.lg },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 2, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.surfaceContainer, padding: spacing.sm + 2 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  name: { ...typography.labelLg, color: colors.onSurface, flexShrink: 1 },
  nameUnread: { fontWeight: "800" },
  preview: { ...typography.bodyMd, color: colors.onSurfaceVariant, marginTop: 1 },
  previewUnread: { color: colors.onSurface, fontWeight: "600" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 3 },
  metaText: { ...typography.labelSm, color: colors.outline },
  lockPill: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: colors.surfaceContainer, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  lockText: { ...typography.labelSm, color: colors.onSurfaceVariant },
  side: { alignItems: "flex-end", gap: 6 },
  when: { ...typography.labelSm, color: colors.outline },
  badge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: colors.secondaryContainer, alignItems: "center", justifyContent: "center" },
  badgeText: { ...typography.labelSm, color: colors.onSecondaryFixed, fontWeight: "800" },
});
