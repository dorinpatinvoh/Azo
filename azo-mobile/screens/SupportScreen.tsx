import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { SupportCategory, SupportStatus, SupportTicket, SupportTicketSummary, errorMessage, supportApi } from "../services/api";
import { useI18n } from "../i18n";

const CATEGORIES: SupportCategory[] = ["RIDE", "PAYMENT", "ACCOUNT", "SAFETY", "OTHER"];
const STATUS_COLOR: Record<SupportStatus, string> = { OPEN: "#b45309", ANSWERED: "#0a7a3b", CLOSED: "#5d5662" };

/** Assistance : liste des demandes, nouvelle demande, conversation avec l'équipe AZƆ̀. Pour tous les rôles. */
export default function SupportScreen({ onBack }: { onBack: () => void }) {
  const { t, locale } = useI18n();
  const [tickets, setTickets] = useState<SupportTicketSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<"list" | "new" | "detail">("list");
  const [open, setOpen] = useState<SupportTicket | null>(null);

  // formulaire
  const [category, setCategory] = useState<SupportCategory>("OTHER");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  // réponse
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setTickets((await supportApi.list()).tickets);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function openTicket(id: string) {
    try {
      setOpen(await supportApi.get(id));
      setReply("");
      setMode("detail");
    } catch (e) {
      Alert.alert(t("common.error"), errorMessage(e));
    }
  }

  async function submitNew() {
    if (subject.trim().length < 3 || message.trim().length < 3) {
      Alert.alert(t("common.error"), t("sup.tooShort"));
      return;
    }
    setBusy(true);
    try {
      await supportApi.create({ category, subject: subject.trim(), message: message.trim() });
      setSubject("");
      setMessage("");
      setCategory("OTHER");
      setMode("list");
      await load();
      Alert.alert(t("sup.sentTitle"), t("sup.sentBody"));
    } catch (e) {
      Alert.alert(t("common.error"), errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function sendReply() {
    if (!open || !reply.trim()) return;
    setBusy(true);
    try {
      await supportApi.reply(open.id, reply.trim());
      setReply("");
      setOpen(await supportApi.get(open.id));
      load();
    } catch (e) {
      Alert.alert(t("common.error"), errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const back = () => {
    if (mode === "list") onBack();
    else {
      setMode("list");
      load();
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={back} style={styles.iconButton} accessibilityLabel={t("common.back")}>
          <MaterialIcons name="arrow-back-ios-new" size={18} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {mode === "new" ? t("sup.new") : mode === "detail" && open ? open.subject : t("sup.title")}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {mode === "list" && (
          <ScrollView contentContainerStyle={styles.scroll}>
            <Pressable style={styles.primaryBtn} onPress={() => setMode("new")}>
              <MaterialIcons name="edit" size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>{t("sup.new")}</Text>
            </Pressable>
            {tickets === null && !failed ? <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} /> : null}
            {failed ? (
              <Pressable onPress={load}>
                <Text style={styles.muted}>{t("sup.loadError")} {t("common.retry")}</Text>
              </Pressable>
            ) : null}
            {tickets && tickets.length === 0 ? <Text style={styles.muted}>{t("sup.emptyHelp")}</Text> : null}
            {(tickets ?? []).map((tk) => (
              <Pressable key={tk.id} style={styles.card} onPress={() => openTicket(tk.id)}>
                <View style={styles.cardTop}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{tk.subject}</Text>
                  <Text style={[styles.status, { color: STATUS_COLOR[tk.status] }]}>{t(`sup.status.${tk.status}` as const)}</Text>
                </View>
                <Text style={styles.muted} numberOfLines={2}>{tk.lastMessage?.text ?? ""}</Text>
                <Text style={styles.meta}>
                  {t(`sup.cat.${tk.category}` as const)} · {new Date(tk.updatedAt).toLocaleDateString(locale)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {mode === "new" && (
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.chips}>
              {CATEGORIES.map((c) => (
                <Pressable key={c} style={[styles.chip, category === c && styles.chipActive]} onPress={() => setCategory(c)}>
                  <Text style={[styles.chipText, category === c && { color: "#fff" }]}>{t(`sup.cat.${c}` as const)}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput style={styles.input} value={subject} onChangeText={setSubject} placeholder={t("sup.subject")} placeholderTextColor={colors.outline} maxLength={120} />
            <TextInput
              style={[styles.input, { height: 140, textAlignVertical: "top" }]}
              value={message}
              onChangeText={setMessage}
              placeholder={t("sup.message")}
              placeholderTextColor={colors.outline}
              multiline
              maxLength={2000}
            />
            <Pressable style={[styles.primaryBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={submitNew}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>{t("sup.send")}</Text>}
            </Pressable>
          </ScrollView>
        )}

        {mode === "detail" && open && (
          <>
            <ScrollView contentContainerStyle={styles.scroll}>
              <Text style={[styles.status, { color: STATUS_COLOR[open.status], marginBottom: spacing.xs }]}>
                {t(`sup.status.${open.status}` as const)} · {t(`sup.cat.${open.category}` as const)}
              </Text>
              {open.messages.map((m) => (
                <View key={m.id} style={[styles.bubble, m.authorRole === "USER" ? styles.bubbleMine : styles.bubbleTeam]}>
                  <Text style={styles.bubbleWho}>{m.authorRole === "USER" ? t("sup.you") : t("sup.team")}</Text>
                  <Text style={styles.bubbleText}>{m.text}</Text>
                </View>
              ))}
            </ScrollView>
            {open.status === "CLOSED" ? (
              <Text style={[styles.muted, { padding: spacing.md }]}>{t("sup.closedNote")}</Text>
            ) : (
              <View style={styles.replyRow}>
                <TextInput style={[styles.input, { flex: 1, marginBottom: 0 }]} value={reply} onChangeText={setReply} placeholder={t("sup.reply")} placeholderTextColor={colors.outline} multiline maxLength={2000} />
                <Pressable style={[styles.sendBtn, (busy || !reply.trim()) && { opacity: 0.5 }]} disabled={busy || !reply.trim()} onPress={sendReply}>
                  <MaterialIcons name="send" size={18} color="#fff" />
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
  primaryBtn: { flexDirection: "row", gap: 8, height: 48, borderRadius: radius.full, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  primaryBtnText: { ...typography.labelLg, color: "#fff", fontWeight: "800" },
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
  input: { ...typography.bodyMd, color: colors.onSurface, borderWidth: 1.5, borderColor: colors.outlineVariant, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: 12, marginBottom: spacing.xs },
  bubble: { padding: spacing.sm, borderRadius: radius.lg, maxWidth: "88%", gap: 2 },
  bubbleMine: { alignSelf: "flex-end", backgroundColor: colors.primaryFixed },
  bubbleTeam: { alignSelf: "flex-start", backgroundColor: colors.surfaceContainer },
  bubbleWho: { ...typography.labelSm, color: colors.onSurfaceVariant, fontWeight: "800" },
  bubbleText: { ...typography.bodyMd, color: colors.onSurface },
  replyRow: { flexDirection: "row", gap: spacing.xs, alignItems: "flex-end", padding: spacing.sm },
  sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
});
