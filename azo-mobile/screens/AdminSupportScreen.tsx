import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { SupportStatus, SupportTicket, SupportTicketSummary, errorMessage, supportApi } from "../services/api";
import { useI18n } from "../i18n";

const FILTERS: (SupportStatus | undefined)[] = ["OPEN", "ANSWERED", "CLOSED", undefined];
const STATUS_COLOR: Record<SupportStatus, string> = { OPEN: "#b45309", ANSWERED: "#0a7a3b", CLOSED: "#5d5662" };

/** Espace administrateur : demandes d'assistance à traiter, réponse et clôture. */
export default function AdminSupportScreen({ onBack }: { onBack: () => void }) {
  const { t, locale } = useI18n();
  const [filter, setFilter] = useState<SupportStatus | undefined>("OPEN");
  const [tickets, setTickets] = useState<SupportTicketSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<SupportTicket | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setTickets((await supportApi.admin.list(filter)).tickets);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [filter]);
  useEffect(() => {
    setTickets(null);
    load();
  }, [load]);

  async function openTicket(id: string) {
    try {
      setOpen(await supportApi.admin.get(id));
      setReply("");
    } catch (e) {
      Alert.alert(t("common.error"), errorMessage(e));
    }
  }

  async function sendReply() {
    if (!open || !reply.trim()) return;
    setBusy(true);
    try {
      await supportApi.admin.reply(open.id, reply.trim());
      setReply("");
      setOpen(await supportApi.admin.get(open.id));
    } catch (e) {
      Alert.alert(t("common.error"), errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    if (!open) return;
    setBusy(true);
    try {
      await supportApi.admin.close(open.id);
      setOpen(await supportApi.admin.get(open.id));
    } catch (e) {
      Alert.alert(t("common.error"), errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const back = () => {
    if (open) {
      setOpen(null);
      load();
    } else onBack();
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={back} style={styles.iconButton} accessibilityLabel={t("common.back")}>
          <MaterialIcons name="arrow-back-ios-new" size={18} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{open ? open.subject : t("sup.admin.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {!open ? (
          <ScrollView contentContainerStyle={styles.scroll}>
            <View style={styles.chips}>
              {FILTERS.map((f) => (
                <Pressable key={f ?? "all"} style={[styles.chip, filter === f && styles.chipActive]} onPress={() => setFilter(f)}>
                  <Text style={[styles.chipText, filter === f && { color: "#fff" }]}>{f ? t(`sup.status.${f}` as const) : t("sup.admin.all")}</Text>
                </Pressable>
              ))}
            </View>
            {tickets === null && !failed ? <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} /> : null}
            {failed ? (
              <Pressable onPress={load}>
                <Text style={styles.muted}>{t("sup.loadError")} {t("common.retry")}</Text>
              </Pressable>
            ) : null}
            {tickets && tickets.length === 0 ? <Text style={styles.muted}>{t("sup.empty")}</Text> : null}
            {(tickets ?? []).map((tk) => (
              <Pressable key={tk.id} style={styles.card} onPress={() => openTicket(tk.id)}>
                <View style={styles.cardTop}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{tk.subject}</Text>
                  <Text style={[styles.status, { color: STATUS_COLOR[tk.status] }]}>{t(`sup.status.${tk.status}` as const)}</Text>
                </View>
                <Text style={styles.muted} numberOfLines={2}>{tk.lastMessage?.text ?? ""}</Text>
                <Text style={styles.meta}>
                  {tk.user?.fullName ?? tk.user?.phone ?? ""} · {t(`sup.cat.${tk.category}` as const)} · {new Date(tk.updatedAt).toLocaleDateString(locale)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <>
            <ScrollView contentContainerStyle={styles.scroll}>
              <Text style={styles.meta}>
                {open.user?.fullName ?? ""} · {open.user?.phone ?? ""} · {open.user?.role ?? ""} · {t(`sup.cat.${open.category}` as const)}
              </Text>
              {open.messages.map((m) => (
                <View key={m.id} style={[styles.bubble, m.authorRole === "ADMIN" ? styles.bubbleMine : styles.bubbleTeam]}>
                  <Text style={styles.bubbleWho}>{m.authorRole === "ADMIN" ? t("sup.team") : open.user?.fullName ?? t("sup.you")}</Text>
                  <Text style={styles.bubbleText}>{m.text}</Text>
                </View>
              ))}
            </ScrollView>
            {open.status === "CLOSED" ? (
              <Text style={[styles.muted, { padding: spacing.md }]}>{t("sup.status.CLOSED")}</Text>
            ) : (
              <View style={{ padding: spacing.sm, gap: spacing.xs }}>
                <View style={styles.replyRow}>
                  <TextInput style={[styles.input, { flex: 1, marginBottom: 0 }]} value={reply} onChangeText={setReply} placeholder={t("sup.reply")} placeholderTextColor={colors.outline} multiline maxLength={2000} />
                  <Pressable style={[styles.sendBtn, (busy || !reply.trim()) && { opacity: 0.5 }]} disabled={busy || !reply.trim()} onPress={sendReply}>
                    <MaterialIcons name="send" size={18} color="#fff" />
                  </Pressable>
                </View>
                <Pressable style={styles.closeBtn} disabled={busy} onPress={close}>
                  <Text style={styles.closeText}>{t("sup.admin.close")}</Text>
                </Pressable>
              </View>
            )}
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { height: 56, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  iconButton: { width: 40, height: 40, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...typography.headlineSm, color: colors.onSurface, flex: 1, textAlign: "center" },
  scroll: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  muted: { ...typography.bodySm, color: colors.onSurfaceVariant, lineHeight: 20 },
  card: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.md, gap: 4 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  cardTitle: { ...typography.labelLg, color: colors.onSurface, fontWeight: "800", flex: 1 },
  status: { ...typography.labelSm, fontWeight: "800" },
  meta: { ...typography.labelSm, color: colors.outline },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { paddingHorizontal: 14, height: 36, borderRadius: radius.full, backgroundColor: colors.surfaceContainer, alignItems: "center", justifyContent: "center" },
  chipActive: { backgroundColor: colors.primary },
  chipText: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  input: { ...typography.bodyMd, color: colors.onSurface, borderWidth: 1.5, borderColor: colors.outlineVariant, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: 12 },
  bubble: { padding: spacing.sm, borderRadius: radius.lg, maxWidth: "88%", gap: 2 },
  bubbleMine: { alignSelf: "flex-end", backgroundColor: colors.primaryFixed },
  bubbleTeam: { alignSelf: "flex-start", backgroundColor: colors.surfaceContainer },
  bubbleWho: { ...typography.labelSm, color: colors.onSurfaceVariant, fontWeight: "800" },
  bubbleText: { ...typography.bodyMd, color: colors.onSurface },
  replyRow: { flexDirection: "row", gap: spacing.xs, alignItems: "flex-end" },
  sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  closeBtn: { height: 42, borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.primary, alignItems: "center", justifyContent: "center" },
  closeText: { ...typography.labelMd, color: colors.primary, fontWeight: "800" },
});
