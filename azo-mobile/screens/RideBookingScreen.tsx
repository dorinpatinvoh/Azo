import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, TextInput, StyleSheet, Pressable, ScrollView,
  ActivityIndicator, Linking, Keyboard, Alert,
  Platform,
} from "react-native";
// Supprime l'ancien import de MapView, UrlTile, Marker
import * as SecureStore from "expo-secure-store";
import OSMMapView, { type LatLng } from "../components/OSMMapView";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { Estimate, Place, PlaceSuggestion, VehicleType, errorCode, errorMessage, placesApi, rideApi, ridesApi, walletApi } from "../services/api";
import SchedulePicker from "../components/SchedulePicker";
import { POPULAR_PLACES } from "../config/quickPlaces";
import {
  CAR_VEHICLES,
  ZEM_VEHICLES,
  refreshTarification,
  ridePrice,
  tarification,
} from "../services/tarification";
import { useCurrentLocation } from "../hooks/useCurrentLocation";
import { getDrivingRoute, type DrivingRoute } from "../services/routing";
import { getLanguage, languageInfo, tr, useI18n, type MessageKey } from "../i18n";

type Props = {
  service: "transport" | "zem";
  onBack: () => void;
  onRecharge: () => void;
  /** Speeder déjà choisi depuis l'accueil (ex. tricycle). */
  initialZemType?: VehicleType | null;
  /** Destination choisie depuis l'accueil (lieux en 1 clic). */
  initialDestination?: Place | null;
  onConfirmed: (rideId: string, destinationLabel: string) => void;
};
type Target = "origin" | "destination";

/**
 * Deux filières bien séparées :
 *   * ZEM_ESSENCE / ZEM_ELECTRIC → les motos-taxis (Speeder), choisis à l'étape 1 ;
 *   * GAZELLE / KOALA / LEOPARD  → les voitures proposées pour une course.
 */
const VEHICLES: Record<VehicleType, { icon: keyof typeof MaterialIcons.glyphMap }> = {
  ZEM_ESSENCE: { icon: "two-wheeler" },
  ZEM_ELECTRIC: { icon: "electric-moped" },
  ZEM_TRICYCLE: { icon: "electric-rickshaw" },
  GAZELLE: { icon: "directions-car" },
  KOALA: { icon: "directions-car" },
  LEOPARD: { icon: "local-taxi" },
};
const vLabel = (v: VehicleType) => tr(`veh.${v}.label` as MessageKey);
const vShort = (v: VehicleType) => tr(`veh.${v}.short` as MessageKey);
const ERROR_COLOR = "#B3261B";

// Adresses enregistrées (domicile, travail) : gardées sur le téléphone, aucun serveur
const SAVED_PLACES_KEY = "savedPlaces";
type SavedKey = "home" | "work";
type SavedPlaces = Partial<Record<SavedKey, Place>>;
const SAVED_KEYS: SavedKey[] = ["home", "work"];
const numLocale = () => languageInfo(getLanguage()).locale;
const fcfa = (n: number) => `${n.toLocaleString(numLocale())} FCFA`;

/**
 * Note commune aux deux Speeder, construite depuis la configuration partagée (jamais en dur) :
 * si les paliers kilométriques sont identiques, seule la base les sépare.
 */
function zemCommonNote(): string {
  // Comparaison sur une distance de référence, calculée avec le même barème que la facturation :
  // elle reste juste quand le barème change (base ET paliers), au lieu d'une phrase écrite à la main.
  const essence = ridePrice(ZEM_REFERENCE_KM, "ZEM_ESSENCE");
  const electrique = ridePrice(ZEM_REFERENCE_KM, "ZEM_ELECTRIC");
  const km = ZEM_REFERENCE_KM;
  if (electrique < essence) {
    return tr("ride.zem.noteSave", {
      km, essence: fcfa(essence), electric: fcfa(electrique), saving: fcfa(essence - electrique),
    });
  }
  if (electrique > essence) {
    return tr("ride.zem.noteMore", { km, essence: fcfa(essence), electric: fcfa(electrique) });
  }
  return tr("ride.zem.noteSame", { price: fcfa(essence), km });
}

/** Distance de référence des exemples de prix (aucune donnée de course n'est encore connue). */
const ZEM_REFERENCE_KM = 10;
const EXAMPLE_KM = 5;

/** Paliers d'un véhicule sous forme de cellules « distance → prix au km ». */
function tariffCells(vehicle: VehicleType): { label: string; perKm: number }[] {
  const pricing = tarification().vehicles[vehicle];
  return pricing.brackets.map((b, i) => {
    const from = i === 0 ? 0 : (pricing.brackets[i - 1].upToKm ?? 0) + 1;
    return { label: b.upToKm === null ? tr("ride.tier.open", { from }) : `${from}–${b.upToKm} km`, perKm: b.perKm };
  });
}

type OfferBadge = { icon: keyof typeof MaterialIcons.glyphMap; label: string };

/** Nom court : le reste (climatisé, gamme…) est dit par les badges de la carte. */
const shortName = (vehicle: VehicleType) => vLabel(vehicle);

/** Badges d'une voiture, tirés de sa fiche de gamme et du barème (climatisation). */
function carBadges(vehicle: VehicleType): OfferBadge[] {
  const pitch = CAR_PITCH[vehicle as CarKey];
  const badges: OfferBadge[] = pitch ? [{ icon: pitch.tagIcon, label: tr(`car.${vehicle as CarKey}.tag` as MessageKey) }] : [];
  if (tarification().vehicles[vehicle]?.airConditioned) badges.push({ icon: "ac-unit", label: tr("ride.badge.ac") });
  return badges;
}

function OfferBadges({ badges }: { badges: OfferBadge[] }) {
  return (
    <>
      {badges.map((badge) => (
        <View key={badge.label} style={styles.zemBadge}>
          <MaterialIcons name={badge.icon} size={12} color={colors.primary} />
          <Text style={styles.zemBadgeText}>{badge.label}</Text>
        </View>
      ))}
    </>
  );
}

