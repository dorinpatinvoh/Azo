import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { FONT } from "../theme/fontNormalize";
import PrimaryButton from "../components/PrimaryButton";
import { Delivery, Place, VehicleType, deliveryApi, errorMessage } from "../services/api";
import { maskBeninPhone, maskPersonName } from "../utils/phone";
import RideChatModal from "../components/RideChatModal";
import CourierTrackMap from "../components/CourierTrackMap";
import PlacePickerMap from "../components/PlacePickerMap";
import { tarification } from "../services/tarification";
import { BrandAlert } from "../components/BrandAlert";

const PACKAGE_TYPES = [
  { id: "doc", label: "Document / Pli", note: "Pli urgent < 1 kg", icon: "drafts" as const },
  { id: "small", label: "Petit Colis", note: "Sac / Repas < 5 kg", icon: "shopping-bag" as const },
  { id: "medium", label: "Colis Moyen", note: "Carton < 15 kg", icon: "inventory-2" as const },
  // Gros colis : seul le Speeder tricycle le livre
  { id: "large", label: "Gros Colis", note: "Volumineux — Speeder tricycle uniquement", icon: "local-shipping" as const },
];

// Le Speeder dont le client a besoin pour son colis (seuls les livreurs de ce véhicule voient la mission)
const SPEEDERS: { id: VehicleType; label: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { id: "ZEM_ESSENCE", label: "Speeder à essence", icon: "two-wheeler" },
  { id: "ZEM_ELECTRIC", label: "Speeder électrique", icon: "electric-moped" },
  { id: "ZEM_TRICYCLE", label: "Speeder tricycle", icon: "electric-rickshaw" },
];

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  PENDING: { label: "Recherche d'un livreur…", color: colors.secondary, bg: colors.secondaryFixed },
  MATCHED: { label: "Livreur en route (ramassage)", color: colors.primary, bg: colors.primaryFixed },
  IN_PROGRESS: { label: "Colis en livraison", color: colors.primary, bg: colors.primaryFixed },
  COMPLETED: { label: "Livré ✅", color: "#146C2E", bg: "#D7F0DC" },
  CANCELLED: { label: "Annulé", color: colors.error, bg: colors.errorContainer },
};

