import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, TextInput, StyleSheet, Pressable, ScrollView,
  ActivityIndicator, Linking, Keyboard,
  Platform,
} from "react-native";
// Supprime l'ancien import de MapView, UrlTile, Marker
import OSMMapView, { OSMMarker } from "../components/OSMMapView";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { Estimate, Place, VehicleType, errorMessage, placesApi, rideApi, ridesApi, walletApi } from "../services/api";
import {
  CAR_VEHICLES,
  ZEM_VEHICLES,
  refreshTarification,
  ridePrice,
  tarification,
} from "../services/tarification";
import { useCurrentLocation } from "../hooks/useCurrentLocation";

type Props = {
  service: "transport" | "zem";
  onBack: () => void;
  onConfirmed: (rideId: string, destinationLabel: string) => void;
};
type Target = "origin" | "destination";

/**
 * Deux filières bien séparées :
 *   * ZEM_ESSENCE / ZEM_ELECTRIC → les motos-taxis (Zem), choisis à l'étape 1 ;
 *   * GAZELLE / KOALA / LEOPARD  → les voitures proposées pour une course.
 */
const VEHICLES: Record<
  VehicleType,
  { label: string; short: string; icon: keyof typeof MaterialIcons.glyphMap }
> = {
  ZEM_ESSENCE: { label: "Zem à essence", short: "Moto-taxi thermique, partout en ville", icon: "two-wheeler" },
  ZEM_ELECTRIC: { label: "Zem électrique", short: "Moto-taxi électrique, silencieux", icon: "electric-moped" },
  GAZELLE: { label: "Gazelle", short: "Voiture d'entrée de gamme", icon: "directions-car" },
  KOALA: { label: "Koala · climatisé", short: "Voiture climatisée", icon: "directions-car" },
  LEOPARD: { label: "Léopard · premium", short: "Berline haut de gamme", icon: "local-taxi" },
};
const POPULAR_PLACES: Place[] = [
  { id: "etoile", title: "Place de l'Étoile Rouge", subtitle: "Cotonou Centre", latitude: 6.3725, longitude: 2.4061 },
  { id: "dantokpa", title: "Marché Dantokpa", subtitle: "St Michel, Cotonou", latitude: 6.3728, longitude: 2.4339 },
  { id: "aeroport", title: "Aéroport de Cotonou", subtitle: "Cadjèhoun", latitude: 6.3572, longitude: 2.3844 },
  { id: "ganhi", title: "Ganhi Quartier des Affaires", subtitle: "Cotonou", latitude: 6.3556, longitude: 2.4398 },
  { id: "haievive", title: "Les Cocotiers / Haie Vive", subtitle: "Cotonou", latitude: 6.3589, longitude: 2.3976 },
  { id: "calavi", title: "Carrefour IITA Calavi", subtitle: "Abomey-Calavi", latitude: 6.4225, longitude: 2.3397 },
];
const ERROR_COLOR = "#B3261B";
const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

/**
 * Description du tarif Zem, construite depuis la configuration partagée
 * (`config/tarification.json`, synchronisée avec le backend) : aucune valeur en dur.
 */
