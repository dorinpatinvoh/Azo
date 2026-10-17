import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { DeliveryOffer, deliveryApi, errorMessage } from "../services/api";
import { offerExpirySeconds } from "../config/radar";
import { fcfa } from "../utils/rideDisplay";
import DriverProfileSheet from "./DriverProfileSheet";
import { BrandAlert } from "./BrandAlert";

type Props = {
  offer: DeliveryOffer;
  /** Le client a décidé : « approved » (coursier choisi, la commande est confirmée) ou « declined » (la recherche continue). */
  onDecided: (outcome: "approved" | "declined") => void;
};

/**
 * Un coursier ou livreur a accepté la commande : le client voit qui c'est, ouvre son profil et décide —
 * le choisir (la mission est confirmée et il suit son déplacement) ou le refuser (la commande repart chez les autres).
 * Même principe que la proposition d'un Speeder pour une course simple.
 */
export default function DeliveryOfferCard({ offer, onDecided }: Props) {
  const [busy, setBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Le délai vient de l'horloge du serveur (décalage mesuré à la réception) pour ne pas dépendre de l'heure du téléphone
  const skew = useRef(Date.parse(offer.serverNow) - Date.now());
  const fallbackEnd = useRef(Date.now() + offerExpirySeconds() * 1000);
  const endsAt = useMemo(() => {
    const parsed = Date.parse(offer.expiresAt);
    return Number.isNaN(parsed) ? fallbackEnd.current : parsed - (Number.isNaN(skew.current) ? 0 : skew.current);
  }, [offer.expiresAt]);
  const secondsLeft = Math.max(0, Math.ceil((endsAt - now) / 1000));

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const c = offer.courier;
  const name = c.displayName || "Coursier AZƆ̀";
  const hasRatings = typeof c.rating === "number" && (c.ratingCount ?? 0) > 0;
  const rating = hasRatings ? `${(c.rating as number).toFixed(1)} (${c.ratingCount})` : "Nouveau";
  const km = offer.offer?.distanceKm;
  const eta = offer.offer?.etaMinutes;
  const personal = offer.mode === "PERSONAL";
  const who = personal ? "coursier" : "livreur";

  async function decide(action: "approve" | "decline") {
    setBusy(true);
    try {
      if (action === "approve") await deliveryApi.approveCourier(offer.deliveryId);
      else await deliveryApi.declineCourier(offer.deliveryId);
      setSheetOpen(false);
      onDecided(action === "approve" ? "approved" : "declined");
    } catch (e) {
      BrandAlert.alert("Action impossible", errorMessage(e));
      // La proposition a pu expirer entre-temps : on referme la fenêtre
      onDecided("declined");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <View style={styles.avatar}>
          <MaterialIcons name={personal ? "directions-run" : "local-shipping"} size={26} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <Text style={styles.specialty} numberOfLines={1}>{c.specialty ?? (personal ? "Coursier personnel" : "Livreur express")}</Text>
          <View style={styles.meta}>
            <MaterialIcons name="star" size={14} color={colors.tertiaryFixedDim} />
            <Text style={styles.metaText}>{rating}</Text>
            {typeof c.jobsCompleted === "number" ? <Text style={styles.metaText}> · {c.jobsCompleted} missions</Text> : null}
          </View>
          {c.verified ? (
            <View style={styles.verified}>
              <MaterialIcons name="verified" size={13} color={colors.primary} />
              <Text style={styles.verifiedText}>Vérifié par AZƆ̀</Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.route}>
        <Text style={styles.routeText} numberOfLines={1}>De : {offer.pickupAddress}</Text>
        <Text style={styles.routeText} numberOfLines={1}>Vers : {offer.dropAddress}</Text>
        <Text style={styles.price}>{fcfa(offer.price)}</Text>
      </View>

      {typeof km === "number" || typeof eta === "number" ? (
        <Text style={styles.distance}>
          {typeof km === "number" ? `À ${km.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km de ton point de départ` : ""}
          {typeof km === "number" && typeof eta === "number" ? " · " : ""}
          {typeof eta === "number" ? `environ ${eta} min` : ""}
        </Text>
      ) : null}

      <Text style={styles.intro}>Vois son profil, puis choisis-le ou refuse pour chercher un autre {who}.</Text>
      <Text style={[styles.countdown, secondsLeft <= 10 && { color: colors.error }]}>Il te reste {secondsLeft} s pour répondre</Text>

      <Pressable style={styles.profileBtn} onPress={() => setSheetOpen(true)} accessibilityRole="button">
        <MaterialIcons name="badge" size={18} color={colors.primary} />
        <Text style={styles.profileBtnText}>Voir le profil</Text>
      </Pressable>
      <Pressable style={[styles.choose, busy && { opacity: 0.6 }]} onPress={() => decide("approve")} disabled={busy} accessibilityRole="button">
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.chooseText}>Choisir ce {who}</Text>}
      </Pressable>
      <Pressable style={styles.decline} onPress={() => decide("decline")} disabled={busy} accessibilityRole="button">
        <Text style={styles.declineText}>Refuser, chercher un autre {who}</Text>
      </Pressable>

      <DriverProfileSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        rideId={offer.deliveryId}
        fetchProfile={() => deliveryApi.courierProfile(offer.deliveryId)}
        name={name}
        profile={c}
        onChoose={() => decide("approve")}
        onDecline={() => decide("decline")}
        busy={busy}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.primaryFixed, borderRadius: radius.xl, padding: spacing.md, gap: spacing.xs + 2 },
  top: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surfaceContainerLowest, alignItems: "center", justifyContent: "center" },
  name: { ...typography.headlineSm, color: colors.onSurface },
  specialty: { ...typography.labelMd, color: colors.primary, fontWeight: "700" },
  meta: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 1 },
  metaText: { ...typography.bodySm, color: colors.onSurfaceVariant },
  verified: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  verifiedText: { ...typography.labelSm, color: colors.primary, fontWeight: "700" },
  route: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.sm, gap: 2 },
  routeText: { ...typography.bodySm, color: colors.onSurface },
  price: { ...typography.labelLg, color: colors.primary, fontWeight: "800", marginTop: 2 },
  distance: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
  intro: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  countdown: { ...typography.labelMd, color: colors.primary, fontWeight: "700" },
  profileBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 44, borderRadius: radius.full, backgroundColor: colors.surfaceContainerLowest },
  profileBtnText: { ...typography.labelLg, color: colors.primary, fontWeight: "700" },
  choose: { height: 50, borderRadius: radius.full, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  chooseText: { ...typography.labelLg, color: "#fff", fontWeight: "800" },
  decline: { height: 40, alignItems: "center", justifyContent: "center" },
  declineText: { ...typography.labelLg, color: colors.error, fontWeight: "700" },
});