const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} F`;

type Props = { onBack: () => void; onConfirm: () => void; initialDrop?: Place | null; initialSpeeder?: VehicleType | null };

export default function DeliveryScreen({ onBack, initialDrop, initialSpeeder }: Props) {
  const [selectedType, setSelectedType] = useState("small");
  const [speeder, setSpeeder] = useState<VehicleType>(initialSpeeder && initialSpeeder !== "GAZELLE" && initialSpeeder !== "KOALA" && initialSpeeder !== "LEOPARD" ? initialSpeeder : "ZEM_ESSENCE");
  const [routeKm, setRouteKm] = useState<number | null>(null);
  const [pickup, setPickup] = useState<Place | null>(null);
  const [drop, setDrop] = useState<Place | null>(initialDrop ?? null);
  // Prix exact calculé par le serveur sur la distance de l'itinéraire (base + km × tarif du Speeder)
  const [quote, setQuote] = useState<{ km: number; price: number } | null>(null);
  const [payer, setPayer] = useState<"me" | "recipient">("me");
  const [loading, setLoading] = useState(false);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [chatDelivery, setChatDelivery] = useState<Delivery | null>(null);

  // Prix estimé (le serveur recalcule sur l'itinéraire) : base + km × tarif ; la base n'est jamais affichée
  const rule = tarification().delivery?.vehicles?.[speeder];
  const ruleBase = rule ? (rule.baseByPackage ? rule.baseByPackage[selectedType] : rule.base) : undefined;
  const estimate = quote ? quote.price : rule && ruleBase !== undefined && routeKm !== null ? Math.round(ruleBase + routeKm * rule.perKm) : null;

  useEffect(() => {
    // le gros colis ne se livre qu'en tricycle : les autres Speeders se cachent
    if (selectedType === "large" && speeder !== "ZEM_TRICYCLE") setSpeeder("ZEM_TRICYCLE");
  }, [speeder, selectedType]);

  useEffect(() => {
    if (!pickup || !drop) {
      setQuote(null);
      return;
    }
    let alive = true;
    deliveryApi
      .quote({ vehicleType: speeder, packageType: selectedType, pickupLat: pickup.latitude, pickupLng: pickup.longitude, dropLat: drop.latitude, dropLng: drop.longitude })
      .then((q) => alive && setQuote(q))
      .catch(() => alive && setQuote(null));
    return () => {
      alive = false;
    };
  }, [speeder, selectedType, pickup?.latitude, pickup?.longitude, drop?.latitude, drop?.longitude]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedPackage = PACKAGE_TYPES.find((p) => p.id === selectedType) ?? PACKAGE_TYPES[1];

  const loadMine = useCallback(async () => {
    try {
      const list = await deliveryApi.mine();
      setDeliveries(list);
    } catch {
      // Silencieux si hors ligne
    }
  }, []);

  useEffect(() => {
    loadMine();
    const timer = setInterval(loadMine, 8000);
    return () => clearInterval(timer);
  }, [loadMine]);

  async function onRefresh() {
    setRefreshing(true);
    await loadMine();
    setRefreshing(false);
  }

  async function handleConfirm() {
    if (!pickup || !drop) {
      BrandAlert.alert("Adresses requises", "Indique l'adresse de ramassage et l'adresse de livraison.");
      return;
    }
    setLoading(true);
    try {
      const d = await deliveryApi.create({
        packageType: selectedType,
        pickupAddress: pickup.title,
        dropAddress: drop.title,
        vehicleType: speeder,
        pickupLat: pickup.latitude,
        pickupLng: pickup.longitude,
        dropLat: drop.latitude,
        dropLng: drop.longitude,
        payer: payer === "me" ? "SENDER" : "RECIPIENT",
      });
      await loadMine();
      BrandAlert.alert(
        "Livreur en recherche 📦",
        `Code de ramassage (expéditeur) : ${d.pickupCode}\nCode de remise (destinataire) : ${d.deliveryCode}\n\nConserve ces codes : le livreur en aura besoin pour valider chaque étape.`
      );
    } catch (e) {
      BrandAlert.alert("Impossible de commander", errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  function handleCancel(d: Delivery) {
    BrandAlert.alert("Annuler la livraison", "Veux-tu annuler cette demande de livreur ?", [
      { text: "Non", style: "cancel" },
      {
        text: "Annuler la demande",
        style: "destructive",
        onPress: async () => {
          try {
            await deliveryApi.cancel(d.id);
            await loadMine();
          } catch (e) {
            BrandAlert.alert("Erreur", errorMessage(e));
          }
        },
      },
    ]);
  }

  const activeDeliveries = deliveries.filter((d) =>
    d.mode !== "PERSONAL" && ["PENDING", "MATCHED", "IN_PROGRESS"].includes(d.status)
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.iconButton}>
          <MaterialIcons name="arrow-back-ios-new" size={18} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Envoyer un colis</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.banner}>
          <MaterialIcons name="verified-user" size={22} color={colors.onPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerTitle}>Livreur express — Cotonou</Text>
            <Text style={styles.bannerSubtitle}>Double sécurité OTP au ramassage et à la remise</Text>
          </View>
        </View>

        {/*Suivi des livraisons en cours avec codes OTP visibles */}
        {activeDeliveries.length > 0 ? (
          <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
            <Text style={styles.sectionTitle}>Mes missions en cours ({activeDeliveries.length})</Text>
            {activeDeliveries.map((d) => {
              const st = STATUS_META[d.status] ?? STATUS_META.PENDING;
              return (
                <View key={d.id} style={styles.activeCard}>
                  <View style={styles.activeTop}>
                    <View style={[styles.statusBadge, { backgroundColor: st.bg }]}>
                      <Text style={[styles.statusBadgeText, { color: st.color }]}>{st.label}</Text>
                    </View>
                    <Text style={styles.activePrice}>{fcfa(d.price)}</Text>
                  </View>

                  {d.mode === "PERSONAL" ? (
                    <Text style={styles.activeRoute}>
                      <Text style={{ fontFamily: FONT.bold }}>Coursier personnel · </Text>
                      {d.vehicleType ?? ""}
                      {d.bookedUntil ? ` · réservé jusqu'au ${new Date(d.bookedUntil).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : d.bookingHours ? ` · ${d.bookingHours} h` : ""}
                    </Text>
                  ) : null}
                  <Text style={styles.activeRoute} numberOfLines={1}>
                    <Text style={{ fontFamily: FONT.bold }}>De : </Text>
                    {d.pickupAddress}
                  </Text>
                  <Text style={styles.activeRoute} numberOfLines={1}>
                    <Text style={{ fontFamily: FONT.bold }}>Vers : </Text>
                    {d.dropAddress}
                  </Text>

                  {["MATCHED", "IN_PROGRESS"].includes(d.status) ? (
                    <CourierTrackMap deliveryId={d.id} perKm={d.mode === "PERSONAL" && d.vehicleType ? tarification().personalCourier?.vehicles?.[d.vehicleType]?.perKm : undefined} />
                  ) : null}

                  <View style={styles.codesRow}>
                    <View style={styles.codePill}>
                      <Text style={styles.codePillLabel}>Code ramassage</Text>
                      <Text style={styles.codePillValue}>{d.pickupCode}</Text>
                    </View>
                    <View style={styles.codePill}>
                      <Text style={styles.codePillLabel}>Code remise finale</Text>
                      <Text style={styles.codePillValue}>{d.deliveryCode}</Text>
                    </View>
                  </View>

                  {d.courier ? (
                    <View style={styles.courierRow}>
                      <MaterialIcons name="shield" size={18} color={colors.primary} />
                      <Text style={styles.courierText} numberOfLines={1}>
                        {maskPersonName(d.courier.fullName, "Livreur AZƆ̀")} ·{" "}
                        {maskBeninPhone(d.courier.phone)}
                      </Text>
                      <Pressable
                        style={styles.chatSmallBtn}
                        onPress={() => setChatDelivery(d)}
                      >
                        <MaterialIcons name="chat-bubble-outline" size={14} color="#fff" />
                        <Text style={styles.chatSmallBtnText}>Message</Text>
                      </Pressable>
                    </View>
                  ) : null}

                  {["PENDING", "MATCHED"].includes(d.status) ? (
                    <Pressable style={styles.cancelBtn} onPress={() => handleCancel(d)}>
                      <Text style={styles.cancelBtnText}>Annuler la demande</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Que souhaites-tu confier au livreur ?</Text>
        <View style={{ gap: spacing.sm }}>
          {PACKAGE_TYPES.map((p) => {
            const active = p.id === selectedType;
            return (
              <Pressable
                key={p.id}
                style={[styles.typeCard, active && styles.typeCardActive]}
                onPress={() => setSelectedType(p.id)}
              >
                <View
                  style={[
                    styles.typeIcon,
                    { backgroundColor: active ? colors.primary : colors.surfaceContainer },
                  ]}
                >
                  <MaterialIcons
                    name={p.icon}
                    size={22}
                    color={active ? colors.onPrimary : colors.onSurfaceVariant}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.typeLabel}>{p.label}</Text>
                  <Text style={styles.typeNote}>{p.note}</Text>
                </View>
                {active && <MaterialIcons name="check-circle" size={20} color={colors.primary} />}
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Quel Speeder pour ton colis ?</Text>
        <View style={{ gap: spacing.sm }}>
          {SPEEDERS.filter((v) => selectedType !== "large" || v.id === "ZEM_TRICYCLE").map((v) => {
            const active = speeder === v.id;
            const perKm = tarification().delivery?.vehicles?.[v.id]?.perKm;
            return (
              <Pressable key={v.id} style={[styles.speederCard, active && styles.speederCardActive]} onPress={() => setSpeeder(v.id)}>
                <View style={[styles.speederIcon, { backgroundColor: active ? colors.primary : colors.surfaceContainer }]}>
                  <MaterialIcons name={v.icon} size={22} color={active ? colors.onPrimary : colors.onSurfaceVariant} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.typeLabel}>{v.label}</Text>
                  {perKm !== undefined ? <Text style={styles.typeNote}>{fcfa(perKm)} / km</Text> : null}
                </View>
                {active ? <MaterialIcons name="check-circle" size={20} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Adresses de la mission</Text>
        <PlacePickerMap pickup={pickup} drop={drop} onPickup={setPickup} onDrop={setDrop} onRouteKm={setRouteKm} pickupLabel="Point de ramassage / Départ" dropLabel="Point de livraison / Destination" />

        <View style={styles.otpBanner}>
          <MaterialIcons name="verified-user" size={20} color={colors.primary} />
          <Text style={styles.otpTitle}>
            Double sécurité OTP antivol — 1 code au ramassage + 1 code à la remise finale
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Règlement de la course{estimate !== null ? ` (${fcfa(estimate)})` : ""}</Text>
        {quote ? <Text style={styles.typeNote}>Distance : {quote.km.toLocaleString("fr-FR")} km · prix calculé sur l'itinéraire</Text> : null}
        <View style={styles.payerRow}>
          <Pressable
            style={[styles.payerChip, payer === "me" && styles.payerChipActive]}
            onPress={() => setPayer("me")}
          >
            <MaterialIcons
              name="account-balance-wallet"
              size={18}
              color={payer === "me" ? colors.onPrimary : colors.onSurfaceVariant}
            />
            <Text style={[styles.payerText, payer === "me" && { color: colors.onPrimary }]}>
              Par moi (AZƆ̀ Pay)
            </Text>
          </Pressable>
          <Pressable
            style={[styles.payerChip, payer === "recipient" && styles.payerChipActive]}
            onPress={() => setPayer("recipient")}
          >
            <MaterialIcons
              name="payments"
              size={18}
              color={payer === "recipient" ? colors.onPrimary : colors.onSurfaceVariant}
            />
            <Text style={[styles.payerText, payer === "recipient" && { color: colors.onPrimary }]}>
              Par destinataire
            </Text>
          </Pressable>
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <PrimaryButton
            label={estimate !== null ? `Commander un livreur · ${fcfa(estimate)}` : "Commander un livreur"}
            icon="local-shipping"
            onPress={handleConfirm}
            loading={loading}
          />
        </View>
      </ScrollView>

      {chatDelivery ? (
        <RideChatModal
          visible={!!chatDelivery}
          rideId={chatDelivery.id}
          myRole="CLIENT"
          peerName={chatDelivery.courier?.fullName}
          peerPhone={chatDelivery.courier?.phone}
          onClose={() => setChatDelivery(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    height: 56,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  scroll: { padding: spacing.md, paddingBottom: 100, gap: spacing.xs },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  bannerTitle: { ...typography.labelLg, color: colors.onPrimary, fontWeight: "700" },
  bannerSubtitle: { ...typography.bodySm, color: "rgba(255,255,255,0.85)" },
  sectionTitle: {
    ...typography.headlineSm,
    color: colors.onSurface,
    fontWeight: "700",
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },

  activeCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: 8,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  activeTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full },
  statusBadgeText: { ...typography.labelSm, fontWeight: "800" },
  activePrice: { ...typography.labelLg, color: colors.primary, fontWeight: "800" },
  activeRoute: { ...typography.bodySm, color: colors.onSurface },
  codesRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  codePill: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.md,
    padding: spacing.sm,
    alignItems: "center",
  },
  codePillLabel: { ...typography.labelSm, color: colors.onSurfaceVariant },
  codePillValue: {
    ...typography.headlineSm,
    color: colors.primary,
    fontWeight: "800",
    letterSpacing: 3,
    marginTop: 2,
  },
  courierRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 4,
  },
  courierText: { ...typography.labelMd, color: colors.onSurface, flex: 1, fontWeight: "600" },
  callSmallBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  chatSmallBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  chatSmallBtnText: {
    ...typography.labelSm,
    color: "#fff",
    fontWeight: "800",
  },
  cancelBtn: { alignSelf: "flex-end", paddingVertical: 4 },
  cancelBtnText: { ...typography.labelSm, color: colors.error, fontWeight: "700" },

  typeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
  },
  typeCardActive: { borderWidth: 1.5, borderColor: colors.primary, backgroundColor: `${colors.primaryFixed}40` },
  typeIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  typeLabel: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
  typeNote: { ...typography.bodySm, color: colors.onSurfaceVariant },
  speederCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.surfaceContainer },
  speederCardActive: { borderWidth: 1.5, borderColor: colors.primary, backgroundColor: `${colors.primaryFixed}40` },
  speederIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  typePrice: { ...typography.labelLg, color: colors.primary, fontWeight: "800" },

  addressCard: { backgroundColor: colors.surfaceContainerLow, borderRadius: radius.lg, padding: spacing.md },
  addressLabel: { ...typography.labelSm, color: colors.outline, textTransform: "uppercase" },
  addressInput: {
    ...typography.labelLg,
    color: colors.onSurface,
    fontWeight: "700",
    marginTop: 4,
    paddingVertical: 6,
  },
  divider: { height: 1, backgroundColor: colors.surfaceContainerHigh, marginVertical: spacing.sm },
  otpBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.primaryFixed,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    marginTop: spacing.md,
  },
  otpTitle: { ...typography.labelSm, color: colors.onPrimaryFixed, flex: 1, fontWeight: "600" },
  payerRow: { flexDirection: "row", gap: spacing.sm },
  payerChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLow,
  },
  payerChipActive: { backgroundColor: colors.primary },
  payerText: { ...typography.labelMd, color: colors.onSurfaceVariant, fontWeight: "700" },
});
