import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { Ride, errorMessage, ridesApi } from "../services/api";
import { fcfa } from "../utils/rideDisplay";
import { getLanguage, languageInfo, useI18n } from "../i18n";

type Props = {
  ride: Ride;
  role: "CLIENT" | "DRIVER";
  /** Course mise à jour par le serveur après une action (demande, accord, refus). */
  onChanged: (ride: Ride) => void;
};

const km = (meters: number) =>
  `${(meters / 1000).toLocaleString(languageInfo(getLanguage()).locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;

/**
 * Course partielle : le prix est « base (prise en charge) + kilomètres parcourus », avec l'accord du
 * client ET du Speeder. Les montants viennent toujours du serveur, jamais calculés ici.
 * Affiche la distance et le prix en direct, et gère la demande d'arrêt des deux côtés.
 *
 * Tant que le serveur n'envoie pas `traveledMeters`, le panneau reste invisible : aucune
 * fonction proposée que le serveur ne saurait pas traiter.
 * Contrat : PROJECT_SUMMARY/DEMANDE_BACKEND_PRIX_AU_KILOMETRE_ET_CARTES.md
 */
export default function RideStopPanel({ ride, role, onChanged }: Props) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  // Arrêt accepté : le serveur a généré le code d'arrivée. Le client doit le lire, mais la réponse de l'acceptation
  // (ou l'événement temps réel) ne le contient pas : on relit la course.
  const acceptedStop = ride.stopRequest?.accepted === true;
  useEffect(() => {
    if (role !== "CLIENT" || !acceptedStop || ride.dropCode) return;
    let cancelled = false;
    ridesApi.get(ride.id).then((fresh) => { if (!cancelled) onChanged({ ...ride, ...fresh }); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [role, acceptedStop, ride.id, ride.dropCode]); // eslint-disable-line react-hooks/exhaustive-deps

  if (ride.status !== "IN_PROGRESS" || typeof ride.traveledMeters !== "number") return null;

  const request = ride.stopRequest ?? null;
  const mine = request?.by === role;
  const price = request?.price ?? ride.currentPrice;
  // Distance au moment de la demande : c'est celle sur laquelle le montant a été calculé.
  const requestMeters = request?.distanceMeters ?? ride.traveledMeters;
  const other = role === "CLIENT" ? t("stop.other.zem") : t("stop.other.client");

  // Le serveur répond de deux façons : `stop-accept` renvoie la course terminée (avec `id`),
  // `stop-request` / `stop-decline` / `stop-cancel` renvoient seulement `{ rideId, stopRequest }`.
  // Remplacer toute la course par ce petit objet vider l'écran : on fusionne dans la course
  // actuelle.
  async function run(action: (id: string) => Promise<Ride | { rideId: string; stopRequest: Ride["stopRequest"] }>, failureTitle: string) {
    setBusy(true);
    try {
      const res = await action(ride.id);
      onChanged("id" in res ? res : { ...ride, stopRequest: res.stopRequest ?? null });
    } catch (e) {
      Alert.alert(failureTitle, errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function confirmRequest() {
    Alert.alert(
      t("stop.askTitle"),
      t("stop.askBody", {
        distance: km(ride.traveledMeters ?? 0),
        amount: typeof ride.currentPrice === "number" ? fcfa(ride.currentPrice) : t("stop.amountServer"),
        other,
      }),
      [
        { text: t("stop.keep"), style: "cancel" },
        { text: t("stop.ask"), onPress: () => run(ridesApi.requestStop, t("stop.askFailed")) },
      ]
    );
  }

  function confirmAccept() {
    Alert.alert(
      t("stop.acceptTitle"),
      t("stop.acceptBody", {
        amount: typeof price === "number" ? fcfa(price) : t("stop.amountByDistance"),
        distance: km(requestMeters ?? 0),
      }),
      [
        { text: t("common.no"), style: "cancel", onPress: () => run(ridesApi.declineStop, t("stop.declineFailed")) },
        { text: t("stop.accept"), onPress: () => run(ridesApi.acceptStop, t("stop.acceptFailed")) },
      ]
    );
  }

  return (
    <View style={styles.box}>
      <View style={styles.row}>
        <MaterialIcons name="route" size={18} color={colors.primary} />
        <Text style={styles.progress}>
          {typeof ride.currentPrice === "number"
            ? t("stop.progressPrice", { distance: km(ride.traveledMeters), amount: fcfa(ride.currentPrice) })
            : t("stop.progress", { distance: km(ride.traveledMeters) })}
        </Text>
      </View>
      {typeof ride.currentPrice === "number" && (
        <Text style={styles.requestText}>{t("stop.priceHint")}</Text>
      )}

      {busy ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xs }} />
      ) : request?.accepted ? (
        <View style={styles.request}>
          <Text style={styles.requestText}>
            {typeof price === "number" ? `${fcfa(price)} · ${km(requestMeters)}. ` : ""}
            {role === "CLIENT" ? t("stop.accepted.client") : t("stop.accepted.zem")}
          </Text>
        </View>
      ) : request && !mine ? (
        <View style={styles.request}>
          <Text style={styles.requestText}>
            {typeof price === "number"
              ? t("stop.proposesPrice", { other, amount: fcfa(price), distance: km(requestMeters) })
              : t("stop.proposes", { other })}
          </Text>
          <View style={styles.actions}>
            <Pressable style={[styles.btn, styles.btnPrimary]} onPress={confirmAccept}>
              <Text style={styles.btnPrimaryText}>{t("stop.reply")}</Text>
            </Pressable>
          </View>
        </View>
      ) : request && mine ? (
        <View style={styles.request}>
          <Text style={styles.requestText}>{role === "CLIENT" ? t("stop.waiting.zem") : t("stop.waiting.client")}</Text>
          <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => run(ridesApi.cancelStop, t("stop.cancelFailed"))}>
            <Text style={styles.btnGhostText}>{t("stop.cancelMine")}</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={[styles.btn, styles.btnGhost]} onPress={confirmRequest}>
          <MaterialIcons name="flag" size={16} color={colors.primary} />
          <Text style={styles.btnGhostText}>{t("stop.stopHere")}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: spacing.xs,
    marginVertical: spacing.xs,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  progress: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  request: { gap: spacing.xs },
  requestText: { ...typography.bodySm, color: colors.onSurfaceVariant },
  actions: { flexDirection: "row", gap: spacing.sm },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 40,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryText: { ...typography.labelMd, color: "#fff", fontWeight: "700" },
  btnGhost: { borderWidth: 1.5, borderColor: colors.primary },
  btnGhostText: { ...typography.labelMd, color: colors.primary, fontWeight: "700" },
});