/** Prix lisible d'un coup d'œil : prise en charge, une cellule par palier, puis un exemple. */
function PriceBreakdown({ vehicle }: { vehicle: VehicleType }) {
  const cells = tariffCells(vehicle);
  return (
    <>
      <View style={styles.zemTiers}>
        {cells.map((cell, i) => (
          <View key={cell.label} style={[styles.zemTier, i < cells.length - 1 && styles.zemTierDivider]}>
            <Text style={styles.zemTierLabel} numberOfLines={1}>{cell.label}</Text>
            <Text style={styles.zemTierPrice} numberOfLines={1}>{cell.perKm} F/km</Text>
          </View>
        ))}
      </View>
      <Text style={styles.zemExample}>
        {tr("ride.example", { km: EXAMPLE_KM })}<Text style={styles.zemExampleValue}>{fcfa(ridePrice(EXAMPLE_KM, vehicle))}</Text>
      </Text>
    </>
  );
}

/** Carte de choix d'un véhicule (Speeder ou voiture) : même présentation pour les deux filières. */
function VehicleOfferCard({
  vehicle,
  badges,
  onPress,
  hint,
}: {
  vehicle: VehicleType;
  badges: OfferBadge[];
  onPress: () => void;
  hint?: string;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.zemCard, pressed && styles.zemCardPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        hint
          ? tr("ride.a11y.offerHint", { vehicle: vLabel(vehicle), hint })
          : tr("ride.a11y.offer", { vehicle: vLabel(vehicle) })
      }
    >
      <View style={styles.zemCardTop}>
        <View style={styles.zemCardIcon}>
          <MaterialIcons name={VEHICLES[vehicle].icon} size={30} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.zemTitleRow}>
            <Text style={styles.zemCardTitle} numberOfLines={1}>{shortName(vehicle)}</Text>
            <OfferBadges badges={badges} />
          </View>
          <Text style={styles.zemCardSub}>{vShort(vehicle)}</Text>
        </View>
        <MaterialIcons name="chevron-right" size={26} color={colors.outline} />
      </View>
      <PriceBreakdown vehicle={vehicle} />
    </Pressable>
  );
}
/**
 * Icône de gamme de la filière voiture (accroche, atouts et usage idéal : voir i18n/*.ts).
 * Les montants, eux, sont toujours lus dans la configuration partagée.
 */
type CarKey = "GAZELLE" | "KOALA" | "LEOPARD";
const CAR_PITCH: Record<CarKey, { tagIcon: keyof typeof MaterialIcons.glyphMap }> = {
  GAZELLE: { tagIcon: "savings" },
  KOALA: { tagIcon: "airline-seat-recline-extra" },
  LEOPARD: { tagIcon: "workspace-premium" },
};

/**
 * « Ce à quoi tu as droit » pour une gamme de voiture : chaque ligne est construite
 * depuis la configuration partagée (base, paliers, climatisation) — aucun tarif en dur.
 */
function carEntitlements(
  vehicle: VehicleType
): { icon: keyof typeof MaterialIcons.glyphMap; text: string }[] {
  const pricing = tarification().vehicles[vehicle];
  const key = vehicle as CarKey;
  // Les montants ne figurent plus ici : ils sont affichés au-dessus, dans le bloc « Tarif ».
  return [
    { icon: "shield", text: tr("ride.ent.verified") },
    // La climatisation n'est annoncée que si le barème la déclare (config partagée).
    ...(pricing.airConditioned ? [{ icon: "ac-unit" as const, text: tr("ride.ent.ac") }] : []),
    { icon: "workspace-premium", text: tr(`car.${key}.a1` as MessageKey) },
    { icon: "star", text: tr(`car.${key}.a2` as MessageKey) },
    { icon: "check-circle", text: tr("ride.ent.ideal", { text: tr(`car.${key}.ideal` as MessageKey) }) },
  ];
}

const fmtKm = (n: number) => `${n.toLocaleString(numLocale(), { maximumFractionDigits: 1 })} km`;
const fmtDuration = (min: number) =>
  min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;

