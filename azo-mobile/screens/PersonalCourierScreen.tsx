import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import PrimaryButton from "../components/PrimaryButton";
import SchedulePicker from "../components/SchedulePicker";
import PlacePickerMap from "../components/PlacePickerMap";
import { Delivery, Place, VehicleType, deliveryApi, errorMessage, walletApi } from "../services/api";
import CourierTrackMap from "../components/CourierTrackMap";
import { tarification } from "../services/tarification";
import { BrandAlert } from "../components/BrandAlert";

type Props = { onBack: () => void; onRecharge: () => void; onBooked: () => void; initialDrop?: Place | null; initialVehicle?: VehicleType | null };

type VehicleOption = { id: VehicleType; label: string; icon: keyof typeof MaterialIcons.glyphMap };

// Moto (essence ou électrique) ou voiture (Gazelle, Koala, Léopard)
const GROUPS: { title: string; options: VehicleOption[] }[] = [
  {
    title: "",
    options: [
      { id: "ZEM_ESSENCE", label: "Speeder à essence", icon: "two-wheeler" },
      { id: "ZEM_ELECTRIC", label: "Speeder électrique", icon: "electric-moped" },
      { id: "ZEM_TRICYCLE", label: "Speeder tricycle", icon: "electric-rickshaw" },
    ],
  },
  {
    title: "",
    options: [
      { id: "GAZELLE", label: "Speeder Gazelle", icon: "directions-car" },
      { id: "KOALA", label: "Speeder Koala", icon: "directions-car" },
      { id: "LEOPARD", label: "Speeder Léopard", icon: "directions-car" },
    ],
  },
];