function zemPricingNote(): string {
  const zem = tarification().vehicles.ZEM_ESSENCE;
  const paliers = zem.brackets
    .map((b, i) => {
      const precedent = i === 0 ? 0 : (zem.brackets[i - 1].upToKm ?? 0);
      const de = precedent === 0 ? 0 : precedent + 1;
      return b.upToKm === null
        ? `${fcfa(b.perKm)}/km à partir du ${de}e km`
        : `${fcfa(b.perKm)}/km de ${de} à ${b.upToKm} km`;
    })
    .join(" · ");
  const remise = zem.baseDiscount
    ? ` — et ${zem.baseDiscount.pct} % de remise sur la base dès que le trajet dépasse ${zem.baseDiscount.aboveKm} km`
    : "";
  return `Les deux Zem ont le même tarif : ${fcfa(zem.base)} de base, puis ${paliers}${remise}.`;
}
const fmtKm = (n: number) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`;
const fmtDuration = (min: number) =>
  min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;

export default function RideBookingScreen({ service, onBack, onConfirmed }: Props) {
  const insets = useSafeAreaInsets();
  const gps = useCurrentLocation();
  const originTouched = useRef(false);
  // Étape 1 du parcours Zem : le client choisit d'abord son type de Zem
  // (électrique ou essence), puis renseigne sa destination.
  const [zemType, setZemType] = useState<VehicleType | null>(null);
  const options = useMemo<VehicleType[]>(
    () => (service === "zem" ? (zemType ? [zemType] : []) : CAR_VEHICLES),
    [service, zemType]
  );

  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [originText, setOriginText] = useState("");
  const [destText, setDestText] = useState("");
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
  const [reloadKey, setReloadKey] = useState(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const [selected, setSelected] = useState<VehicleType>(CAR_VEHICLES[0]);
  const [balance, setBalance] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /* Le véhicule sélectionné suit la filière (Zem choisi, ou voiture par défaut) */
  useEffect(() => {
    if (options.length > 0 && !options.includes(selected)) setSelected(options[0]);
  }, [options, selected]);

  /* Départ = position GPS */
  useEffect(() => {
    if (!gps.coords || originTouched.current) return;
    const title = gps.address ?? "Ma position";
    setOrigin({ title, latitude: gps.coords.latitude, longitude: gps.coords.longitude });
    setOriginText(title);
  }, [gps.coords, gps.address]);

  // Calcul de la distance réelle sur route
function getDirectDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const roadDist = R * c * 1.35; // Facteur 1.35 pour les virages et carrefours réels
  return Math.max(0.5, Math.round(roadDist * 10) / 10);
}

// Prix estimé hors ligne : barème officiel AZƆ̀ partagé avec le backend
// (tarif de base + coût kilométrique par tranche, voir services/tarification.ts).
// Aucun tarif codé en dur ici, et le serveur reste la référence dès qu'il répond.
function getDirectPrice(distanceKm: number, vehicle: VehicleType): number {
  return ridePrice(distanceKm, vehicle);
}

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

  /* Barème officiel : rafraîchi depuis le serveur (GET /pricing), sinon barème embarqué */
  useEffect(() => {
    refreshTarification().catch(() => {});
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
      return;
    }

    setEstimating(true);
    setEstimateError(null);

    // Calcul direct de la distance et du temps
    const dist = getDirectDistanceKm(origin.latitude, origin.longitude, destination.latitude, destination.longitude);
    const eta = Math.max(3, Math.ceil((dist / 25) * 60));

    // Barème local (configuration partagée avec le serveur)
    const localEstimates: Partial<Record<VehicleType, Estimate>> = {};
    options.forEach((v) => {
      localEstimates[v] = {
        distanceKm: dist,
        etaMinutes: eta,
        price: getDirectPrice(dist, v),
      };
    });
    setEstimates(localEstimates);

    // Puis prix officiels calculés par le backend (même barème, source de vérité).
    // En cas d'échec (hors ligne), le calcul local configuré reste affiché.
    let cancelled = false;
    (async () => {
      const serverEstimates: Partial<Record<VehicleType, Estimate>> = { ...localEstimates };
      let gotServerPrice = false;
      for (const v of options) {
        try {
          const res = await ridesApi.estimate({
            originLat: origin.latitude,
            originLng: origin.longitude,
            destLat: destination.latitude,
            destLng: destination.longitude,
            vehicleType: v,
          });
          if (typeof res?.price === "number") {
            serverEstimates[v] = { ...localEstimates[v], ...res };
            gotServerPrice = true;
          }
        } catch {
          // serveur injoignable : on garde le barème local
        }
      }
      if (cancelled) return;
      if (gotServerPrice) setEstimates(serverEstimates);
      setEstimating(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [origin, destination, options, reloadKey]);

  const applyPlace = useCallback((target: Target, place: Place) => {
    if (target === "origin") { originTouched.current = true; setOrigin(place); setOriginText(place.title); }
    else { setDestination(place); setDestText(place.title); }
    setFocus(null);
    setSuggestions([]);
    Keyboard.dismiss();
  }, []);

  const onMapPress = async (data: any) => {
    if (!pickTarget) return;

    // Récupère la latitude et longitude quel que soit le format reçu
    const rawLat = data?.latitude ?? data?.nativeEvent?.coordinate?.latitude;
    const rawLng = data?.longitude ?? data?.nativeEvent?.coordinate?.longitude;

    if (rawLat == null || rawLng == null) return;

    const latitude = Number(rawLat);
    const longitude = Number(rawLng);

    const target = pickTarget;
    setPickTarget(null);
    const provisional: Place = { title: "Position sur la carte", latitude, longitude };
    applyPlace(target, provisional);

    try {
      const r = await placesApi.reverseGeocode(latitude, longitude);
      applyPlace(target, { ...provisional, title: r.address });
    } catch {
      // garde le libellé provisoire si le réseau coupe
    }
  };

  const est = estimates[selected];
  const walletInsufficient = balance !== null && !!est && balance < est.price;
  const canConfirm = !!origin && !!destination && !!est && !estimating && !submitting && !walletInsufficient;

  const onConfirm = async () => {
    if (!origin || !destination || !est) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const ride = await rideApi.create({
        originLat: origin.latitude, originLng: origin.longitude,
        destLat: destination.latitude, destLng: destination.longitude,
        vehicleType: selected,
      });
      onConfirmed(ride.id, destination.title);
    } catch (e) {
      setSubmitError(errorMessage(e));
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
          placeholder={isOrigin ? "Point de départ" : "Où allez-vous ?"}
          placeholderTextColor={colors.outline}
          onFocus={() => {
            setFocus(target);
            // Si c'est "Position sur la carte", on vide le texte pour laisser l'utilisateur taper
            if (value === "Position sur la carte") {
              if (isOrigin) setOriginText("");
              else setDestText("");
            }
          }}
          onChangeText={(t) => {
            if (isOrigin) { originTouched.current = true; setOriginText(t); setOrigin(null); }
            else { setDestText(t); setDestination(null); }
          }}
          returnKeyType="search"
        />
        {focus === target && searching && <ActivityIndicator size="small" color={colors.primary} />}
        {isOrigin && (
          <Pressable onPress={() => { originTouched.current = false; gps.refresh(); }} hitSlop={8} accessibilityLabel="Ma position">
            {gps.status === "loading" ? <ActivityIndicator size="small" color={colors.primary} />
              : <MaterialIcons name="my-location" size={22} color={colors.primary} />}
          </Pressable>
        )}
        <Pressable
          onPress={() => { Keyboard.dismiss(); setFocus(null); setPickTarget(pickTarget === target ? null : target); }}
          hitSlop={8}
          accessibilityLabel="Choisir sur la carte"
        >
          <MaterialIcons name="place" size={22} color={pickTarget === target ? ERROR_COLOR : colors.onSurfaceVariant} />
        </Pressable>
      </View>
    );
  };

  /*
   * Étape 1 du parcours Zem : une interface dédiée demande d'abord le type de Zem
   * (électrique ou essence). La destination, l'estimation et la confirmation viennent
   * ensuite, dans l'écran de réservation habituel.
   */
  if (service === "zem" && !zemType) {
    return (
      <View style={styles.zemRoot}>
        <View style={[styles.zemHeader, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable style={styles.zemBack} onPress={onBack} accessibilityLabel="Retour">
            <MaterialIcons name="arrow-back" size={24} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.zemTitle}>Quel Zem veux-tu ?</Text>
          <Text style={styles.zemSubtitle}>
            Choisis ton type de moto-taxi, puis indique ta destination.
          </Text>
        </View>

        <View style={styles.zemList}>
          {ZEM_VEHICLES.map((v) => (
            <Pressable
              key={v}
              style={styles.zemCard}
              onPress={() => { setZemType(v); setSelected(v); }}
              accessibilityLabel={VEHICLES[v].label}
            >
              <View style={styles.zemCardIcon}>
                <MaterialIcons name={VEHICLES[v].icon} size={34} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.zemCardTitle}>{VEHICLES[v].label}</Text>
                <Text style={styles.zemCardSub}>{VEHICLES[v].short}</Text>
              </View>
              <MaterialIcons name="chevron-right" size={26} color={colors.outline} />
            </Pressable>
          ))}

          <View style={styles.zemNote}>
            <MaterialIcons name="info-outline" size={16} color={colors.onSurfaceVariant} />
            <Text style={styles.zemNoteText}>{zemPricingNote()}</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <OSMMapView
        center={origin ? { latitude: origin.latitude, longitude: origin.longitude } : undefined}
        onPress={(coord) => onMapPress({ nativeEvent: { coordinate: coord } } as any)}
        markers={[
          ...(origin ? [{ coordinate: origin, title: "Départ", color: "green" as const }] : []),
          ...(destination ? [{ coordinate: destination, title: "Destination", color: "red" as const }] : []),
        ]}
      />

      <Pressable style={[styles.backBtn, { top: insets.top + 8 }]} onPress={onBack} accessibilityLabel="Retour">
        <MaterialIcons name="arrow-back" size={24} color={colors.onSurface} />
      </Pressable>

      {pickTarget && (
        <View style={[styles.pickHint, { top: insets.top + 8 }]}>
          <Text style={styles.pickHintText}>Touchez la carte pour choisir {pickTarget === "origin" ? "le départ" : "la destination"}</Text>
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
          <Text style={styles.sheetTitle}>Où allons-nous ?</Text>

          {/* Rappel de l'étape 1 : le type de Zem choisi, modifiable en un clic */}
          {service === "zem" && zemType && (
            <Pressable
              style={styles.zemChip}
              onPress={() => { setZemType(null); setEstimates({}); }}
              accessibilityLabel="Changer de type de Zem"
            >
              <MaterialIcons name={VEHICLES[zemType].icon} size={18} color={colors.primary} />
              <Text style={styles.zemChipText}>{VEHICLES[zemType].label}</Text>
              <Text style={styles.zemChipAction}>Changer</Text>
            </Pressable>
          )}

          {(gps.status === "denied" || gps.status === "error") && (
            <View style={styles.banner}>
              <MaterialIcons name="location-off" size={18} color={ERROR_COLOR} />
              <Text style={styles.bannerText}>
                {gps.status === "denied"
                  ? "Localisation refusée. Saisis ton départ à la main ou autorise l'accès."
                  : gps.error}
              </Text>
              {gps.status === "denied" && !gps.canAskAgain
                ? <Pressable onPress={() => Linking.openSettings()}><Text style={styles.link}>Réglages</Text></Pressable>
                : <Pressable onPress={gps.refresh}><Text style={styles.link}>Réessayer</Text></Pressable>}
            </View>
          )}

          {renderField("origin")}
          {renderField("destination")}

          {!destination && suggestions.length === 0 && (
            <View style={{ marginBottom: 8 }}>
              <Text style={styles.quickDestLabel}>Destinations populaires en 1 clic</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.quickDestRow}
              >
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
            <Text style={styles.muted}>
              Aucun résultat. Essaie un nom plus court (ex : « Cadjehoun ») ou touche le repère pour choisir sur la carte.
            </Text>
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
              <Text style={styles.muted}>Calcul du prix…</Text>
            </View>
          )}
          {estimateError && (
            <View style={styles.banner}>
              <Text style={[styles.bannerText, { color: ERROR_COLOR }]}>{estimateError}</Text>
              <Pressable onPress={() => setReloadKey((k) => k + 1)}><Text style={styles.link}>Réessayer</Text></Pressable>
            </View>
          )}

          {!estimating && Object.keys(estimates).length > 0 && (
            <>
              <Text style={styles.sectionLabel}>
                {service === "zem" ? "Ton Zem" : "Choisis ta voiture"}
              </Text>
              {options.map((v) => {
                const e = estimates[v];
                if (!e) return null;
                const active = selected === v;
                return (
                  <Pressable key={v} style={[styles.option, active && styles.optionActive]} onPress={() => setSelected(v)}>
                    <MaterialIcons name={VEHICLES[v].icon} size={30} color={active ? colors.primary : colors.onSurfaceVariant} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.optionTitle}>{VEHICLES[v].label}</Text>
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
                      <Text style={styles.summaryLabel}>Distance</Text>
                      <Text style={styles.summaryValue}>{fmtKm(est.distanceKm)}</Text>
                    </View>
                    <View style={styles.summaryCell}>
                      <Text style={styles.summaryLabel}>Durée</Text>
                      <Text style={styles.summaryValue}>{fmtDuration(est.durationMin ?? est.etaMinutes)}</Text>
                    </View>
                    <View style={styles.summaryCell}>
                      <Text style={styles.summaryLabel}>Prix</Text>
                      <Text style={[styles.summaryValue, { color: colors.primary }]}>{fcfa(est.price)}</Text>
                    </View>
                  </View>
                  {/* Détail du barème officiel : base (remise éventuelle) + une ligne par palier */}
                  <Text style={styles.summaryDetail}>
                    {[
                      est.breakdown.baseDiscountApplied
                        ? `Base ${fcfa(est.breakdown.baseFull)} − ${est.breakdown.baseDiscountPct} % = ${fcfa(est.breakdown.base)}`
                        : `Base ${fcfa(est.breakdown.base)}`,
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
                  <Text style={styles.optionTitle}>Paiement AZƆ̀ Pay</Text>
                  <Text style={styles.optionSub}>
                    {balance !== null ? `Solde : ${fcfa(balance)} · ` : ""}débité à la fin de la course
                  </Text>
                </View>
              </View>
              {walletInsufficient && (
                <Text style={styles.errorText}>Solde insuffisant. Recharge ton portefeuille pour réserver.</Text>
              )}
            </>
          )}

          {submitError && <Text style={styles.errorText}>{submitError}</Text>}

          {/* BOUTON D'ACTION PRINCIPAL */}
          <Pressable
            style={[styles.confirmBtn, !destination && { backgroundColor: colors.surfaceContainerHigh }]}
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
                {est ? `Confirmer · ${fcfa(est.price)}` : "Choisir une destination"}
              </Text>
            )}
          </Pressable>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  zemRoot: { flex: 1, backgroundColor: colors.background },
  zemHeader: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg, gap: 4 },
  zemBack: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", marginBottom: spacing.sm, elevation: 3, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 6 },
  zemTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800", fontSize: 26 },
  zemSubtitle: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  zemList: { paddingHorizontal: spacing.md, gap: spacing.md },
  zemCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.surfaceContainer, padding: spacing.md, elevation: 2, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8 },
  zemCardIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center" },
  zemCardTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800", fontSize: 18 },
  zemCardSub: { ...typography.bodySm, color: colors.onSurfaceVariant, marginTop: 2 },
  zemNote: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: colors.surfaceContainer, borderRadius: radius.lg, padding: spacing.sm + 2 },
  zemNoteText: { ...typography.bodySm, color: colors.onSurfaceVariant, flex: 1 },
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
  confirmBtn: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 16, alignItems: "center", marginTop: spacing.md },
  confirmText: { ...typography.labelMd, color: "#fff", fontWeight: "800", fontSize: 16 },
});