import React, { useEffect } from "react";
import { Modal, StyleSheet, Text, Vibration, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { Ride, ridesApi } from "../services/api";
import { useI18n } from "../i18n";
import DriverOfferCard from "./DriverOfferCard";

type Props = {
  ride: Ride;
  /** Course mise à jour après la décision du client (MATCHED = Speeder choisi, PENDING = refusé). */
  onChanged: (ride: Ride) => void;
  onClose: () => void;
};

/**
 * Popup plein écran : un Speeder a accepté la course. Elle vibre, prévient le Speeder que le client la voit
 * (`offer-seen`) et réutilise la carte de décision de l'écran de suivi (profil, compte à rebours,
 * « Choisir ce Speeder » / « Refuser »).
 */
export default function OfferPopup({ ride, onChanged, onClose }: Props) {
  const { t } = useI18n();

  useEffect(() => {
    Vibration.vibrate([0, 250, 120, 250]);
    // Dit au Speeder que le client regarde sa proposition (sans effet tant que le serveur n'a pas la route)
    ridesApi.offerSeen(ride.id).catch(() => undefined);
  }, [ride.id]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.panel}>
          <View style={styles.header}>
            <MaterialIcons name="two-wheeler" size={22} color={colors.primary} />
            <Text style={styles.title}>{t("live.status.OFFERED")}</Text>
          </View>
          <DriverOfferCard ride={ride} onChanged={onChanged} />
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
