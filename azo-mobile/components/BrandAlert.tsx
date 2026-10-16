import React, { useEffect, useState } from "react";
import { BackHandler, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import PrimaryButton from "./PrimaryButton";

/**
 * Fenêtres de dialogue aux couleurs de la charte AZƆ̀ (dégradé violet → orange du bouton principal, icône, polices de la marque),
 * à la place des alertes natives d'Android. Même signature que `Alert.alert` : on remplace simplement l'appel.
 *
 *   BrandAlert.alert("Titre", "Message", [{ text: "Non", style: "cancel" }, { text: "Oui", onPress: () => … }]);
 *
 * Les alertes s'affichent l'une après l'autre ; `BrandAlertHost` (monté une fois dans App.tsx) les montre.
 */

export type BrandAlertButton = {
  text?: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void | Promise<void>;
};

export type BrandAlertOptions = { cancelable?: boolean; onDismiss?: () => void };

type Item = { id: number; title: string; message?: string; buttons: BrandAlertButton[]; options?: BrandAlertOptions };

let counter = 0;
let queue: Item[] = [];
const listeners = new Set<(current: Item | null) => void>();

const emit = () => listeners.forEach((l) => l(queue[0] ?? null));

function alert(title: string, message?: string, buttons?: BrandAlertButton[], options?: BrandAlertOptions) {
  queue.push({ id: ++counter, title, message, buttons: buttons && buttons.length ? buttons : [{ text: "OK" }], options });
  emit();
}

function close(id: number) {
  queue = queue.filter((i) => i.id !== id);
  emit();
}

export const BrandAlert = { alert };

type Tone = { icon: keyof typeof MaterialIcons.glyphMap; color: string; bg: string };

/** Icône et couleur selon le sens du message (succès, erreur, danger, information). */
function toneFor(item: Item): Tone {
  const hay = `${item.title} ${item.message ?? ""}`.toLowerCase();
  if (item.buttons.some((b) => b.style === "destructive")) return { icon: "warning-amber", color: colors.error, bg: colors.errorContainer };
  if (/impossible|erreur|échec|echec|refus|invalide|incorrect|insuffisant|expiré|interdit|introuvable|indisponible/.test(hay)) {
    return { icon: "error-outline", color: colors.error, bg: colors.errorContainer };
  }
  if (/terminée|terminé|validé|confirmée|réussi|envoyé|crédité|reçu|merci|bravo|✅|🎉/.test(hay)) {
    return { icon: "check-circle", color: colors.primary, bg: colors.primaryFixed };
  }
  return { icon: "info-outline", color: colors.primary, bg: colors.primaryFixed };
}

// Les titres écrits avec des émojis restent lisibles : la charte utilise des icônes, pas des émojis
const stripEmoji = (s: string) => s.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "").replace(/\s{2,}/g, " ").trim();

export function BrandAlertHost() {
  const [current, setCurrent] = useState<Item | null>(queue[0] ?? null);

  useEffect(() => {
    listeners.add(setCurrent);
    setCurrent(queue[0] ?? null);
    return () => {
      listeners.delete(setCurrent);
    };
  }, []);

  const item = current;
  const cancelButton = item?.buttons.find((b) => b.style === "cancel");
  const cancelable = item ? (item.options?.cancelable ?? !!cancelButton) : false;

  const dismiss = () => {
    if (!item) return;
    close(item.id);
    item.options?.onDismiss?.();
    cancelButton?.onPress?.();
  };

  // Bouton retour du téléphone : ferme l'alerte si elle peut être refusée, sinon ne fait rien
  useEffect(() => {
    if (!item) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (cancelable) dismiss();
      return true;
    });
    return () => sub.remove();
  }, [item?.id, cancelable]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) return null;
  const tone = toneFor(item);
  const buttons = item.buttons;
  const primary = [...buttons].reverse().find((b) => b.style !== "cancel") ?? buttons[buttons.length - 1];
  const others = buttons.filter((b) => b !== primary);

  const press = (b: BrandAlertButton) => {
    close(item.id);
    try {
      void b.onPress?.();
    } catch {
      // une erreur dans l'action d'un bouton ne doit jamais bloquer la fermeture de la fenêtre
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={cancelable ? dismiss : undefined} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={cancelable ? dismiss : undefined}>
        <Pressable style={styles.panel} onPress={() => undefined} accessibilityViewIsModal>
          <View style={[styles.icon, { backgroundColor: tone.bg }]}>
            <MaterialIcons name={tone.icon} size={30} color={tone.color} />
          </View>
          <Text style={styles.title}>{stripEmoji(item.title)}</Text>
          {item.message ? <Text style={styles.message}>{stripEmoji(item.message)}</Text> : null}

          <View style={styles.actions}>
            {primary.style === "destructive" ? (
              <Pressable style={styles.destructive} onPress={() => press(primary)} accessibilityRole="button">
                <Text style={styles.destructiveText}>{primary.text ?? "OK"}</Text>
              </Pressable>
            ) : (
              <PrimaryButton label={primary.text ?? "OK"} icon="check" onPress={() => press(primary)} />
            )}
            {others.map((b, i) => (
              <Pressable
                key={`${b.text}-${i}`}
                style={[styles.secondary, b.style === "destructive" && styles.secondaryDanger]}
                onPress={() => press(b)}
                accessibilityRole="button"
              >
                <Text style={[styles.secondaryText, b.style === "destructive" && { color: colors.error }]}>{b.text ?? "OK"}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", paddingHorizontal: spacing.lg, backgroundColor: "rgba(20, 0, 35, 0.7)" },
  panel: { backgroundColor: colors.background, borderRadius: 28, padding: spacing.lg, alignItems: "center", gap: spacing.sm },
  icon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: spacing.xs },
  title: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800", textAlign: "center" },
  message: { ...typography.bodyMd, color: colors.onSurfaceVariant, textAlign: "center" },
  actions: { alignSelf: "stretch", gap: spacing.sm, marginTop: spacing.sm },
  secondary: { height: 48, borderRadius: radius.full, alignItems: "center", justifyContent: "center", backgroundColor: colors.primaryFixed },
  secondaryDanger: { backgroundColor: colors.errorContainer },
  secondaryText: { ...typography.labelLg, color: colors.primary, fontWeight: "700" },
  destructive: { height: 52, borderRadius: radius.full, alignItems: "center", justifyContent: "center", backgroundColor: colors.error },
  destructiveText: { ...typography.labelLg, color: "#fff", fontWeight: "800" },
});
