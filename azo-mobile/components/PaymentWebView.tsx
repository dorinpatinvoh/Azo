import React, { useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import { colors, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { useI18n } from "../i18n";
import { PAYMENT_RETURN_PATH } from "../config/wallet";

type Props = {
  /** Adresse de paiement FedaPay renvoyée par le serveur ; null = fenêtre fermée. */
  url: string | null;
  /** Fermeture par l'utilisateur (croix) : le paiement a pu être fait, on continue de suivre le solde. */
  onClose: () => void;
  /** FedaPay a redirigé vers l'adresse de retour : le paiement est terminé (réussi ou non). */
  onReturn: (status: string | null) => void;
};

/**
 * Page de paiement FedaPay affichée DANS l'application (plein écran), sans ouvrir de navigateur externe.
 * La fin du paiement est détectée quand FedaPay redirige vers l'adresse de retour du serveur
 * (`/wallet/recharge/return`) : la fenêtre se referme alors toute seule, avant même de charger cette page.
 */
export default function PaymentWebView({ url, onClose, onReturn }: Props) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);

  return (
    <Modal visible={!!url} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.close} accessibilityLabel={t("common.cancel")}>
            <MaterialIcons name="close" size={22} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {t("wallet.recharge.paying")}
          </Text>
          <View style={{ width: 40 }} />
        </View>
        {url ? (
          <View style={{ flex: 1 }}>
            <WebView
              source={{ uri: url }}
              style={{ flex: 1 }}
              javaScriptEnabled
              domStorageEnabled
              onLoadStart={() => setLoading(true)}
              onLoadEnd={() => setLoading(false)}
              // Retour du paiement : on intercepte l'adresse de retour (la page n'a pas à se charger sur le téléphone)
              onShouldStartLoadWithRequest={(request) => {
                if (request.url.includes(PAYMENT_RETURN_PATH)) {
                  let status: string | null = null;
                  try {
                    status = new URL(request.url).searchParams.get("status");
                  } catch {
                    status = null;
                  }
                  onReturn(status);
                  return false;
                }
                return true;
              }}
            />
            {loading ? (
              <View style={styles.loader} pointerEvents="none">
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : null}
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { height: 52, paddingHorizontal: spacing.sm, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  close: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700", flex: 1, textAlign: "center" },
  loader: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, alignItems: "center", justifyContent: "center" },
});
