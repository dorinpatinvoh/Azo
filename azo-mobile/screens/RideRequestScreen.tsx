import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  useWindowDimensions,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Defs, LinearGradient as SvgGradient, RadialGradient, Stop, Path, Circle, Rect } from "react-native-svg";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { ridesApi, VehicleType } from "../services/api";

type Vehicle = {
  id: string;
  name: string;
  badge?: string;
  eta: string;
  note: string;
  price: number;
  oldPrice?: number;
  icon: keyof typeof MaterialIcons.glyphMap;
  description: string;
};

const VEHICLES: Vehicle[] = [
  {
    id: "zem-express",
    name: "Zémidjan AZƆ̀",
    badge: "Populaire",
    eta: "2 min",
    note: "Rapide & agile",
    price: 650,
    oldPrice: 750,
    icon: "two-wheeler",
    description: "1 passager • Casque nettoyé • Filtre bouchons",
  },
  {
    id: "zem-elec",
    name: "Zém Électrique",
    badge: "Éco",
    eta: "4 min",
    note: "Silencieux",
    price: 600,
    icon: "electric-moped",
    description: "100% zéro émission & trajet fluide",
  },
  {
    id: "car-confort",
    name: "AZƆ̀ Confort",
    eta: "5 min",
    note: "Tout confort",
    price: 1850,
    icon: "directions-car",
    description: "4 places • Climatisation • Grand coffre",
  },
];

// Correspondance entre les cartes de l'écran et les types du backend
const VEHICLE_TYPE: Record<string, VehicleType> = {
  "zem-express": "ZEM",
  "zem-elec": "ZEM_ELECTRIC",
  "car-confort": "CAR",
};

// Coordonnées de démonstration (Haie Vive -> Dantokpa, Cotonou).
// Plus tard : les remplacer par la vraie position GPS et l'adresse saisie.
const ORIGIN = { lat: 6.362, lng: 2.392 };
const DEST = { lat: 6.368, lng: 2.436 };

type Props = {
  onBack: () => void;
  onConfirm: (vehicle: Vehicle, rideId: string) => void;
};