export default function RideBookingScreen({ service, onBack, onRecharge, onConfirmed, initialZemType, initialDestination }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const gps = useCurrentLocation();
  const originTouched = useRef(false);
  // Étape 1 du parcours Speeder : le client choisit d'abord son type de Speeder
  // (électrique ou essence), puis renseigne sa destination.
  const [zemType, setZemType] = useState<VehicleType | null>(initialZemType ?? null);
  // Étape 1 du parcours voiture : le client choisit sa gamme, découvre ce à quoi il a
  // droit (étape 1 bis), l'accepte, puis renseigne sa destination.
  const [carDetail, setCarDetail] = useState<VehicleType | null>(null);
  const [carType, setCarType] = useState<VehicleType | null>(null);
  const options = useMemo<VehicleType[]>(
    () => (service === "zem" ? (zemType ? [zemType] : []) : carType ? [carType] : []),
    [service, zemType, carType]
  );

  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(initialDestination ?? null);
  const [originText, setOriginText] = useState("");
  const [destText, setDestText] = useState(initialDestination?.title ?? "");
  const [focus, setFocus] = useState<Target | null>(null);
  const [pickTarget, setPickTarget] = useState<Target | null>(null);
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [noResult, setNoResult] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const destInputRef = useRef<TextInput>(null);

  const [estimates, setEstimates] = useState<Partial<Record<VehicleType, Estimate>>>({});
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [roadRoute, setRoadRoute] = useState<DrivingRoute | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const [selected, setSelected] = useState<VehicleType>(CAR_VEHICLES[0]);
  // Course programmée : heure de prise en charge choisie (null = tout de suite)
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  const [scheduleMode, setScheduleMode] = useState(false);
  const [saved, setSaved] = useState<SavedPlaces>({});
  useEffect(() => {
    SecureStore.getItemAsync(SAVED_PLACES_KEY)
      .then((raw) => { if (raw) setSaved(JSON.parse(raw) as SavedPlaces); })
      .catch(() => undefined);
  }, []);
  // Identifiants serveur des adresses (pour pouvoir les supprimer) et destinations fréquentes de l'historique
  const [savedIds, setSavedIds] = useState<Partial<Record<SavedKey, string>>>({});
  const [frequent, setFrequent] = useState<PlaceSuggestion[]>([]);
  const cacheSaved = (next: SavedPlaces) => SecureStore.setItemAsync(SAVED_PLACES_KEY, JSON.stringify(next)).catch(() => undefined);
  const pushSaved = (key: SavedKey, place: Place) =>
    placesApi
      .setSaved(key === "home" ? "HOME" : "WORK", { title: place.title, address: place.subtitle, latitude: place.latitude, longitude: place.longitude })
      .then((row) => setSavedIds((ids) => ({ ...ids, [key]: row.id })))
      .catch(() => undefined); // hors ligne : l'adresse reste sur le téléphone et sera envoyée à la prochaine ouverture
  useEffect(() => {
    // Le serveur fait foi (suit le client d'un téléphone à l'autre) ; une adresse seulement locale lui est envoyée
    placesApi
      .saved()
      .then(({ places }) => {
        const ids: Partial<Record<SavedKey, string>> = {};
        const fromServer: SavedPlaces = {};
        for (const row of places) {
          const key: SavedKey | null = row.kind === "HOME" ? "home" : row.kind === "WORK" ? "work" : null;
          if (!key) continue;
          ids[key] = row.id;
          fromServer[key] = { title: row.title, subtitle: row.address ?? undefined, latitude: row.latitude, longitude: row.longitude };
        }
        setSavedIds(ids);
        setSaved((local) => {
          const merged = { ...local, ...fromServer };
          for (const key of SAVED_KEYS) if (local[key] && !fromServer[key]) pushSaved(key, local[key]!);
          cacheSaved(merged);
          return merged;
        });
      })
      .catch(() => undefined);
    placesApi.suggestions().then((r) => setFrequent(r.suggestions)).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const persistSaved = (next: SavedPlaces) => {
    const previous = saved;
    setSaved(next);
    cacheSaved(next);
    for (const key of SAVED_KEYS) {
      if (next[key] && next[key] !== previous[key]) pushSaved(key, next[key]!);
      if (!next[key] && previous[key] && savedIds[key]) {
        placesApi.removeSaved(savedIds[key]!).catch(() => undefined);
        setSavedIds((ids) => { const copy = { ...ids }; delete copy[key]; return copy; });
      }
    }
  };
  const askRemoveSaved = (key: SavedKey) => {
    Alert.alert(t("place.removeTitle", { name: t(`place.${key}` as MessageKey) }), t("place.removeBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("place.remove"), style: "destructive", onPress: () => { const next = { ...saved }; delete next[key]; persistSaved(next); } },
    ]);
  };

  const [balance, setBalance] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Solde insuffisant : reconnu au code d'erreur du serveur (la phrase change avec la langue)
  const [submitNeedsRecharge, setSubmitNeedsRecharge] = useState(false);

  /* Le véhicule sélectionné suit la filière (Speeder choisi, ou voiture par défaut) */
  useEffect(() => {
    if (options.length > 0 && !options.includes(selected)) setSelected(options[0]);
  }, [options, selected]);

  /* Départ = position GPS */
  useEffect(() => {
    if (!gps.coords || originTouched.current) return;
    const title = gps.address ?? t("ride.myPos");
    setOrigin({ title, latitude: gps.coords.latitude, longitude: gps.coords.longitude });
    setOriginText(title);
  }, [gps.coords, gps.address]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (e) => setKeyboardHeight(e.endCoordinates.height)
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboardHeight(0)
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  /* Barème officiel : rafraîchi depuis le serveur (GET /pricing), sinon barème embarqué.
   * Le barème est une variable de module : sans ce compteur, l'écran restait dessiné avec la
   * copie embarquée (anciens prix) même après réception du barème du serveur. */
  const [, setTariffVersion] = useState(0);
  useEffect(() => {
    refreshTarification()
      .then(() => setTariffVersion((v) => v + 1))
      .catch(() => {});
  }, []);

  /* Solde du portefeuille */
  useEffect(() => {
    walletApi.get().then((w) => setBalance(w.balance)).catch(() => {});
  }, []);

  /* Autocomplétion (debounce 400 ms) */
  useEffect(() => {
    setNoResult(false);
    setSearchError(null);
    if (!focus) { setSuggestions([]); return; }
    const q = (focus === "origin" ? originText : destText).trim();
    const current = focus === "origin" ? origin : destination;
    if (q.length < 3 || current?.title === q) { setSuggestions([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await placesApi.search(q, origin ?? undefined);
        if (!cancelled) { setSuggestions(r); setNoResult(r.length === 0); }
      } catch (e) {
        if (!cancelled) { setSuggestions([]); setSearchError(errorMessage(e)); }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [originText, destText, focus]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Estimation dès que départ + destination sont connus */
  useEffect(() => {
    if (!origin || !destination) {
      setEstimates({});
      setEstimating(false);
      setEstimateError(null);
      return;
    }

    setEstimating(true);
    setEstimateError(null);
    setEstimates({});
    let cancelled = false;
    (async () => {
      try {
        const results = await Promise.all(options.map(async (vehicle) => {
          const estimate = await ridesApi.estimate({
            originLat: origin.latitude,
            originLng: origin.longitude,
            destLat: destination.latitude,
            destLng: destination.longitude,
            vehicleType: vehicle,
          });
          if (
            !Number.isFinite(estimate.distanceKm) || estimate.distanceKm <= 0 ||
            !Number.isFinite(estimate.etaMinutes) || estimate.etaMinutes <= 0 ||
            !Number.isFinite(estimate.price) || estimate.price <= 0
          ) {
            throw new Error(t("ride.invalidEstimate"));
          }
          return [vehicle, estimate] as const;
        }));
        if (!cancelled) {
          setEstimates(results.reduce<Partial<Record<VehicleType, Estimate>>>((byVehicle, [vehicle, estimate]) => {
            byVehicle[vehicle] = estimate;
            return byVehicle;
          }, {}));
        }
      } catch (error) {
        if (!cancelled) setEstimateError(errorMessage(error));
      } finally {
        if (!cancelled) setEstimating(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [origin, destination, options, reloadKey]);

  useEffect(() => {
    if (!origin || !destination) {
      setRoadRoute(null);
      setRouteLoading(false);
      setRouteError(null);
      return;
    }

    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 10000);
    setRoadRoute(null);
    setRouteLoading(true);
    setRouteError(null);

    getDrivingRoute(origin, destination, controller.signal)
      .then((route) => {
        if (active) setRoadRoute(route);
      })
      .catch(() => {
        if (active) setRouteError(t("ride.routeError"));
      })
      .finally(() => {
        clearTimeout(timeout);
        if (active) setRouteLoading(false);
      });

    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [origin, destination, reloadKey]);

  const applyPlace = useCallback((target: Target, place: Place) => {
    if (target === "origin") { originTouched.current = true; setOrigin(place); setOriginText(place.title); }
    else { setDestination(place); setDestText(place.title); }
    setFocus(null);
    setSuggestions([]);
    Keyboard.dismiss();
  }, []);

  const onMapPress = async ({ latitude, longitude }: LatLng) => {
    if (!pickTarget) return;

    const target = pickTarget;
    setPickTarget(null);
    const provisional: Place = { title: t("ride.mapPosition"), latitude, longitude };
    applyPlace(target, provisional);

    try {
      const r = await placesApi.reverseGeocode(latitude, longitude);
      applyPlace(target, { ...provisional, title: r.address });
    } catch {
      // garde le libellé provisoire si le réseau coupe
    }
  };

  /* Véhicule retenu à l'étape 1 : un type de Speeder, ou une gamme de voiture */
  const chosenVehicle = service === "zem" ? zemType : carType;
  const est = estimates[selected];
  const walletInsufficient = balance !== null && !!est && balance < est.price;
  // « Programmer » choisi mais aucune heure sélectionnée : on ne peut pas confirmer
  const scheduleMissing = scheduleMode && !scheduledAt;
  const canConfirm = !!origin && !!destination && !!roadRoute && !!est && !routeLoading && !estimating && !submitting && !walletInsufficient && !scheduleMissing;

  const onConfirm = async () => {
    if (!origin || !destination || !est) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitNeedsRecharge(false);
    try {
      const ride = await rideApi.create({
        originLat: origin.latitude, originLng: origin.longitude,
        destLat: destination.latitude, destLng: destination.longitude,
        vehicleType: selected,
        // Adresses lisibles : le serveur les renvoie au Speeder (champs ignorés tant qu'il ne les connaît pas)
        originLabel: origin.title,
        destLabel: destination.title,
        ...(scheduledAt ? { scheduledAt: scheduledAt.toISOString() } : {}),
      });
      onConfirmed(ride.id, destination.title);
    } catch (e) {
      setSubmitError(errorMessage(e));
      const code = errorCode(e);
      setSubmitNeedsRecharge(
        code === "WALLET_INSUFFICIENT" || code === "RIDE_CLIENT_INSUFFICIENT_BALANCE" || /solde insuffisant|pas assez de solde/i.test(e instanceof Error ? e.message : "")
      );
    } finally {
      setSubmitting(false);
    }
  };

  const renderField = (target: Target) => {
    const isOrigin = target === "origin";
    const value = isOrigin ? originText : destText;
    return (
      <View style={[styles.field, focus === target && styles.fieldFocused]}>
        <View style={[styles.dot, { backgroundColor: isOrigin ? colors.primary : ERROR_COLOR }]} />
        <TextInput
          ref={!isOrigin ? destInputRef : undefined}
          style={styles.input}
          value={value}
          placeholder={isOrigin ? t("ride.originPh") : t("ride.destPh")}
          placeholderTextColor={colors.outline}
          onFocus={() => {
            setFocus(target);
            // Si c'est "Position sur la carte", on vide le texte pour laisser l'utilisateur taper
            if (value === t("ride.mapPosition")) {
              if (isOrigin) setOriginText("");
              else setDestText("");
            }
          }}
          onChangeText={(text) => {
            if (isOrigin) { originTouched.current = true; setOriginText(text); setOrigin(null); }
            else { setDestText(text); setDestination(null); }
          }}
          returnKeyType="search"
        />
        {focus === target && searching && <ActivityIndicator size="small" color={colors.primary} />}
        {isOrigin && (
          <Pressable onPress={() => { originTouched.current = false; gps.refresh(); }} hitSlop={8} accessibilityLabel={t("ride.myPos")}>
            {gps.status === "loading" ? <ActivityIndicator size="small" color={colors.primary} />
              : <MaterialIcons name="my-location" size={22} color={colors.primary} />}
          </Pressable>
        )}
        <Pressable
          onPress={() => { Keyboard.dismiss(); setFocus(null); setPickTarget(pickTarget === target ? null : target); }}
          hitSlop={8}
          accessibilityLabel={t("ride.pickOnMap")}
        >
          <MaterialIcons name="place" size={22} color={pickTarget === target ? ERROR_COLOR : colors.onSurfaceVariant} />
        </Pressable>
      </View>
    );
  };

  /*
   * Filière voiture — étape 1 : le client choisit sa gamme. Chaque carte montre déjà le tarif
   * (prise en charge, prix au km par palier, exemple) ; ce à quoi il a droit vient à l'écran
   * suivant, avant d'accepter et de continuer.
   */
  if (service === "transport" && !carType && !carDetail) {
    return (
      <ScrollView
        style={styles.zemRoot}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.lg }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.zemHeader, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable style={styles.zemBack} onPress={onBack} accessibilityLabel={t("common.back")}>
            <MaterialIcons name="arrow-back" size={24} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.zemStep}>{t("ride.step")}</Text>
          <Text style={styles.zemTitle}>{t("ride.car.title")}</Text>
          <Text style={styles.zemSubtitle}>{t("ride.car.subtitle")}</Text>
        </View>

        <View style={styles.zemList}>
          {CAR_VEHICLES.map((v) => (
            <VehicleOfferCard
              key={v}
              vehicle={v}
              badges={carBadges(v)}
              hint={t("ride.car.hint")}
              onPress={() => setCarDetail(v)}
            />
          ))}

          <View style={styles.zemNote}>
            <MaterialIcons name="info-outline" size={16} color={colors.onSurfaceVariant} />
            <Text style={styles.zemNoteText}>{t("ride.car.note")}</Text>
          </View>
        </View>
      </ScrollView>
    );
  }

  /*
   * Filière voiture — étape 1 bis : le détail de la gamme choisie (tarif, confort, sécurité).
   * Le client accepte, puis passe à la destination.
   */
  if (service === "transport" && !carType && carDetail) {
    const v = carDetail;
    return (
      <ScrollView
        style={styles.zemRoot}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.lg }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.zemHeader, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable style={styles.zemBack} onPress={() => setCarDetail(null)} accessibilityLabel={t("common.back")}>
            <MaterialIcons name="arrow-back" size={24} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.zemStep}>{t("ride.step")}</Text>
          <View style={styles.carDetailHead}>
            <View style={styles.zemCardIcon}>
              <MaterialIcons name={VEHICLES[v].icon} size={30} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.zemTitle}>{shortName(v)}</Text>
              <View style={styles.zemTitleRow}>
                <OfferBadges badges={carBadges(v)} />
              </View>
              <Text style={styles.zemSubtitle}>{vShort(v)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.zemList}>
          <Text style={styles.sectionLabel}>{t("ride.detail.tariff")}</Text>
          <View style={styles.carPriceCard}>
            <PriceBreakdown vehicle={v} />
          </View>

          <Text style={styles.sectionLabel}>{t("ride.detail.entitled")}</Text>
          <View style={styles.carFeatures}>
            {carEntitlements(v).map((f, i) => (
              <View key={`${v}-${i}`} style={styles.carFeatureRow}>
                <View style={styles.carFeatureIcon}>
                  <MaterialIcons name={f.icon} size={16} color={colors.primary} />
                </View>
                <Text style={styles.carFeatureText}>{f.text}</Text>
              </View>
            ))}
          </View>

          <View style={styles.zemNote}>
            <MaterialIcons name="info-outline" size={16} color={colors.onSurfaceVariant} />
            <Text style={styles.zemNoteText}>{t("ride.detail.note")}</Text>
          </View>

          <Pressable
            style={styles.confirmBtn}
            onPress={() => { setCarType(v); setSelected(v); }}
            accessibilityLabel={t("ride.detail.accept")}
          >
            <Text style={styles.confirmText}>{t("ride.detail.accept")}</Text>
          </Pressable>

          <Pressable style={styles.carBackLink} onPress={() => setCarDetail(null)}>
            <Text style={styles.link}>{t("ride.detail.others")}</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  /*
   * Étape 1 du parcours Speeder : une interface dédiée demande d'abord le type de Speeder
   * (électrique ou essence). La destination, l'estimation et la confirmation viennent
   * ensuite, dans l'écran de réservation habituel.
   */
  if (service === "zem" && !zemType) {
    return (
      <ScrollView
        style={styles.zemRoot}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.lg }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.zemHeader, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable style={styles.zemBack} onPress={onBack} accessibilityLabel={t("common.back")}>
            <MaterialIcons name="arrow-back" size={24} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.zemStep}>{t("ride.step")}</Text>
          <Text style={styles.zemTitle}>{t("ride.zem.title")}</Text>
          <Text style={styles.zemSubtitle}>{t("ride.zem.subtitle")}</Text>
        </View>

        <View style={styles.zemList}>
          {ZEM_VEHICLES.map((v) => (
            <VehicleOfferCard
              key={v}
              vehicle={v}
              badges={v === "ZEM_ELECTRIC" ? [{ icon: "eco", label: t("ride.badge.eco") }] : []}
              onPress={() => { setZemType(v); setSelected(v); }}
            />
          ))}

          <View style={styles.zemNote}>
            <MaterialIcons name="info-outline" size={16} color={colors.onSurfaceVariant} />
            <Text style={styles.zemNoteText}>{zemCommonNote()}</Text>
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={styles.root}>
      <OSMMapView
        center={origin ? { latitude: origin.latitude, longitude: origin.longitude } : undefined}
        onPress={onMapPress}
        polyline={roadRoute?.coordinates ?? []}
        markers={[
          ...(origin ? [{ coordinate: origin, title: t("ride.marker.origin"), color: "green" as const }] : []),
          ...(destination ? [{ coordinate: destination, title: t("ride.marker.dest"), color: "red" as const }] : []),
        ]}
      />

      <Pressable style={[styles.backBtn, { top: insets.top + 8 }]} onPress={onBack} accessibilityLabel={t("common.back")}>
        <MaterialIcons name="arrow-back" size={24} color={colors.onSurface} />
      </Pressable>

      {pickTarget && (
        <View style={[styles.pickHint, { top: insets.top + 8 }]}>
          <Text style={styles.pickHintText}>{pickTarget === "origin" ? t("ride.pickHint.origin") : t("ride.pickHint.destination")}</Text>
        </View>
      )}

      <View
        style={[
          styles.sheet,
          {
            bottom: keyboardHeight, // 👈 Remonte la boîte au-dessus du clavier !
            paddingBottom: keyboardHeight > 0 ? spacing.sm : insets.bottom + spacing.md,
            maxHeight: keyboardHeight > 0 ? "85%" : "68%",
          },
        ]}
      >
        <View style={styles.sheetHandle} />
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.sheetTitle}>{t("ride.sheet.title")}</Text>

          {/* Rappel de l'étape 1 (Speeder ou voiture), modifiable en un clic */}
          {chosenVehicle && (
            <Pressable
              style={styles.zemChip}
              onPress={() => {
                if (service === "zem") setZemType(null);
                else { setCarType(null); setCarDetail(null); }
                setEstimates({});
              }}
              accessibilityLabel={t("ride.changeA11y")}
            >
              <MaterialIcons name={VEHICLES[chosenVehicle].icon} size={18} color={colors.primary} />
              <Text style={styles.zemChipText}>{vLabel(chosenVehicle)}</Text>
              <Text style={styles.zemChipAction}>{t("ride.change")}</Text>
            </Pressable>
          )}

          {(gps.status === "denied" || gps.status === "error") && (
            <View style={styles.banner}>
              <MaterialIcons name="location-off" size={18} color={ERROR_COLOR} />
              <Text style={styles.bannerText}>
                {gps.status === "denied"
                  ? t("ride.locDenied")
                  : gps.error}
              </Text>
              {gps.status === "denied" && !gps.canAskAgain
                ? <Pressable onPress={() => Linking.openSettings()}><Text style={styles.link}>{t("ride.settings")}</Text></Pressable>
                : <Pressable onPress={gps.refresh}><Text style={styles.link}>{t("common.retry")}</Text></Pressable>}
            </View>
          )}

          {renderField("origin")}
          {renderField("destination")}

          {/* Une fois la destination choisie : l'enregistrer comme domicile ou travail */}
          {destination && SAVED_KEYS.some((k) => saved[k]?.title !== destination.title) && (
            <View style={styles.saveRow}>
              <Text style={styles.quickDestLabel}>{t("place.saveAs")}</Text>
              {SAVED_KEYS.filter((k) => saved[k]?.title !== destination.title).map((k) => (
                <Pressable key={k} style={styles.quickDestChip} onPress={() => persistSaved({ ...saved, [k]: destination })}>
                  <MaterialIcons name={k === "home" ? "home" : "work"} size={15} color={colors.primary} />
                  <Text style={styles.quickDestText}>{t(`place.${k}` as MessageKey)}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {!destination && suggestions.length === 0 && (
            <View style={{ marginBottom: 8 }}>
              <Text style={styles.quickDestLabel}>{t("ride.popular")}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.quickDestRow}
              >
                {SAVED_KEYS.filter((k) => saved[k]).map((k) => (
                  <Pressable
                    key={k}
                    style={styles.quickDestChip}
                    onPress={() => applyPlace(focus ?? "destination", saved[k]!)}
                    onLongPress={() => askRemoveSaved(k)}
                  >
                    <MaterialIcons name={k === "home" ? "home" : "work"} size={15} color={colors.primary} />
                    <Text style={styles.quickDestText}>{t(`place.${k}` as MessageKey)}</Text>
                  </Pressable>
                ))}
                {frequent.map((f) => (
                  <Pressable
                    key={`freq-${f.title}`}
                    style={styles.quickDestChip}
                    onPress={() => applyPlace(focus ?? "destination", { title: f.title, latitude: f.latitude, longitude: f.longitude })}
                    accessibilityLabel={t("ride.frequent")}
                  >
                    <MaterialIcons name="history" size={15} color={colors.primary} />
                    <Text style={styles.quickDestText}>{f.title}</Text>
                  </Pressable>
                ))}
                {POPULAR_PLACES.map((p) => (
                  <Pressable
                    key={p.id}
                    style={styles.quickDestChip}
                    onPress={() => applyPlace(focus ?? "destination", p)}
                  >
                    <MaterialIcons name="place" size={15} color={colors.primary} />
                    <Text style={styles.quickDestText}>{p.title}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}

          {focus && searchError && (
            <View style={styles.banner}>
              <MaterialIcons name="wifi-off" size={18} color={ERROR_COLOR} />
              <Text style={styles.bannerText}>{searchError}</Text>
            </View>
          )}
          {focus && noResult && !searching && (
            <Text style={styles.muted}>{t("ride.noResult")}</Text>
          )}

          {focus && suggestions.length > 0 && (
            <View style={styles.suggestions}>
              {suggestions.map((s) => (
                <Pressable key={s.id ?? `${s.latitude},${s.longitude}`} style={styles.suggestion} onPress={() => applyPlace(focus, s)}>
                  <MaterialIcons name="place" size={20} color={colors.onSurfaceVariant} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.suggestionTitle} numberOfLines={1}>{s.title}</Text>
                    {!!s.subtitle && <Text style={styles.suggestionSub} numberOfLines={1}>{s.subtitle}</Text>}
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          {estimating && (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.muted}>{t("ride.calcPrice")}</Text>
            </View>
          )}
          {estimateError && (
            <View style={styles.banner}>
              <Text style={[styles.bannerText, { color: ERROR_COLOR }]}>{estimateError}</Text>
              <Pressable onPress={() => setReloadKey((k) => k + 1)}><Text style={styles.link}>{t("common.retry")}</Text></Pressable>
            </View>
          )}
          {routeLoading && (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.muted}>{t("ride.calcRoute")}</Text>
            </View>
          )}
          {routeError && (
            <View style={styles.banner}>
              <Text style={[styles.bannerText, { color: ERROR_COLOR }]}>{routeError}</Text>
              <Pressable onPress={() => setReloadKey((k) => k + 1)}><Text style={styles.link}>{t("common.retry")}</Text></Pressable>
            </View>
          )}

          {!estimating && Object.keys(estimates).length > 0 && (
            <>
              <Text style={styles.sectionLabel}>
                {service === "zem" ? t("ride.yourZem") : t("ride.yourCar")}
              </Text>
              {options.map((v) => {
                const e = estimates[v];
                if (!e) return null;
                const active = selected === v;
                return (
                  <Pressable key={v} style={[styles.option, active && styles.optionActive]} onPress={() => setSelected(v)}>
                    <MaterialIcons name={VEHICLES[v].icon} size={30} color={active ? colors.primary : colors.onSurfaceVariant} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.optionTitle}>{vLabel(v)}</Text>
                      <Text style={styles.optionSub}>{fmtDuration(e.etaMinutes)} · {fmtKm(e.distanceKm)}</Text>
                    </View>
                    <Text style={styles.optionPrice}>{fcfa(e.price)}</Text>
                  </Pressable>
                );
              })}

              {est?.breakdown && (
                <View style={styles.summary}>
                  <View style={styles.summaryRow}>
                    <View style={styles.summaryCell}>
                      <Text style={styles.summaryLabel}>{t("ride.distance")}</Text>
                      <Text style={styles.summaryValue}>{fmtKm(est.distanceKm)}</Text>
                    </View>
                    <View style={styles.summaryCell}>
                      <Text style={styles.summaryLabel}>{t("ride.duration")}</Text>
                      <Text style={styles.summaryValue}>{fmtDuration(est.durationMin ?? est.etaMinutes)}</Text>
                    </View>
                    <View style={styles.summaryCell}>
                      <Text style={styles.summaryLabel}>{t("ride.price")}</Text>
                      <Text style={[styles.summaryValue, { color: colors.primary }]}>{fcfa(est.price)}</Text>
                    </View>
                  </View>
                  {/* Détail du barème officiel : base (remise éventuelle) + une ligne par palier */}
                  <Text style={styles.summaryDetail}>
                    {[
                      ...(est.breakdown.brackets ?? [])
                        .filter((b) => b.km > 0)
                        .map((b) => `${fmtKm(b.km)} × ${fcfa(b.perKm)}/km`),
                    ].join("  +  ")}
                  </Text>
                </View>
              )}

              <View style={styles.payBox}>
                <MaterialIcons name="account-balance-wallet" size={22} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionTitle}>{t("ride.pay.title")}</Text>
                  <Text style={styles.optionSub}>
                    {balance !== null ? t("ride.pay.subBalance", { balance: fcfa(balance) }) : t("ride.pay.sub")}
                  </Text>
                </View>
              </View>
              {walletInsufficient && (
                <View style={styles.insufficientBalance}>
                  <Text style={styles.errorText}>{t("ride.insufficient")}</Text>
                  <Pressable style={styles.rechargeBtn} onPress={onRecharge}>
                    <Text style={styles.rechargeText}>{t("ride.recharge")}</Text>
                  </Pressable>
                </View>
              )}
            </>
          )}

          {!!destination && (
            <SchedulePicker
              value={scheduledAt}
              onChange={setScheduledAt}
              onModeChange={setScheduleMode}
            />
          )}

          {submitError && (
            <View style={styles.insufficientBalance}>
              <Text style={styles.errorText}>{submitError}</Text>
              {submitNeedsRecharge && (
                <Pressable style={styles.rechargeBtn} onPress={onRecharge}>
                  <Text style={styles.rechargeText}>{t("ride.recharge")}</Text>
                </Pressable>
              )}
            </View>
          )}

          {/* BOUTON D'ACTION PRINCIPAL */}
          <Pressable
            style={[
              styles.confirmBtn,
              (!destination || !canConfirm) && { backgroundColor: colors.surfaceContainerHigh },
            ]}
            disabled={!!destination && !canConfirm}
            onPress={() => {
              if (!destination) {
                // Si aucune destination n'est choisie, on focalise le champ texte !
                setFocus("destination");
                destInputRef.current?.focus();
              } else if (canConfirm) {
                onConfirm();
              }
            }}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={[styles.confirmText, !destination && { color: colors.primary }]}>
                {est ? t(scheduledAt ? "ride.confirmScheduled" : "ride.confirm", { price: fcfa(est.price) }) : t("ride.pickDest")}
              </Text>
            )}
          </Pressable>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  saveRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 8 },
  root: { flex: 1, backgroundColor: colors.background },
  zemRoot: { flex: 1, backgroundColor: colors.background },
  zemHeader: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg, gap: 4 },
  zemBack: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", marginBottom: spacing.sm, elevation: 3, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 6 },
  zemTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800", fontSize: 26 },
  zemSubtitle: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  zemList: { paddingHorizontal: spacing.md, gap: spacing.md },
  zemStep: { ...typography.labelSm, color: colors.primary, letterSpacing: 1 },
  // Carte de choix du Speeder : en-tête (icône, titre, chevron), puis le détail du prix en dessous
  zemCard: { gap: spacing.sm, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, borderWidth: 1.5, borderColor: colors.surfaceContainer, padding: spacing.md, elevation: 2, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8 },
  zemCardPressed: { borderColor: colors.primary, backgroundColor: colors.primaryFixed },
  zemCardTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  zemCardIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center" },
  zemTitleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  zemCardTitle: { ...typography.headlineSm, color: colors.onSurface, flexShrink: 1 },
  zemBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: colors.primaryFixed, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  zemBadgeText: { ...typography.labelSm, color: colors.primary },
  zemCardSub: { ...typography.bodySm, color: colors.onSurfaceVariant, marginTop: 2 },
  zemBaseRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.surfaceContainerLow, borderRadius: radius.md, paddingHorizontal: spacing.sm + 2, paddingVertical: 8, marginTop: spacing.xs },
  zemBaseLabel: { ...typography.labelMd, color: colors.onSurfaceVariant },
  zemBaseValue: { ...typography.labelLg, color: colors.primary },
  zemTiers: { flexDirection: "row", borderWidth: 1, borderColor: colors.surfaceContainer, borderRadius: radius.md, overflow: "hidden" },
  zemTier: { flex: 1, alignItems: "center", paddingVertical: 8, paddingHorizontal: 4, gap: 2 },
  zemTierDivider: { borderRightWidth: 1, borderRightColor: colors.surfaceContainer },
  zemTierLabel: { ...typography.bodySm, color: colors.onSurfaceVariant, fontSize: 11 },
  zemTierPrice: { ...typography.labelMd, color: colors.onSurface },
  zemExample: { ...typography.bodySm, color: colors.onSurfaceVariant },
  zemExampleValue: { ...typography.labelMd, color: colors.primary },
  zemNote: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: colors.surfaceContainer, borderRadius: radius.lg, padding: spacing.sm + 2 },
  zemNoteText: { ...typography.bodySm, color: colors.onSurfaceVariant, flex: 1 },
  carDetailHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  carPriceCard: { gap: spacing.sm, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, borderWidth: 1.5, borderColor: colors.surfaceContainer, padding: spacing.md, marginBottom: spacing.md },
  carFeatures: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, borderWidth: 1.5, borderColor: colors.surfaceContainer, padding: spacing.md, gap: 14, marginBottom: spacing.md },
  carFeatureIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center" },
  carFeatureRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  carFeatureText: { ...typography.bodyMd, color: colors.onSurface, flex: 1 },
  carBackLink: { alignItems: "center", marginTop: spacing.sm, paddingVertical: 8 },
  zemChip: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.primaryFixed, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8, alignSelf: "flex-start" },
  zemChipText: { ...typography.labelMd, color: colors.onSurface, fontWeight: "800" },
  zemChipAction: { ...typography.labelSm, color: colors.primary, fontWeight: "800", textDecorationLine: "underline" },
  backBtn: { position: "absolute", left: spacing.md, width: 44, height: 44, borderRadius: 22, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", elevation: 4, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 6 },
  pickHint: { position: "absolute", left: 72, right: spacing.md, backgroundColor: colors.onSurface, borderRadius: radius.lg, padding: spacing.sm },
  pickHintText: { ...typography.labelMd, color: "#fff", textAlign: "center" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "68%", backgroundColor: colors.surfaceContainerLowest, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: spacing.md, paddingTop: 10, elevation: 12, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 12 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.surfaceContainerHigh, alignSelf: "center", marginBottom: 10 },
  sheetTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800", marginBottom: spacing.sm },
  quickDestLabel: { ...typography.labelSm, color: colors.onSurfaceVariant, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, marginTop: 2 },
  quickDestRow: { gap: 8, paddingBottom: 4 },
  quickDestChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.primaryFixed, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.full },
  quickDestText: { ...typography.labelMd, color: colors.primary, fontWeight: "700", fontSize: 12 },
  field: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surfaceContainer, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: 4, marginBottom: 8, borderWidth: 1, borderColor: "transparent" },
  fieldFocused: { borderColor: colors.primary },
  dot: { width: 10, height: 10, borderRadius: 5 },
  input: { flex: 1, ...typography.bodyMd, color: colors.onSurface, paddingVertical: 12 },
  suggestions: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.surfaceContainer, marginBottom: 8 },
  suggestion: { flexDirection: "row", alignItems: "center", gap: 10, padding: spacing.sm + 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.surfaceContainer },
  suggestionTitle: { ...typography.bodyMd, color: colors.onSurface, fontWeight: "600" },
  suggestionSub: { ...typography.bodySm, color: colors.onSurfaceVariant },
  banner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FDECEA", padding: spacing.sm, borderRadius: radius.lg, marginBottom: 8 },
  bannerText: { ...typography.bodySm, color: ERROR_COLOR, flex: 1 },
  link: { ...typography.labelMd, color: colors.primary, fontWeight: "700" },
  muted: { ...typography.bodySm, color: colors.onSurfaceVariant, textAlign: "center", marginVertical: 8 },
  center: { alignItems: "center", gap: 6, paddingVertical: spacing.md },
  sectionLabel: { ...typography.labelSm, color: colors.onSurfaceVariant, textTransform: "uppercase", letterSpacing: 0.5, marginTop: spacing.md, marginBottom: 8 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.surfaceContainer, marginBottom: 8 },
  optionActive: { borderColor: colors.primary, backgroundColor: colors.primaryFixed },
  optionTitle: { ...typography.bodyMd, color: colors.onSurface, fontWeight: "700" },
  optionSub: { ...typography.bodySm, color: colors.onSurfaceVariant },
  optionPrice: { ...typography.bodyMd, color: colors.onSurface, fontWeight: "800" },
  summary: { backgroundColor: colors.primaryFixed, borderRadius: radius.lg, padding: spacing.md, marginTop: 4, marginBottom: 8 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between" },
  summaryCell: { flex: 1, alignItems: "center" },
  summaryLabel: { ...typography.labelSm, color: colors.onSurfaceVariant, textTransform: "uppercase", letterSpacing: 0.5 },
  summaryValue: { ...typography.bodyMd, color: colors.onSurface, fontWeight: "800", marginTop: 2, textAlign: "center" },
  summaryDetail: { ...typography.bodySm, color: colors.onSurfaceVariant, textAlign: "center", marginTop: 8 },
  payBox: { flexDirection: "row", alignItems: "center", gap: 12, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surfaceContainer, marginTop: 4 },
  errorText: { ...typography.bodySm, color: ERROR_COLOR, marginTop: 8 },
  insufficientBalance: { alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  rechargeBtn: { backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 10 },
  rechargeText: { ...typography.labelMd, color: "#fff", fontWeight: "800" },
  confirmBtn: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, alignItems: "center", marginTop: spacing.md },
  confirmText: { ...typography.labelMd, color: "#fff", fontWeight: "800", fontSize: 16 },
});