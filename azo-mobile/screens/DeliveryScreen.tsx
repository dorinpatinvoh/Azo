import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import PrimaryButton from "../components/PrimaryButton";
import { Delivery, deliveryApi, errorMessage } from "../services/api";
import { maskBeninPhone, maskPersonName } from "../utils/phone";
import RideChatModal from "../components/RideChatModal";

const PACKAGE_TYPES = [
  { id: "doc", label: "Document / Pli", note: "Pli urgent < 1 kg", price: 1000, icon: "drafts" as const },
  { id: "small", label: "Petit Colis", note: "Sac / Repas < 5 kg", price: 1500, icon: "shopping-bag" as const },
  { id: "medium", label: "Colis Moyen", note: "Carton < 15 kg", price: 2500, icon: "inventory-2" as const },
  {
    id: "personal",
    label: "Coursier Personnel",
    note: "Courses, pharmacie, achats personnels",
    price: 2000,
    icon: "directions-run" as const,
  },
];

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  PENDING: { label: "Recherche d'un coursier…", color: colors.secondary, bg: colors.secondaryFixed },
  MATCHED: { label: "Coursier en route (ramassage)", color: colors.primary, bg: colors.primaryFixed },
  IN_PROGRESS: { label: "Colis en livraison", color: colors.primary, bg: colors.primaryFixed },
  COMPLETED: { label: "Livré ✅", color: "#146C2E", bg: "#D7F0DC" },
  CANCELLED: { label: "Annulé", color: colors.error, bg: colors.errorContainer },
};

const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} F`;

type Props = { onBack: () => void; onConfirm: () => void };

export default function DeliveryScreen({ onBack }: Props) {
  const [selectedType, setSelectedType] = useState("small");
  const [pickupAddress, setPickupAddress] = useState("Haie Vive, Pharmacie Cotonou");
  const [dropAddress, setDropAddress] = useState("Akpakpa, Dodomè, Rue des Pavés");
  const [payer, setPayer] = useState<"me" | "recipient">("me");
  const [loading, setLoading] = useState(false);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [chatDelivery, setChatDelivery] = useState<Delivery | null>(null);

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
    if (pickupAddress.trim().length < 3 || dropAddress.trim().length < 3) {
      Alert.alert("Adresses requises", "Indique l'adresse de ramassage et l'adresse de livraison.");
      return;
    }
    setLoading(true);
    try {
      const d = await deliveryApi.create({
        packageType: selectedType,
        pickupAddress: pickupAddress.trim(),
        dropAddress: dropAddress.trim(),
        payer: payer === "me" ? "SENDER" : "RECIPIENT",
        price: selectedPackage.price,
      });
      await loadMine();
      Alert.alert(
        "Coursier en recherche 📦",
        `Code de ramassage (expéditeur) : ${d.pickupCode}\nCode de remise (destinataire) : ${d.deliveryCode}\n\nConserve ces codes : le coursier en aura besoin pour valider chaque étape.`
      );
    } catch (e) {
      Alert.alert("Impossible de commander", errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  function handleCancel(d: Delivery) {
    Alert.alert("Annuler la livraison", "Veux-tu annuler cette demande de coursier ?", [
      { text: "Non", style: "cancel" },
      {
        text: "Annuler la demande",
        style: "destructive",
        onPress: async () => {
          try {
            await deliveryApi.cancel(d.id);
            await loadMine();
          } catch (e) {
            Alert.alert("Erreur", errorMessage(e));
          }
        },
      },
    ]);
  }

  const activeDeliveries = deliveries.filter((d) =>
    ["PENDING", "MATCHED", "IN_PROGRESS"].includes(d.status)
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.iconButton}>
          <MaterialIcons name="arrow-back-ios-new" size={18} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Coursier & Livraison</Text>
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
            <Text style={styles.bannerTitle}>Coursier Express & Personnel — Cotonou</Text>
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

                  <Text style={styles.activeRoute} numberOfLines={1}>
                    <Text style={{ fontWeight: "700" }}>De : </Text>
                    {d.pickupAddress}
                  </Text>
                  <Text style={styles.activeRoute} numberOfLines={1}>
                    <Text style={{ fontWeight: "700" }}>Vers : </Text>
                    {d.dropAddress}
                  </Text>

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
                        {maskPersonName(d.courier.fullName, "Coursier AZƆ̀")} ·{" "}
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

        <Text style={styles.sectionTitle}>Que souhaites-tu confier au coursier ?</Text>
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
                <Text style={styles.typePrice}>{fcfa(p.price)}</Text>
                {active && <MaterialIcons name="check-circle" size={20} color={colors.primary} />}
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Adresses de la mission</Text>
        <View style={styles.addressCard}>
          <Text style={styles.addressLabel}>Point de ramassage / Départ</Text>
          <TextInput
            style={styles.addressInput}
            value={pickupAddress}
            onChangeText={setPickupAddress}
            placeholder="Ex. Haie Vive, Pharmacie Cotonou"
            placeholderTextColor={colors.outline}
          />
          <View style={styles.divider} />
          <Text style={styles.addressLabel}>Point de livraison / Destination</Text>
          <TextInput
            style={styles.addressInput}
            value={dropAddress}
            onChangeText={setDropAddress}
            placeholder="Ex. Akpakpa, Dodomè, Rue des Pavés"
            placeholderTextColor={colors.outline}
          />
        </View>

        <View style={styles.otpBanner}>
          <MaterialIcons name="verified-user" size={20} color={colors.primary} />
          <Text style={styles.otpTitle}>
            Double sécurité OTP antivol — 1 code au ramassage + 1 code à la remise finale
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Règlement de la course ({fcfa(selectedPackage.price)})</Text>
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
            label={`Commander un coursier · ${fcfa(selectedPackage.price)}`}
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
