import React, { useEffect } from "react";
import { Modal, StyleSheet, Text, Vibration, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { DeliveryOffer, deliveryApi } from "../services/api";
import DeliveryOfferCard from "./DeliveryOfferCard";

type Props = {
  offer: DeliveryOffer;
  onDecided: (outcome: "approved" | "declined") => void;
  onClose: () => void;
};

/** Popup plein écran : un coursier ou livreur a accepté la commande. Elle vibre et prévient le coursier que le client regarde son profil. */
export default function DeliveryOfferPopup({ offer, onDecided, onClose }: Props) {
  useEffect(() => {
    Vibration.vibrate([0, 250, 120, 250]);
    deliveryApi.offerSeen(offer.deliveryId).catch(() => undefined);
  }, [offer.deliveryId]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.panel}>
          <View style={styles.header}>
            <MaterialIcons name={offer.mode === "PERSONAL" ? "directions-run" : "local-shipping"} size={22} color={colors.primary} />
            <Text style={styles.title}>{offer.mode === "PERSONAL" ? "Un coursier a accepté" : "Un livreur a accepté"}</Text>
          </View>
          <DeliveryOfferCard offer={offer} onDecided={onDecided} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", paddingHorizontal: spacing.md, backgroundColor: "rgba(20, 0, 35, 0.7)" },
  panel: { backgroundColor: colors.background, borderRadius: 28, padding: spacing.md, gap: spacing.sm },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: 4 },
  title: { ...typography.headlineSm, color: colors.onSurface, flex: 1 },
});