export default function RideRequestScreen({ onBack, onConfirm }: Props) {
  const { width } = useWindowDimensions();
  const [selectedId, setSelectedId] = useState(VEHICLES[0].id);
  const selected = useMemo(
    () => VEHICLES.find((v) => v.id === selectedId)!,
    [selectedId]
  );
  const mapHeight = Math.min(320, width * 0.85);
  const [loading, setLoading] = useState(false);

  // Envoie la demande de course au backend, puis passe au suivi
  async function handleConfirm() {
    setLoading(true);
    try {
      const ride = await ridesApi.create({
        originLat: ORIGIN.lat,
        originLng: ORIGIN.lng,
        destLat: DEST.lat,
        destLng: DEST.lng,
        vehicleType: VEHICLE_TYPE[selected.id],
      });
      onConfirm(selected, ride.id);
    } catch (e: any) {
      Alert.alert("Course impossible", e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* En-tête */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable onPress={onBack} style={styles.iconButton} accessibilityLabel="Retour">
            <MaterialIcons name="arrow-back-ios-new" size={18} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.headerTitle}>Sélection trajet</Text>
        </View>
        <View style={styles.headerRight}>
          <Pressable style={styles.iconButton} accessibilityLabel="Urgence">
            <MaterialIcons name="sos" size={20} color={colors.onSurfaceVariant} />
          </Pressable>
          <View style={styles.avatar} />
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xl }}>
        {/* Carte (illustration schématique du trajet) */}
        <View style={[styles.mapWrap, { height: mapHeight }]}>
          <Svg width="100%" height="100%" viewBox="0 0 400 320">
            <Defs>
              <SvgGradient id="routeGradient" x1="90" y1="230" x2="310" y2="90" gradientUnits="userSpaceOnUse">
                <Stop offset="0%" stopColor="#8B2FC9" />
                <Stop offset="45%" stopColor="#C0392B" />
                <Stop offset="75%" stopColor="#E05C1A" />
                <Stop offset="100%" stopColor="#F0A500" />
              </SvgGradient>
              <RadialGradient id="pulseAura" cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor="#8B2FC9" stopOpacity={0.35} />
                <Stop offset="100%" stopColor="#8B2FC9" stopOpacity={0} />
              </RadialGradient>
              <RadialGradient id="pulseDest" cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor="#E05C1A" stopOpacity={0.4} />
                <Stop offset="100%" stopColor="#E05C1A" stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect width="400" height="320" fill="#ede8f2" />
            <Path d="M-20,110 L420,135" stroke="#fcf9f8" strokeWidth={10} strokeLinecap="round" />
            <Path d="M-20,195 L420,175" stroke="#fcf9f8" strokeWidth={8} strokeLinecap="round" />
            <Path d="M70,-10 L110,330" stroke="#fcf9f8" strokeWidth={7} strokeLinecap="round" />
            <Path d="M210,-10 L195,330" stroke="#fcf9f8" strokeWidth={6} strokeLinecap="round" />
            <Path d="M305,-10 L330,330" stroke="#fcf9f8" strokeWidth={8} strokeLinecap="round" />
            {/* Tracé Départ → Destination */}
            <Path
              d="M 92,225 C 130,220 150,185 190,170 C 235,152 265,130 306,94"
              stroke="url(#routeGradient)"
              strokeWidth={4.5}
              strokeLinecap="round"
              fill="none"
            />
            {/* Zémidjans en direct */}
            <Circle cx={160} cy={180} r={4.5} fill="#fd712f" stroke="#fff" strokeWidth={1.5} />
            <Circle cx={230} cy={155} r={4.5} fill="#8B2FC9" stroke="#fff" strokeWidth={1.5} />
            {/* Départ */}
            <Circle cx={92} cy={225} r={18} fill="url(#pulseAura)" />
            <Circle cx={92} cy={225} r={8} fill="#8B2FC9" stroke="#fff" strokeWidth={2.5} />
            {/* Arrivée */}
            <Circle cx={306} cy={94} r={20} fill="url(#pulseDest)" />
            <Rect x={298} y={86} width={16} height={16} rx={4} fill="#a53c00" stroke="#fff" strokeWidth={2.5} />
          </Svg>

          {/* Badge distance / durée */}
          <View style={styles.etaBadge}>
            <View style={styles.livePulse} />
            <Text style={styles.etaText}>14 min</Text>
            <Text style={styles.etaDot}>•</Text>
            <Text style={styles.etaDistance}>4,8 km</Text>
          </View>

          {/* Bouton recentrer */}
          <Pressable style={styles.recenterBtn} accessibilityLabel="Centrer la carte">
            <MaterialIcons name="my-location" size={18} color={colors.primary} />
          </Pressable>
        </View>

        {/* Feuille du bas */}
        <View style={styles.sheet}>
          <View style={styles.handle} />

          {/* Départ / Destination */}
          <View style={styles.routeCard}>
            <View style={styles.routeRow}>
              <View style={styles.routeDots}>
                <View style={styles.dotStart} />
                <View style={styles.dotLine} />
                <View style={styles.dotEnd} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.routeLabel}>POINT DE PRISE EN CHARGE</Text>
                <Text style={styles.routeValue}>Haie Vive, Pharmacie Cocotiers</Text>
                <Text style={[styles.routeLabel, { marginTop: spacing.xs }]}>DESTINATION</Text>
                <Text style={styles.routeValue}>Marché Dantokpa, Grand Hall</Text>
              </View>
              <Pressable style={styles.swapBtn} accessibilityLabel="Inverser l'itinéraire">
                <MaterialIcons name="swap-vert" size={18} color={colors.onSurfaceVariant} />
              </Pressable>
            </View>
          </View>

          {/* Choix du véhicule */}
          <View style={{ marginTop: spacing.md }}>
            <View style={styles.vehicleHeader}>
              <Text style={styles.sectionTitle}>Choisir un véhicule</Text>
              <Text style={styles.availableCount}>{VEHICLES.length} dispos</Text>
            </View>

            <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
              {VEHICLES.map((v) => {
                const isSelected = v.id === selectedId;
                return (
                  <Pressable
                    key={v.id}
                    onPress={() => setSelectedId(v.id)}
                    style={[styles.vehicleCard, isSelected && styles.vehicleCardSelected]}
                  >
                    <View style={styles.vehicleTop}>
                      <View style={styles.vehicleLeft}>
                        <View
                          style={[
                            styles.vehicleIcon,
                            { backgroundColor: isSelected ? colors.primaryContainer : colors.surfaceContainer },
                          ]}
                        >
                          <MaterialIcons
                            name={v.icon}
                            size={24}
                            color={isSelected ? colors.onPrimary : colors.onSurfaceVariant}
                          />
                        </View>
                        <View>
                          <View style={styles.vehicleNameRow}>
                            <Text style={styles.vehicleName}>{v.name}</Text>
                            {v.badge && (
                              <View
                                style={[
                                  styles.badgePill,
                                  {
                                    backgroundColor:
                                      v.badge === "Populaire" ? colors.secondaryContainer : colors.surfaceContainerHigh,
                                  },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.badgeText,
                                    { color: v.badge === "Populaire" ? colors.onSecondary : colors.onSurface },
                                  ]}
                                >
                                  {v.badge}
                                </Text>
                              </View>
                            )}
                          </View>
                          <View style={styles.vehicleMetaRow}>
                            <MaterialIcons name="schedule" size={14} color={colors.secondary} />
                            <Text style={styles.vehicleEta}>{v.eta}</Text>
                            <Text style={styles.vehicleNote}> • {v.note}</Text>
                          </View>
                        </View>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={[styles.vehiclePrice, isSelected && { color: colors.primary }]}>
                          {v.price} F
                        </Text>
                        {v.oldPrice && <Text style={styles.vehicleOldPrice}>{v.oldPrice} F</Text>}
                      </View>
                    </View>

                    <View style={styles.vehicleBottom}>
                      <Text style={styles.vehicleDescription}>{v.description}</Text>
                      <View
                        style={[
                          styles.checkCircle,
                          { backgroundColor: isSelected ? colors.primary : colors.surfaceContainer },
                        ]}
                      >
                        {isSelected && <MaterialIcons name="check" size={13} color={colors.onPrimary} />}
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Promo */}
          <View style={styles.promoRow}>
            <View style={styles.promoLeft}>
              <MaterialIcons name="local-activity" size={20} color={colors.secondary} />
              <Text style={styles.promoText}>Promo BIENVENUE</Text>
            </View>
            <View style={styles.promoDiscountPill}>
              <Text style={styles.promoDiscountText}>-100 FCFA</Text>
            </View>
          </View>

          {/* Paiement */}
          <Pressable style={styles.paymentRow}>
            <View style={styles.promoLeft}>
              <View style={styles.paymentLogo}>
                <Text style={styles.paymentLogoText}>MTN</Text>
              </View>
              <View>
                <Text style={styles.paymentLabel}>MTN Mobile Money</Text>
                <Text style={styles.paymentBalance}>Solde : 14 250 FCFA</Text>
              </View>
            </View>
            <View style={styles.changeRow}>
              <Text style={styles.changeText}>Changer</Text>
              <MaterialIcons name="chevron-right" size={18} color={colors.primary} />
            </View>
          </Pressable>

          {/* CTA */}
          <Pressable style={styles.ctaWrap} onPress={handleConfirm} disabled={loading}>
            <LinearGradient colors={colors.gradientCta} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.cta}>
              <MaterialIcons name="bolt" size={20} color={colors.onPrimary} />
              <Text style={styles.ctaText}>
                {loading
                  ? "Recherche d'un chauffeur..."
                  : `Confirmer ${selected.name} (${selected.price} FCFA)`}
              </Text>
            </LinearGradient>
          </Pressable>
        </View>
      </ScrollView>
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
  headerLeft: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  headerRight: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconButton: { width: 40, height: 40, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...typography.headlineSm, color: colors.onSurface },
  avatar: { width: 32, height: 32, borderRadius: radius.full, backgroundColor: colors.surfaceContainer },
  mapWrap: { width: "100%", backgroundColor: colors.surfaceContainerHigh },
  etaBadge: {
    position: "absolute",
    top: spacing.sm,
    left: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.95)",
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  livePulse: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.secondary },
  etaText: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "700" },
  etaDot: { color: colors.outline },
  etaDistance: { ...typography.labelMd, color: colors.onSurfaceVariant },
  recenterBtn: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.95)",
    alignItems: "center",
    justifyContent: "center",
  },
  sheet: {
    backgroundColor: colors.surfaceContainerLowest,
    marginTop: -24,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  handle: { width: 40, height: 6, borderRadius: 3, backgroundColor: colors.surfaceContainerHigh, alignSelf: "center", marginBottom: spacing.sm },
  routeCard: { backgroundColor: colors.surfaceContainerLow, borderRadius: radius.lg, padding: spacing.md },
  routeRow: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  routeDots: { alignItems: "center", paddingTop: 4 },
  dotStart: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.primary },
  dotLine: { width: 2, height: 26, backgroundColor: colors.outlineVariant, marginVertical: 2 },
  dotEnd: { width: 14, height: 14, borderRadius: 3, backgroundColor: colors.secondary },
  routeLabel: { ...typography.labelSm, color: colors.outline, textTransform: "uppercase" },
  routeValue: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
  swapBtn: { width: 32, height: 32, borderRadius: radius.full, backgroundColor: colors.surfaceContainer, alignItems: "center", justifyContent: "center" },
  vehicleHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 2 },
  sectionTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "700" },
  availableCount: { ...typography.labelMd, color: colors.primary, fontWeight: "700" },
  vehicleCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.md,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },
  vehicleCardSelected: { backgroundColor: `${colors.primaryFixed}55`, borderWidth: 1.5, borderColor: colors.primary },
  vehicleTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  vehicleLeft: { flexDirection: "row", gap: spacing.sm, alignItems: "center", flexShrink: 1 },
  vehicleIcon: { width: 48, height: 48, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
  vehicleNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  vehicleName: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "700" },
  badgePill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full },
  badgeText: { ...typography.labelSm, fontWeight: "700" },
  vehicleMetaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  vehicleEta: { ...typography.labelMd, color: colors.secondary, fontWeight: "700" },
  vehicleNote: { ...typography.labelMd, color: colors.onSurfaceVariant },
  vehiclePrice: { ...typography.headlineMd, color: colors.onSurface, fontWeight: "800" },
  vehicleOldPrice: { ...typography.labelSm, color: colors.outline, textDecorationLine: "line-through" },
  vehicleBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.xs },
  vehicleDescription: { ...typography.bodySm, color: colors.onSurfaceVariant, flex: 1 },
  checkCircle: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  promoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginTop: spacing.md,
  },
  promoLeft: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  promoText: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  promoDiscountPill: { backgroundColor: colors.secondaryFixed, paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.full },
  promoDiscountText: { ...typography.labelSm, color: colors.onSecondaryFixed, fontWeight: "700" },
  paymentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.sm,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  paymentLogo: { width: 36, height: 36, borderRadius: radius.full, backgroundColor: colors.surfaceContainer, alignItems: "center", justifyContent: "center" },
  paymentLogoText: { ...typography.labelSm, color: colors.secondary, fontWeight: "700" },
  paymentLabel: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
  paymentBalance: { ...typography.bodySm, color: colors.onSurfaceVariant },
  changeRow: { flexDirection: "row", alignItems: "center" },
  changeText: { ...typography.labelMd, color: colors.primary, fontWeight: "700" },
  ctaWrap: { marginTop: spacing.md, borderRadius: radius.full, overflow: "hidden" },
  cta: { height: 54, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  ctaText: { ...typography.labelLg, color: colors.onPrimary, fontWeight: "700" },
});
