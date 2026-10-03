import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { io, Socket } from "socket.io-client";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { API_URL, RideChatMessage, getToken, ridesApi } from "../services/api";
import { maskBeninPhone, maskPersonName } from "../utils/phone";

type Props = {
  visible: boolean;
  rideId: string;
  myRole: "CLIENT" | "PROVIDER";
  myName?: string;
  peerName?: string | null;
  peerPhone?: string | null;
  locked?: boolean;
  onClose: () => void;
};

const QUICK_CLIENT = [
  "👋 Je sors tout de suite",
  "🏠 Je suis devant le portail",
  "📍 Je t'attends au carrefour",
  "👍 Merci, à tout de suite",
];

const QUICK_PROVIDER = [
  "🛵 J'arrive dans 2 min",
  "📍 Je suis au point de repère",
  "📦 Quel est le point exact ?",
  "✅ Je suis arrivé",
];

export default function RideChatModal({
  visible,
  rideId,
  myRole,
  myName,
  peerName,
  peerPhone,
  locked = false,
  onClose,
}: Props) {
  const [messages, setMessages] = useState<RideChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const socketRef = useRef<Socket | null>(null);

  const loadMessages = useCallback(async () => {
    if (!rideId) return;
    try {
      const list = await ridesApi.messages(rideId);
      setMessages(list);
    } catch {
      // ignore offline
    }
  }, [rideId]);

  useEffect(() => {
    if (!visible || !rideId) return;
    loadMessages();
    const poll = setInterval(loadMessages, 3500);

    const socket = io(API_URL, {
      transports: ["websocket"],
      auth: { token: getToken() },
    });
    socketRef.current = socket;
    socket.on("connect", () => {
      socket.emit("ride:join", { rideId });
    });
    socket.on("ride:chat", (msg: RideChatMessage) => {
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
    });

    return () => {
      clearInterval(poll);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [visible, rideId, loadMessages]);

  async function sendText(rawText: string) {
    const text = rawText.trim();
    if (!text || sending || locked) return;
    setSending(true);
    setInput("");
    try {
      const sent = await ridesApi.sendMessage(rideId, {
        text,
        senderRole: myRole,
        senderName:
          myName || (myRole === "PROVIDER" ? "Prestataire AZƆ̀" : "Client AZƆ̀"),
      });
      setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
    } catch {
      // Fallback WebSocket ou local optimiste si l'API met du temps
      const optimistic: RideChatMessage = {
        id: `local-${Date.now()}`,
        rideId,
        senderId: "me",
        senderRole: myRole,
        senderName: myName || (myRole === "PROVIDER" ? "Prestataire AZƆ̀" : "Client AZƆ̀"),
        text,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);
      socketRef.current?.emit("ride:chat", {
        rideId,
        senderRole: myRole,
        senderName: optimistic.senderName,
        text,
      });
    } finally {
      setSending(false);
    }
  }

  const quickReplies = myRole === "PROVIDER" ? QUICK_PROVIDER : QUICK_CLIENT;
  const displayPeerName = maskPersonName(
    peerName,
    myRole === "CLIENT" ? "Prestataire AZƆ̀" : "Client AZƆ̀"
  );
  const displayMaskedPhone = maskBeninPhone(peerPhone);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.sheet}>
          {/* En-tête sécurisé avec anonymisation */}
          <View style={styles.header}>
            <View style={styles.peerAvatar}>
              <MaterialIcons name="shield" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.peerTitle}>{displayPeerName}</Text>
              <Text style={styles.peerSub}>
                Numéro masqué : {displayMaskedPhone} • Chat sécurisé AZƆ̀
              </Text>
            </View>
            <Pressable style={styles.closeBtn} onPress={onClose} accessibilityLabel="Fermer">
              <MaterialIcons name="close" size={20} color={colors.onSurface} />
            </Pressable>
          </View>

          {/* Bandeau de confidentialité */}
          <View style={styles.privacyBanner}>
            <MaterialIcons name="lock" size={14} color={colors.primary} />
            <Text style={styles.privacyText}>
              Vos numéros personnels sont protégés et la discussion se ferme automatiquement à la fin de la mission.
            </Text>
          </View>

          {/* Liste des messages */}
          <ScrollView
            ref={scrollRef}
            style={styles.msgList}
            contentContainerStyle={styles.msgListContent}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          >
            {messages.length === 0 ? (
              <View style={styles.emptyBox}>
                <MaterialIcons name="chat-bubble-outline" size={28} color={colors.outline} />
                <Text style={styles.emptyTitle}>Aucun message pour l'instant</Text>
                <Text style={styles.emptySub}>
                  Utilise un message rapide en 1 clic ci-dessous pour préciser ton point de repère.
                </Text>
              </View>
            ) : (
              messages.map((m) => {
                const mine = m.senderRole === myRole;
                return (
                  <View
                    key={m.id}
                    style={[styles.bubbleWrap, mine ? styles.bubbleWrapMine : styles.bubbleWrapPeer]}
                  >
                    <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubblePeer]}>
                      <Text style={[styles.bubbleText, mine && { color: "#fff" }]}>{m.text}</Text>
                    </View>
                    <Text style={styles.bubbleTime}>
                      {mine ? "Moi" : displayPeerName} •{" "}
                      {new Date(m.createdAt).toLocaleTimeString("fr-FR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                  </View>
                );
              })
            )}
          </ScrollView>

          {/* Réponses rapides en 1 clic */}
          {!locked ? (
            <>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.quickRow}
                keyboardShouldPersistTaps="handled"
              >
                {quickReplies.map((q) => (
                  <Pressable key={q} style={styles.quickChip} onPress={() => sendText(q)}>
                    <Text style={styles.quickChipText}>{q}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              {/* Champ de saisie */}
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  value={input}
                  onChangeText={setInput}
                  placeholder="Écrire un message sécurisé…"
                  placeholderTextColor={colors.outline}
                  returnKeyType="send"
                  onSubmitEditing={() => sendText(input)}
                />
                <Pressable
                  style={[styles.sendBtn, (!input.trim() || sending) && { opacity: 0.5 }]}
                  disabled={!input.trim() || sending}
                  onPress={() => sendText(input)}
                >
                  {sending ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <MaterialIcons name="send" size={18} color="#fff" />
                  )}
                </Pressable>
              </View>
            </>
          ) : (
            <View style={styles.lockedBar}>
              <MaterialIcons name="lock-clock" size={16} color={colors.onSurfaceVariant} />
              <Text style={styles.lockedText}>
                Course terminée : la discussion est désormais verrouillée pour votre sécurité.
              </Text>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surfaceContainerLowest,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "82%",
    paddingBottom: spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainer,
  },
  peerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryFixed,
    alignItems: "center",
    justifyContent: "center",
  },
  peerTitle: {
    ...typography.labelLg,
    color: colors.onSurface,
    fontWeight: "800",
  },
  peerSub: {
    ...typography.bodySm,
    color: colors.onSurfaceVariant,
    fontSize: 11,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceContainer,
    alignItems: "center",
    justifyContent: "center",
  },
  privacyBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.primaryFixed,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  privacyText: {
    ...typography.labelSm,
    color: colors.primary,
    flex: 1,
    fontSize: 11,
    fontWeight: "600",
  },
  msgList: {
    minHeight: 200,
    maxHeight: 320,
  },
  msgListContent: {
    padding: spacing.md,
    gap: 10,
  },
  emptyBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xl,
    gap: 6,
  },
  emptyTitle: {
    ...typography.labelMd,
    color: colors.onSurface,
    fontWeight: "700",
  },
  emptySub: {
    ...typography.bodySm,
    color: colors.onSurfaceVariant,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
  },
  bubbleWrap: {
    maxWidth: "82%",
    gap: 2,
  },
  bubbleWrapMine: {
    alignSelf: "flex-end",
    alignItems: "flex-end",
  },
  bubbleWrapPeer: {
    alignSelf: "flex-start",
    alignItems: "flex-start",
  },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
  },
  bubbleMine: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  bubblePeer: {
    backgroundColor: colors.surfaceContainer,
    borderBottomLeftRadius: 4,
  },
  bubbleText: {
    ...typography.bodyMd,
    color: colors.onSurface,
  },
  bubbleTime: {
    ...typography.labelSm,
    color: colors.outline,
    fontSize: 10,
  },
  quickRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    gap: 8,
  },
  quickChip: {
    backgroundColor: colors.secondaryFixed,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.full,
  },
  quickChipText: {
    ...typography.labelSm,
    color: colors.secondary,
    fontWeight: "700",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingTop: 4,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceContainer,
    borderRadius: radius.full,
    paddingHorizontal: 16,
    paddingVertical: 10,
    ...typography.bodyMd,
    color: colors.onSurface,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  lockedBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainer,
  },
  lockedText: {
    ...typography.bodySm,
    color: colors.onSurfaceVariant,
    flex: 1,
  },
});
