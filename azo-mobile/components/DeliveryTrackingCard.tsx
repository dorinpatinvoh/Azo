import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { Delivery, deliveryApi, errorMessage } from "../services/api";
import { fcfa, relativeDay, STATUS_INFO, VEHICLE_LABEL } from "../utils/rideDisplay";
import { tarification } from "../services/tarification";
import { maskBeninPhone, maskPersonName } from "../utils/phone";
import CourierTrackMap from "./CourierTrackMap";
import RideChatModal from "./RideChatModal";
import { BrandAlert } from "./BrandAlert";

type Props = { delivery: Delivery; onChanged: () => void };

const ACTIVE = ["PENDING", "MATCHED", "IN_PROGRESS"];

/**
 * Suivi d'une commande de colis ou de coursier personnel dans l'onglet « Courses » : état, trajet, carte du livreur en direct,
 * codes de ramassage et de remise, message au livreur et annulation. Une commande terminée ou annulée reste en version courte.
 */
export default function DeliveryTrackingCard({ delivery: d, onChanged }: Props) {
  const [chatOpen, setChatOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const st = STATUS_INFO[d.status];
  const active = ACTIVE.includes(d.status);
  const personal = d.mode === "PERSONAL";
  const title = personal ? "Coursier personnel" : "Livraison de colis";
  const vehicle = d.vehicleType ? VEHICLE_LABEL[d.vehicleType] : null;
  const perKm = personal && d.vehicleType ? tarification().personalCourier?.vehicles?.[d.vehicleType]?.perKm : undefined;

  function cancel() {
    BrandAlert.alert("Annuler la commande", "Veux-tu annuler cette demande ?", [
      { text: "Non", style: "cancel" },
      {
        text: "Annuler la demande",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            await deliveryApi.cancel(d.id);
            onChanged();
          } catch (e) {
            BrandAlert.alert("Annulation impossible", errorMessage(e));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  return (
    <View style={[styles.card, active && styles.cardActive]}>
      <View style={styles.top}>
        <View style={[styles.icon, { backgroundColor: st.bg }]}>
          <MaterialIcons name={personal ? "directions-run" : "local-shipping"} size={22} color={st.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {relativeDay(d.createdAt)}
            {vehicle ? ` · ${vehicle}` : ""}
          </Text>
        </View>
        <Text style={[styles.price, d.status === "CANCELLED" && styles.priceCancelled]}>{fcfa(d.price)}</Text>
      </View>

      <View style={styles.pillRow}>
        <View style={[styles.pill, { backgroundColor: st.bg }]}>
          <Text style={[styles.pillText, { color: st.color }]}>{st.label}</Text>
        </View>
        {active ? <Text style={styles.follow}>Suivi en direct</Text> : null}
      </View>

      <View style={styles.routeBox}>
        <View style={styles.routeLine}>
          <View style={[styles.dot, { backgroundColor: "#2e7d32" }]} />
          <Text style={styles.routeText} numberOfLines={1}>{d.pickupAddress}</Text>
        </View>
        <View style={styles.routeLine}>
          <View style={[styles.dot, { backgroundColor: "#b3261b" }]} />
          <Text style={styles.routeText} numberOfLines={1}>{d.dropAddress}</Text>
        </View>
      </View>

      {personal && active && (d.bookedUntil || d.scheduledAt) ? (
        <Text style={styles.meta}>
          {d.scheduledAt && d.status === "PENDING"
            ? `Départ programmé le ${new Date(d.scheduledAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`
            : `Réservé jusqu'au ${new Date(d.bookedUntil as string).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`}
        </Text>
      ) : null}

      {d.status === "PENDING" ? (
        <Text style={styles.meta}>
          {personal
            ? "Recherche d'un coursier personnel en ligne à moins de 20 km de ton point de départ. Dès qu'il accepte, tu suis sa position ici."
            : "Recherche d'un livreur en ligne à moins de 20 km de ton point de départ. Dès qu'il accepte, tu suis sa position ici."}
        </Text>
      ) : null}

      {["MATCHED", "IN_PROGRESS"].includes(d.status) ? <CourierTrackMap deliveryId={d.id} perKm={perKm} /> : null}

      {active ? (
        <View style={styles.codesRow}>
          <View style={styles.codePill}>
            <Text style={styles.codeLabel}>{personal ? "Code de départ" : "Code ramassage"}</Text>
            <Text style={styles.codeValue}>{d.pickupCode}</Text>
          </View>
          <View style={styles.codePill}>
            <Text style={styles.codeLabel}>{personal ? "Code de fin" : "Code remise finale"}</Text>
            <Text style={styles.codeValue}>{d.deliveryCode}</Text>
          </View>
        </View>
      ) : null}

      {active && d.courier ? (
        <View style={styles.courierRow}>
          <MaterialIcons name="shield" size={18} color={colors.primary} />
          <Text style={styles.courierText} numberOfLines={1}>
            {maskPersonName(d.courier.fullName, "Livreur AZƆ̀")} · {maskBeninPhone(d.courier.phone)}
          </Text>
          <Pressable style={styles.chatBtn} onPress={() => setChatOpen(true)} accessibilityLabel="Écrire au livreur">
            <MaterialIcons name="chat-bubble-outline" size={14} color="#fff" />
            <Text style={styles.chatBtnText}>Message</Text>
          </Pressable>
        </View>
      ) : null}

      {["PENDING", "MATCHED"].includes(d.status) ? (
        <Pressable style={styles.cancelBtn} onPress={cancel} disabled={busy}>
          <Text style={styles.cancelText}>Annuler la demande</Text>
        </Pressable>
      ) : null}

      {chatOpen ? (
        <RideChatModal visible rideId={d.id} myRole="CLIENT" peerName={d.courier?.fullName} peerPhone={d.courier?.phone} onClose={() => setChatOpen(false)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.surfaceContainer },
  cardActive: { borderWidth: 1.5, borderColor: colors.secondaryContainer },
  top: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  icon: { width: 44, height: 44, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
  title: { ...typography.labelLg, color: colors.onSurface, fontWeight: "800" },
  meta: { ...typography.bodySm, color: colors.onSurfaceVariant },
  price: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  priceCancelled: { color: colors.outline, textDecorationLine: "line-through" },
  pillRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.full },
  pillText: { ...typography.labelSm },
  follow: { ...typography.labelMd, color: colors.secondary, fontWeight: "800" },
  routeBox: { gap: 6, backgroundColor: colors.surfaceContainerLow, borderRadius: radius.lg, padding: spacing.sm },
  routeLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  routeText: { ...typography.bodySm, color: colors.onSurface, flex: 1 },
  codesRow: { flexDirection: "row", gap: spacing.sm },
  codePill: { flex: 1, backgroundColor: colors.surfaceContainerLow, borderRadius: radius.md, padding: spacing.sm, alignItems: "center" },
  codeLabel: { ...typography.labelSm, color: colors.onSurfaceVariant },
  codeValue: { ...typography.headlineSm, color: colors.primary, fontWeight: "800", letterSpacing: 3, marginTop: 2 },
  courierRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  courierText: { ...typography.labelMd, color: colors.onSurface, flex: 1, fontWeight: "600" },
  chatBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full, backgroundColor: colors.primary },
  chatBtnText: { ...typography.labelSm, color: "#fff", fontWeight: "800" },
  cancelBtn: { alignSelf: "flex-end", paddingVertical: 4 },
  cancelText: { ...typography.labelSm, color: colors.error, fontWeight: "700" },
});