const fcfa = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} F`;

/** Distance à vol d'oiseau (km) : sert uniquement d'estimation d'affichage, le serveur calcule le prix réel. */
function crowKm(a: Place, b: Place) {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export default function PersonalCourierScreen({ onBack, onRecharge, onBooked, initialDrop, initialVehicle }: Props) {
  const cfg = tarification().personalCourier;
  const durations = cfg?.durations ?? [];
  const [vehicle, setVehicle] = useState<VehicleType>(initialVehicle ?? "ZEM_ESSENCE");
  const [hours, setHours] = useState<number>(durations[0]?.hours ?? 5);
  // « Plus de 3 jours » : nombre de jours entiers (4 à 14), la course est alors forcément programmée
  const [longBooking, setLongBooking] = useState(false);
  const [days, setDays] = useState(4);
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  const [scheduleMode, setScheduleMode] = useState(false);
  const [pickup, setPickup] = useState<Place | null>(null);
  const [drop, setDrop] = useState<Place | null>(initialDrop ?? null);
  const [balance, setBalance] = useState<number | null>(null);
  const [routeKm, setRouteKm] = useState<number | null>(null);
  const [bookings, setBookings] = useState<Delivery[]>([]);

  // Mes réservations en cours (suivi, codes, annulation)
  const loadBookings = React.useCallback(async () => {
    try {
      const list = await deliveryApi.mine();
      setBookings(list.filter((d) => d.mode === "PERSONAL" && ["PENDING", "MATCHED", "IN_PROGRESS"].includes(d.status)));
    } catch {
      // hors ligne : on garde la liste précédente
    }
  }, []);
  useEffect(() => {
    loadBookings();
    const timer = setInterval(loadBookings, 8000);
    return () => clearInterval(timer);
  }, [loadBookings]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    walletApi.get().then((w) => setBalance(w.balance)).catch(() => undefined);
  }, []);

  const rule = cfg?.vehicles?.[vehicle];
  // Estimation (le serveur recalcule avec la distance de route) : route ≈ 1,3 × vol d'oiseau
  const estimate = useMemo(() => {
    // Sans destination, la distance n'est pas connue : pas d'estimation chiffrée
    if (!rule || !pickup || !drop) return null;
    return Math.round(rule.base + (routeKm ?? crowKm(pickup, drop) * 1.3) * rule.perKm);
  }, [rule, pickup, drop, routeKm]);

  async function confirm() {
    if (!pickup) {
      BrandAlert.alert("Départ requis", "Choisis ton point de départ dans la liste de suggestions.");
      return;
    }
    if ((scheduleMode || longBooking) && !scheduledAt) {
      BrandAlert.alert("Heure de départ requise", longBooking ? "Au-delà de 3 jours, programme le début de ta réservation." : "Choisis le jour et l'heure de ton départ.");
      return;
    }
    setLoading(true);
    try {
      const d = await deliveryApi.create({
        packageType: "personal",
        pickupAddress: pickup.title,
        ...(drop ? { dropAddress: drop.title } : {}),
        payer: "SENDER",
        mode: "PERSONAL",
        vehicleType: vehicle,
        bookingHours: longBooking ? days * 24 : hours,
        ...(scheduledAt ? { scheduledAt: scheduledAt.toISOString() } : {}),
        pickupLat: pickup.latitude,
        pickupLng: pickup.longitude,
        ...(drop ? { dropLat: drop.latitude, dropLng: drop.longitude } : {}),
      });
      loadBookings();
      BrandAlert.alert(
        "Coursier personnel demandé ✅",
        `Montant réservé : ${fcfa(d.price)}. Le total final sera calculé à la fin, selon les kilomètres parcourus.\nCode de départ : ${d.pickupCode}\nCode de fin : ${d.deliveryCode}\n\nConserve ces codes : ton coursier te les demandera. Il reste réservé pour toi pendant toute la durée choisie.`,
        [{ text: "OK", onPress: onBooked }]
      );
    } catch (e) {
      BrandAlert.alert("Impossible de commander", errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  const notEnough = estimate !== null && balance !== null && balance < estimate;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.iconButton}>
          <MaterialIcons name="arrow-back-ios-new" size={18} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Coursier personnel</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          Un coursier rien que pour toi pendant la durée choisie. Une fois ta demande acceptée, il ne prend plus d'autre course avant la fin.
        </Text>

        {bookings.map((b) => (
          <View key={b.id} style={styles.bookingCard}>
            <Text style={styles.bookingTitle}>
              {b.status === "PENDING" ? "Recherche de ton coursier…" : b.status === "MATCHED" ? "Ton coursier arrive" : "Course en cours"}
            </Text>
            <Text style={styles.priceNote}>De : {b.pickupAddress}</Text>
            {b.dropAddress ? <Text style={styles.priceNote}>Vers : {b.dropAddress}</Text> : null}
            {b.bookedUntil ? <Text style={styles.priceNote}>Réservé jusqu'au {new Date(b.bookedUntil).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</Text> : null}
            {b.scheduledAt && b.status === "PENDING" ? <Text style={styles.priceNote}>Départ programmé le {new Date(b.scheduledAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</Text> : null}
            {["MATCHED", "IN_PROGRESS"].includes(b.status) ? <CourierTrackMap deliveryId={b.id} perKm={b.vehicleType ? cfg?.vehicles?.[b.vehicleType]?.perKm : undefined} /> : null}
            <View style={styles.codesRow}>
              <View style={styles.codeBox}><Text style={styles.priceNote}>Code de départ</Text><Text style={styles.codeValue}>{b.pickupCode}</Text></View>
              <View style={styles.codeBox}><Text style={styles.priceNote}>Code de fin</Text><Text style={styles.codeValue}>{b.deliveryCode}</Text></View>
            </View>
            {["PENDING", "MATCHED"].includes(b.status) ? (
              <Pressable
                onPress={() =>
                  BrandAlert.alert("Annuler la réservation", "Veux-tu annuler cette demande ?", [
                    { text: "Non", style: "cancel" },
                    { text: "Annuler", style: "destructive", onPress: () => deliveryApi.cancel(b.id).then(loadBookings).catch((e) => BrandAlert.alert("Erreur", errorMessage(e))) },
                  ])
                }
              >
                <Text style={styles.warn}>Annuler la demande</Text>
              </Pressable>
            ) : null}
          </View>
        ))}

        {GROUPS.map((g) => (
          <View key={g.title} style={{ gap: spacing.sm }}>
            {g.title ? <Text style={styles.sectionTitle}>{g.title}</Text> : null}
            {g.options.map((o) => {
              const r = cfg?.vehicles?.[o.id];
              const active = vehicle === o.id;
              return (
                <Pressable key={o.id} style={[styles.vehicleCard, active && styles.vehicleCardActive]} onPress={() => setVehicle(o.id)}>
                  <View style={styles.vehicleIcon}>
                    <MaterialIcons name={o.icon} size={22} color={active ? colors.onPrimary : colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.vehicleLabel}>{o.label}</Text>
                    {r ? <Text style={styles.vehicleNote}>{fcfa(r.perKm)} / km</Text> : null}
                  </View>
                  {active ? <MaterialIcons name="check-circle" size={22} color={colors.primary} /> : null}
                </Pressable>
              );
            })}
          </View>
        ))}

        <Text style={styles.sectionTitle}>Durée de la réservation</Text>
        <View style={styles.chips}>
          {durations.map((d) => (
            <Pressable
              key={d.hours}
              style={[styles.chip, !longBooking && hours === d.hours && styles.chipActive]}
              onPress={() => {
                setLongBooking(false);
                setHours(d.hours);
              }}
            >
              <Text style={[styles.chipText, !longBooking && hours === d.hours && styles.chipTextActive]}>{d.label}</Text>
            </Pressable>
          ))}
          <Pressable style={[styles.chip, longBooking && styles.chipActive]} onPress={() => setLongBooking(true)}>
            <Text style={[styles.chipText, longBooking && styles.chipTextActive]}>Plus de 3 jours</Text>
          </Pressable>
        </View>
        {longBooking ? (
          <View style={styles.daysRow}>
            <Pressable style={styles.stepBtn} onPress={() => setDays((n) => Math.max(4, n - 1))}>
              <MaterialIcons name="remove" size={20} color={colors.primary} />
            </Pressable>
            <Text style={styles.daysText}>{days} jours</Text>
            <Pressable style={styles.stepBtn} onPress={() => setDays((n) => Math.min(14, n + 1))}>
              <MaterialIcons name="add" size={20} color={colors.primary} />
            </Pressable>
          </View>
        ) : null}
        {longBooking ? <Text style={styles.priceNote}>Pour plus de 3 jours, programme le début de ta réservation ci-dessous.</Text> : null}

        <Text style={styles.sectionTitle}>Départ</Text>
        <SchedulePicker value={scheduledAt} onChange={setScheduledAt} onModeChange={setScheduleMode} />

        <Text style={styles.sectionTitle}>Lieux</Text>
        <PlacePickerMap pickup={pickup} drop={drop} onPickup={setPickup} onDrop={setDrop} onRouteKm={setRouteKm} dropLabel="Destination (facultatif)" />

        <View style={styles.priceCard}>
          <Text style={styles.priceLabel}>Prix estimé</Text>
          <Text style={styles.priceValue}>{estimate !== null ? fcfa(estimate) : rule ? `${fcfa(rule.perKm)} / km` : "—"}</Text>
          <Text style={styles.priceNote}>
            {estimate !== null
              ? "Estimation : le total final dépend des kilomètres réellement parcourus (suivi GPS). Payé avec AZƆ̀ Pay."
              : "Le total est calculé à la fin de la course selon les kilomètres réellement parcourus. Payé avec AZƆ̀ Pay."}
          </Text>
          {notEnough ? (
            <Pressable onPress={onRecharge}>
              <Text style={styles.warn}>Solde insuffisant ({fcfa(balance ?? 0)}). Recharger mon portefeuille</Text>
            </Pressable>
          ) : null}
        </View>

        {loading ? <ActivityIndicator color={colors.primary} /> : <PrimaryButton label="Demander un coursier personnel" onPress={confirm} />}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceContainerLow },
  headerTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  intro: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  sectionTitle: { ...typography.labelLg, color: colors.onSurface, fontWeight: "800" },
  vehicleCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surfaceContainerLowest, borderWidth: 1, borderColor: colors.surfaceContainer },
  vehicleCardActive: { borderWidth: 1.5, borderColor: colors.primary, backgroundColor: `${colors.primaryFixed}40` },
  vehicleIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.primaryFixed },
  vehicleLabel: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
  vehicleNote: { ...typography.bodySm, color: colors.onSurfaceVariant },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.full, backgroundColor: colors.surfaceContainerLow },
  chipActive: { backgroundColor: colors.primary },
  chipText: { ...typography.labelMd, color: colors.onSurfaceVariant, fontWeight: "700" },
  chipTextActive: { color: colors.onPrimary },
  field: { backgroundColor: colors.surfaceContainerLow, borderRadius: radius.lg, padding: spacing.md },
  fieldLabel: { ...typography.labelSm, color: colors.outline, textTransform: "uppercase" },
  fieldInput: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700", paddingVertical: 6 },
  pickedRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  pickedText: { ...typography.labelSm, color: colors.primary },
  result: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.surfaceContainerHigh },
  resultTitle: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  resultSub: { ...typography.bodySm, color: colors.onSurfaceVariant },
  priceCard: { backgroundColor: colors.primaryFixed, borderRadius: radius.lg, padding: spacing.md, gap: 2 },
  priceLabel: { ...typography.labelSm, color: colors.onPrimaryFixed },
  priceValue: { ...typography.headlineMd, color: colors.primary, fontWeight: "800" },
  priceNote: { ...typography.bodySm, color: colors.onPrimaryFixed },
  daysRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  stepBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.primaryFixed },
  daysText: { ...typography.labelLg, color: colors.onSurface, fontWeight: "800" },
  bookingCard: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs, borderWidth: 1.5, borderColor: colors.primary },
  bookingTitle: { ...typography.labelLg, color: colors.primary, fontWeight: "800" },
  codesRow: { flexDirection: "row", gap: spacing.sm },
  codeBox: { flex: 1, backgroundColor: colors.surfaceContainerLow, borderRadius: radius.md, padding: spacing.sm, alignItems: "center" },
  codeValue: { ...typography.headlineSm, color: colors.primary, fontWeight: "800", letterSpacing: 3 },
  warn: { ...typography.labelMd, color: colors.error, fontWeight: "700", marginTop: 6 },
});
