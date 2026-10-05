import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import {
  AgencyPlanChoice,
  DocumentKind,
  ProviderApplicationDraft,
  ProviderChecklistItem,
  ProviderDossier,
  ProviderRequirements,
  ProviderType,
  VehicleType,
  errorMessage,
  providersApi,
} from "../services/api";

type Props = {
  onSubmitted: () => void; // -> écran « Dossier en cours »
  onBack: () => void;
  initialType?: ProviderType;
  initialVehicle?: VehicleType;
};

type Form = {
  type: ProviderType | null;
  vehicleType: VehicleType | null;
  categoryId: string;
  fullName: string;
  city: string;
  zones: string;
  experienceYears: string;
  vehicleModel: string;
  plateNumber: string;
  agencyName: string;
  plan: AgencyPlanChoice | null;
  // Champs spécifiques Agence (Bénin)
  representativeLastName: string;
  representativeFirstName: string;
  representativeRole: string;
  representativeNpi: string;
  agencyType: string;
  legalForm: string;
  ifuNumber: string;
  rccmNumber: string;
  headquartersAddress: string;
  businessPhone: string;
  businessEmail: string;
  payoutPhone: string;
  fleetSize: string;
};

const EMPTY_FORM: Form = {
  type: null,
  vehicleType: null,
  categoryId: "LIVREUR_COLIS",
  fullName: "",
  city: "",
  zones: "",
  experienceYears: "",
  vehicleModel: "",
  plateNumber: "",
  agencyName: "",
  plan: null,
  representativeLastName: "",
  representativeFirstName: "",
  representativeRole: "Gérant",
  representativeNpi: "",
  agencyType: "FLOTTE_MIXTE",
  legalForm: "SARL",
  ifuNumber: "",
  rccmNumber: "",
  headquartersAddress: "",
  businessPhone: "",
  businessEmail: "",
  payoutPhone: "",
  fleetSize: "",
};

const DEFAULT_AGENCY_TYPES = [
  {
    id: "FLOTTE_ZEM",
    label: "Agence de Flotte Zem & Moto-Taxi",
    hint: "Gestion de motos-taxis Zem thermiques & électriques",
    icon: "two-wheeler" as const,
  },
  {
    id: "FLOTTE_VOITURE",
    label: "Agence VTC & Transport Voiture",
    hint: "Flotte de berlines climatisées & transport urbain",
    icon: "directions-car" as const,
  },
  {
    id: "FLOTTE_LIVRAISON",
    label: "Agence de Coursiers & Logistique",
    hint: "Flotte de livreurs de colis, coursiers express & personnels",
    icon: "local-shipping" as const,
  },
  {
    id: "FLOTTE_MIXTE",
    label: "Agence Multi-Flotte (Zem + Voitures + Livreurs)",
    hint: "Exploitation complète multi-services sur AZƆ̀",
    icon: "hub" as const,
  },
];

const REPRESENTATIVE_ROLES = [
  "Gérant",
  "Directeur Général",
  "Associé-Gérant",
  "Président / Fondateur",
];

const LEGAL_FORMS = [
  "SARL",
  "SAS / SA",
  "Entreprise Individuelle (EI)",
  "Coopérative / GIE",
];

const DEFAULT_COURIER_SPECIALTIES = [
  { id: "COURSIER_EXPRESS", label: "Coursier express", hint: "Plis urgents, documents et petits paquets" },
  { id: "COURSIER_PERSONNEL", label: "Coursier personnel", hint: "Courses personnelles, marché, pharmacie & achats" },
  { id: "LIVREUR_COLIS", label: "Livreur de colis", hint: "Livraison de colis et marchandises avec double OTP" },
];

const DEFAULT_DRIVER_VEHICLES: { value: VehicleType; label: string; hint: string }[] = [
  { value: "ZEM", label: "Zem indépendant (Moto-taxi)", hint: "Courses rapides en ville — commission 15 %" },
  { value: "ZEM_ELECTRIC", label: "Zem électrique indépendant", hint: "Moto électrique écologique — commission 15 %" },
  { value: "CAR", label: "Voiture — Conducteur indépendant", hint: "Courses confort & climatisées — commission 15 %" },
];

const DEFAULT_COURIER_VEHICLES: { value: VehicleType; label: string; hint: string }[] = [
  { value: "ZEM", label: "Moto / Zem (Coursier & Livreur)", hint: "Plis, courses personnelles et colis en ville" },
  { value: "ZEM_ELECTRIC", label: "Moto électrique (Coursier & Livreur)", hint: "Livraisons rapides & écologiques" },
  { value: "CAR", label: "Voiture / Fourgonnette (Livreur)", hint: "Colis moyens, achats et marchandises" },
];

// Nouvelle grille officielle AZƆ̀ pour les Agences
const DEFAULT_AGENCY_PLANS: {
  plan: AgencyPlanChoice;
  label: string;
  fee: number;
  maxAccounts: number;
  commissionRate: number;
}[] = [
  { plan: "PRO", label: "Agence Pro", fee: 100000, maxAccounts: 10, commissionRate: 0.03 },
  { plan: "ARGENT", label: "Agence Argent", fee: 215500, maxAccounts: 25, commissionRate: 0.025 },
  { plan: "OR", label: "Agence Or", fee: 450500, maxAccounts: 100, commissionRate: 0.02 },
  { plan: "DIAMANT", label: "Agence Diamant", fee: 600500, maxAccounts: 1000, commissionRate: 0.01 },
];

// Pièces dont la date d'expiration a du sens (permis, assurance, visite technique, CNI).
const EXPIRY_KINDS: DocumentKind[] = ["CNI", "PERMIS", "ASSURANCE", "VISITE_TECHNIQUE"];

const STEP_LABELS = ["Activité", "Identité", "Véhicule", "Pièces", "Confirmation"];
const TOTAL_STEPS = STEP_LABELS.length;

const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} F`;

/** "12/03/2030" -> ISO UTC ; renvoie null si la date est invalide. */
function parseFrDate(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const date = new Date(`${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function isoToFr(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

export default function ProviderOnboardingScreen({ onSubmitted, onBack, initialType, initialVehicle }: Props) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [req, setReq] = useState<ProviderRequirements | null>(null);
  const [dossier, setDossier] = useState<ProviderDossier | null>(null);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [localThumbs, setLocalThumbs] = useState<Record<string, string>>({});
  const [expiryDraft, setExpiryDraft] = useState<Record<string, string>>({});
  const [consents, setConsents] = useState({ truth: false, charter: false, geo: false });

  // Liste normalisée des activités : jamais d'ARTISAN, et DRIVER / COURIER / AGENCY toujours ouverts
  const availableTypes = useMemo(() => {
    const raw = (req?.types ?? []).filter((t) => t.type !== "ARTISAN");
    return raw.map((t) => {
      if (t.type === "DRIVER") {
        return {
          ...t,
          enabled: true,
          label: "Zem & Conducteur indépendant",
          description:
            "Zem, Zem indépendant (moto-taxi), Zem électrique ou voiture indépendante : transporte des clients et encaisse sur AZƆ̀ Pay.",
          vehicleChoices: t.vehicleChoices?.length ? t.vehicleChoices : DEFAULT_DRIVER_VEHICLES,
        };
      }
      if (t.type === "COURIER") {
        return {
          ...t,
          enabled: true,
          label: "Coursier, Coursier personnel & Livreur",
          description:
            "Coursier express, coursier personnel (courses, marché, pharmacie) ou livreur de colis avec double code OTP.",
          vehicleChoices: t.vehicleChoices?.length ? t.vehicleChoices : DEFAULT_COURIER_VEHICLES,
          specialties: t.specialties?.length ? t.specialties : DEFAULT_COURIER_SPECIALTIES,
        };
      }
      return {
        ...t,
        enabled: true,
        label: "Agence (Flotte Zem, Voitures & Livreurs)",
      };
    });
  }, [req]);

  const currentType = (form.type ?? dossier?.type ?? null) as ProviderType | null;
  const isAgency = currentType === "AGENCY";
  const isCourier = currentType === "COURIER";

  const typeConfig = useMemo(
    () => availableTypes.find((t) => t.type === currentType) ?? null,
    [availableTypes, currentType]
  );

  /* ----------------------------------------------------------- chargement */

  const refresh = useCallback(async (): Promise<ProviderDossier | null> => {
    const me = await providersApi.me();
    setDossier(me.provider);
    return me.provider;
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [requirements, me] = await Promise.all([providersApi.requirements(), providersApi.me()]);
        if (!alive) return;
        setReq(requirements);
        setDossier(me.provider);

        const existing = me.provider;
        if (existing) {
          const ad = existing.activity.agencyDetails;
          const nameParts = (existing.identity.fullName ?? "").trim().split(/\s+/);
          const defaultFirst = nameParts.length > 1 ? nameParts.slice(0, -1).join(" ") : nameParts[0] || "";
          const defaultLast = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";
          setForm({
            type: existing.type === "ARTISAN" ? "DRIVER" : existing.type,
            vehicleType: existing.activity.vehicleType,
            categoryId: existing.activity.categoryId ?? "LIVREUR_COLIS",
            fullName: existing.identity.fullName ?? "",
            city: existing.identity.city ?? "",
            zones: existing.identity.zones.join(", "),
            experienceYears: existing.identity.experienceYears != null ? String(existing.identity.experienceYears) : "",
            vehicleModel: existing.activity.vehicleModel ?? "",
            plateNumber: existing.activity.plateNumber ?? "",
            agencyName: existing.activity.agencyName ?? "",
            plan: existing.activity.plan,
            representativeFirstName: ad?.representativeFirstName ?? defaultFirst,
            representativeLastName: ad?.representativeLastName ?? defaultLast,
            representativeRole: ad?.representativeRole ?? "Gérant",
            representativeNpi: ad?.representativeNpi ?? "",
            agencyType: ad?.agencyType ?? existing.activity.categoryId ?? "FLOTTE_MIXTE",
            legalForm: ad?.legalForm ?? "SARL",
            ifuNumber: ad?.ifuNumber ?? "",
            rccmNumber: ad?.rccmNumber ?? "",
            headquartersAddress: ad?.headquartersAddress ?? "",
            businessPhone: ad?.businessPhone ?? "",
            businessEmail: ad?.businessEmail ?? "",
            payoutPhone: ad?.payoutPhone ?? "",
            fleetSize: ad?.fleetSize != null ? String(ad.fleetSize) : "",
          });
          const draftStep = existing.status === "DRAFT" ? (existing.identity.fullName ? 2 : 1) : 0;
          setStep(draftStep);
          for (const item of existing.checklist) {
            if (item.expiresAt) setExpiryDraft((s) => ({ ...s, [item.kind]: isoToFr(item.expiresAt) }));
          }
        } else {
          setForm((f) => ({ ...f, type: initialType ?? null, vehicleType: initialVehicle ?? null }));
        }
      } catch (e) {
        if (alive) setLoadError(errorMessage(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [initialType, initialVehicle]);

  /* -------------------------------------------------------------- actions */

  const buildDraft = (): ProviderApplicationDraft => {
    const zones = form.zones
      .split(/[,;]/)
      .map((z) => z.trim())
      .filter(Boolean);
    const composedRepName = `${form.representativeFirstName.trim()} ${form.representativeLastName.trim()}`.trim();
    const effectiveFullName = isAgency
      ? composedRepName || form.fullName.trim()
      : form.fullName.trim();
    return {
      ...(form.type ? { type: form.type } : {}),
      ...(effectiveFullName ? { fullName: effectiveFullName } : {}),
      ...(form.city.trim() ? { city: form.city.trim() } : {}),
      ...(zones.length ? { zones } : {}),
      ...(form.experienceYears.trim() ? { experienceYears: Number(form.experienceYears) || 0 } : {}),
      ...(form.vehicleType ? { vehicleType: form.vehicleType } : {}),
      ...(isCourier && form.categoryId ? { categoryId: form.categoryId } : {}),
      ...(isAgency && form.agencyType ? { categoryId: form.agencyType, agencyType: form.agencyType } : {}),
      ...(form.vehicleModel.trim() ? { vehicleModel: form.vehicleModel.trim() } : {}),
      ...(form.plateNumber.trim() ? { plateNumber: form.plateNumber.trim().toUpperCase() } : {}),
      ...(form.agencyName.trim() ? { agencyName: form.agencyName.trim() } : {}),
      ...(form.plan ? { plan: form.plan } : {}),
      ...(isAgency
        ? {
            representativeFirstName: form.representativeFirstName.trim(),
            representativeLastName: form.representativeLastName.trim(),
            representativeRole: form.representativeRole.trim(),
            representativeNpi: form.representativeNpi.replace(/\D/g, ""),
            legalForm: form.legalForm.trim(),
            ifuNumber: form.ifuNumber.replace(/\D/g, ""),
            rccmNumber: form.rccmNumber.trim().toUpperCase(),
            headquartersAddress: form.headquartersAddress.trim(),
            businessPhone: form.businessPhone.trim(),
            businessEmail: form.businessEmail.trim(),
            payoutPhone: form.payoutPhone.trim(),
            ...(form.fleetSize.trim() ? { fleetSize: Number(form.fleetSize) || 0 } : {}),
          }
        : {}),
    };
  };

  const saveDraft = useCallback(async () => {
    const saved = await providersApi.save(buildDraft());
    setDossier(saved);
    return saved;
  }, [form, isCourier, isAgency]); // eslint-disable-line react-hooks/exhaustive-deps

  function validateStep(index: number): string | null {
    if (index === 0) {
      if (!currentType) return "Choisis ton activité pour continuer.";
      if (!isAgency && !form.vehicleType) return "Choisis le véhicule avec lequel tu vas travailler.";
      if (isAgency && !form.agencyType) return "Choisis le type d'agence (Zem, Voiture, Livraison ou Multi-Flotte).";
      return null;
    }
    if (index === 1) {
      if (isAgency) {
        if (form.representativeLastName.trim().length < 2)
          return "Indique le nom de famille du représentant légal.";
        if (form.representativeFirstName.trim().length < 2)
          return "Indique le(s) prénom(s) du représentant légal.";
        const cleanNpi = form.representativeNpi.replace(/\D/g, "");
        if (cleanNpi.length < 10)
          return "Indique le NPI (Numéro Personnel d'Identification ANIP à 10 chiffres) du représentant légal.";
        if (form.city.trim().length < 2)
          return "Indique la ville d'implantation principale (Cotonou, Abomey-Calavi, Porto-Novo…).";
        return null;
      }
      if (form.fullName.trim().length < 3) return "Indique ton nom complet, tel qu'il figure sur ta pièce d'identité.";
      if (form.city.trim().length < 2) return "Indique ta ville (Cotonou, Porto-Novo, Abomey-Calavi…).";
      return null;
    }
    if (index === 2) {
      if (isAgency) {
        if (form.agencyName.trim().length < 2) return "Indique la raison sociale de ton agence.";
        const cleanIfu = form.ifuNumber.replace(/\D/g, "");
        if (cleanIfu.length < 13)
          return "Indique le numéro IFU de l'entreprise (13 chiffres délivrés par la DGI Bénin).";
        if (form.rccmNumber.trim().length < 4)
          return "Indique le numéro RCCM de l'entreprise (ex. RB/COT/24 B 12345).";
        if (form.headquartersAddress.trim().length < 3)
          return "Indique l'adresse du siège social de l'agence (Quartier, Ilot ou repère).";
        if (!form.plan) return "Choisis la formule officielle AZƆ̀ de ton agence.";
        return null;
      }
      if (form.plateNumber.trim().length < 3) return "Indique l'immatriculation de ton véhicule.";
      return null;
    }
    if (index === 3) {
      const missing = (dossier?.checklist ?? []).filter((c) => c.photoRequired && !c.hasFile);
      if (missing.length > 0)
        return `Photos obligatoires manquantes : ${missing.map((m) => m.label).join(", ")}.`;
      return null;
    }
    return null;
  }

  async function goNext() {
    const problem = validateStep(step);
    if (problem) {
      Alert.alert("Il manque une information", problem);
      return;
    }
    setBusy(true);
    try {
      if (step === 0 || step === 1 || step === 2 || step === 3) {
        await saveDraft();
      } else if (step === 4) {
        if (!consents.truth || !consents.charter || !consents.geo) {
          Alert.alert("Engagements à accepter", "Les trois cases doivent être cochées pour déposer le dossier.");
          return;
        }
        if (!dossier) throw new Error("Dossier introuvable : reprends depuis le début.");
        await providersApi.submit(dossier.id);
        onSubmitted();
        return;
      }
      setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1));
    } catch (e) {
      Alert.alert("Impossible de continuer", errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function goBack() {
    if (step === 0) return onBack();
    setStep((s) => s - 1);
  }

  async function pickImage(mode: "camera" | "library"): Promise<ImagePicker.ImagePickerAsset | null> {
    const pickerOpts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.45,
      base64: true, // Permet l'envoi JSON fiable sur tous les téléphones Android
    };

    if (mode === "camera") {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "Accès à l'appareil photo refusé",
          "AZƆ̀ a besoin de l'appareil photo pour vérifier ton identité. Autorise-le dans les réglages du téléphone.",
          [{ text: "OK" }]
        );
        return null;
      }
      const res = await ImagePicker.launchCameraAsync(pickerOpts);
      return res.canceled ? null : res.assets[0];
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Accès à la galerie refusé", "Autorise l'accès aux photos dans les réglages du téléphone.");
      return null;
    }
    const res = await ImagePicker.launchImageLibraryAsync(pickerOpts);
    return res.canceled ? null : res.assets[0];
  }

  async function uploadDocument(kind: DocumentKind, mode: "camera" | "library") {
    let targetDossier = dossier;
    if (!targetDossier) {
      try {
        targetDossier = await saveDraft();
      } catch (e) {
        Alert.alert("Dossier non enregistré", errorMessage(e));
        return;
      }
    }
    setUploading((s) => ({ ...s, [kind]: true }));
    try {
      const asset = await pickImage(mode);
      if (!asset) return;
      const uri = asset.uri;
      setLocalThumbs((prev) => ({ ...prev, [kind]: uri }));
      const name = asset.fileName || `${kind.toLowerCase()}-${Date.now()}.jpg`;
      const type = asset.mimeType || (uri.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");
      await providersApi.uploadDocument(targetDossier.id, kind, {
        uri,
        name,
        type,
        base64: asset.base64,
      });
      await refresh();
    } catch (e) {
      Alert.alert("Envoi impossible", errorMessage(e));
    } finally {
      setUploading((s) => ({ ...s, [kind]: false }));
    }
  }

  async function saveExpiry(kind: DocumentKind) {
    if (!dossier) return;
    const raw = expiryDraft[kind] ?? "";
    if (!raw.trim()) return;
    const iso = parseFrDate(raw);
    if (!iso) {
      Alert.alert("Date invalide", "Utilise le format JJ/MM/AAAA, par exemple 12/03/2030.");
      return;
    }
    setBusy(true);
    try {
      await providersApi.declareDocument(dossier.id, kind, iso);
      await refresh();
      Alert.alert("Date enregistrée", `Date d'expiration enregistrée (${raw.trim()}).`);
    } catch (e) {
      Alert.alert("Impossible d'enregistrer", errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /* --------------------------------------------------------------- rendu */

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.muted}>Chargement de ton dossier…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}>
          <MaterialIcons name="wifi-off" size={40} color={colors.error} />
          <Text style={styles.errorText}>{loadError}</Text>
          <Pressable style={styles.secondaryBtn} onPress={onBack}>
            <Text style={styles.secondaryText}>Retour</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (dossier && !dossier.editable) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}>
          <MaterialIcons
            name={dossier.status === "APPROVED" ? "verified" : "hourglass-top"}
            size={44}
            color={dossier.status === "APPROVED" ? colors.primary : colors.tertiary}
          />
          <Text style={styles.title}>
            {dossier.status === "APPROVED"
              ? "Ton compte prestataire est déjà actif"
              : dossier.status === "SUSPENDED"
                ? "Ton compte est suspendu"
                : "Ton dossier est déjà déposé"}
          </Text>
          <Text style={styles.muted}>
            {dossier.status === "APPROVED"
              ? "Rien à compléter : ton espace métier est ouvert."
              : dossier.status === "SUSPENDED"
                ? dossier.review.suspensionReason ?? "Contacte le support AZƆ̀."
                : "Suis son avancement depuis l'écran de suivi du dossier."}
          </Text>
          <Pressable style={styles.primaryBtn} onPress={onSubmitted}>
            <Text style={styles.primaryText}>Voir mon dossier</Text>
          </Pressable>
          <Pressable style={styles.secondaryBtn} onPress={onBack}>
            <Text style={styles.secondaryText}>Retour</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const stepLabel = isAgency && step === 2 ? "Agence" : STEP_LABELS[step];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={goBack} style={styles.iconBtn} accessibilityLabel="Retour">
          <MaterialIcons name="arrow-back-ios-new" size={18} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Devenir prestataire AZƆ̀</Text>
          <Text style={styles.headerSub}>
            Étape {step + 1}/{TOTAL_STEPS} · {stepLabel}
          </Text>
        </View>
        <View style={styles.kycBadge}>
          <MaterialIcons name="shield" size={14} color={colors.primary} />
          <Text style={styles.kycBadgeText}>Vérifié</Text>
        </View>
      </View>

      <View style={styles.progressRow}>
        {STEP_LABELS.map((label, i) => (
          <View key={label} style={[styles.progressDot, i <= step && styles.progressDotActive]} />
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* ---------------------------------------------------- 0. Activité */}
        {step === 0 && (
          <View style={{ gap: spacing.md }}>
            <Text style={styles.title}>Que veux-tu faire sur AZƆ̀ ?</Text>
            <Text style={styles.muted}>
              Choisis ton profil professionnel : Zem / Conducteur indépendant, Coursier / Coursier
              personnel / Livreur, ou Agence de flotte.
            </Text>

            {availableTypes.map((t) => {
              const selected = currentType === t.type;
              return (
                <Pressable
                  key={t.type}
                  style={[styles.card, selected && styles.cardSelected]}
                  onPress={() => setForm((f) => ({ ...f, type: t.type, vehicleType: f.vehicleType ?? "ZEM" }))}
                >
                  <View style={[styles.cardIconWrap, selected && styles.cardIconWrapSelected]}>
                    <MaterialIcons
                      name={
                        t.type === "AGENCY"
                          ? "apartment"
                          : t.type === "COURIER"
                            ? "local-shipping"
                            : "two-wheeler"
                      }
                      size={22}
                      color={selected ? colors.primary : colors.onSurfaceVariant}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{t.label}</Text>
                    <Text style={styles.cardMeta}>{t.description}</Text>
                  </View>
                  <MaterialIcons
                    name={selected ? "radio-button-checked" : "radio-button-unchecked"}
                    size={20}
                    color={selected ? colors.primary : colors.outline}
                  />
                </Pressable>
              );
            })}

            {/* Type d'agence à choisir */}
            {isAgency && (
              <View style={styles.subSection}>
                <Text style={styles.sectionTitle}>Quel type d'agence souhaites-tu ouvrir ?</Text>
                {DEFAULT_AGENCY_TYPES.map((at) => {
                  const selected = form.agencyType === at.id;
                  return (
                    <Pressable
                      key={at.id}
                      style={[styles.choiceRow, selected && styles.choiceRowSelected]}
                      onPress={() => setForm((f) => ({ ...f, agencyType: at.id }))}
                    >
                      <MaterialIcons
                        name={at.icon}
                        size={20}
                        color={selected ? colors.primary : colors.onSurfaceVariant}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.choiceTitle}>{at.label}</Text>
                        <Text style={styles.cardMeta}>{at.hint}</Text>
                      </View>
                      {selected && <MaterialIcons name="check-circle" size={20} color={colors.primary} />}
                    </Pressable>
                  );
                })}
              </View>
            )}

            {/* Spécialité Coursier / Coursier personnel / Livreur */}
            {isCourier && (
              <View style={styles.subSection}>
                <Text style={styles.sectionTitle}>Quelle est ta spécialité ?</Text>
                {(typeConfig?.specialties ?? DEFAULT_COURIER_SPECIALTIES).map((sp) => {
                  const selected = form.categoryId === sp.id;
                  return (
                    <Pressable
                      key={sp.id}
                      style={[styles.choiceRow, selected && styles.choiceRowSelected]}
                      onPress={() => setForm((f) => ({ ...f, categoryId: sp.id }))}
                    >
                      <MaterialIcons
                        name={
                          sp.id === "COURSIER_PERSONNEL"
                            ? "shopping-bag"
                            : sp.id === "COURSIER_EXPRESS"
                              ? "bolt"
                              : "inventory-2"
                        }
                        size={20}
                        color={selected ? colors.primary : colors.onSurfaceVariant}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.choiceTitle}>{sp.label}</Text>
                        <Text style={styles.cardMeta}>{sp.hint}</Text>
                      </View>
                      {selected && <MaterialIcons name="check-circle" size={20} color={colors.primary} />}
                    </Pressable>
                  );
                })}
              </View>
            )}

            {/* Zem / Zem indépendant / Moto / Voiture */}
            {!isAgency && currentType && (
              <View style={styles.subSection}>
                <Text style={styles.sectionTitle}>Avec quel véhicule vas-tu travailler ?</Text>
                {(typeConfig?.vehicleChoices ?? DEFAULT_DRIVER_VEHICLES).map((v) => {
                  const selected = form.vehicleType === v.value;
                  return (
                    <Pressable
                      key={v.value}
                      style={[styles.choiceRow, selected && styles.choiceRowSelected]}
                      onPress={() => setForm((f) => ({ ...f, vehicleType: v.value }))}
                    >
                      <MaterialIcons
                        name={
                          v.value === "CAR"
                            ? "directions-car"
                            : v.value === "ZEM_ELECTRIC"
                              ? "electric-moped"
                              : "two-wheeler"
                        }
                        size={20}
                        color={selected ? colors.primary : colors.onSurfaceVariant}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.choiceTitle}>{v.label}</Text>
                        <Text style={styles.cardMeta}>{v.hint}</Text>
                      </View>
                      {selected && <MaterialIcons name="check-circle" size={20} color={colors.primary} />}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* ---------------------------------------------------- 1. Identité */}
        {step === 1 && (
          <View style={{ gap: spacing.md }}>
            <Text style={styles.title}>
              {isAgency ? "Identité du représentant légal" : "Ton identité"}
            </Text>
            <Text style={styles.muted}>
              {isAgency
                ? "Renseigne l'identité exacte du Gérant ou Directeur Général de l'agence telle qu'elle figure sur son CIP / sa pièce d'identité biométrique ANIP."
                : "Ces informations doivent correspondre exactement à ta pièce d'identité : elles sont vérifiées par un administrateur AZƆ̀."}
            </Text>

            {isAgency ? (
              <>
                <View style={styles.twoColRow}>
                  <View style={{ flex: 1 }}>
                    <Field
                      label="Nom de famille du représentant"
                      value={form.representativeLastName}
                      onChangeText={(representativeLastName) =>
                        setForm((f) => ({ ...f, representativeLastName }))
                      }
                      placeholder="Ex. SOGLO"
                      autoCapitalize="characters"
                      required
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field
                      label="Prénom(s) du représentant"
                      value={form.representativeFirstName}
                      onChangeText={(representativeFirstName) =>
                        setForm((f) => ({ ...f, representativeFirstName }))
                      }
                      placeholder="Ex. Thierry Koffi"
                      autoCapitalize="words"
                      required
                    />
                  </View>
                </View>

                <View style={{ gap: 6 }}>
                  <Text style={styles.fieldLabel}>Fonction dans l'entreprise</Text>
                  <View style={styles.chipRow}>
                    {REPRESENTATIVE_ROLES.map((role) => {
                      const active = form.representativeRole === role;
                      return (
                        <Pressable
                          key={role}
                          style={[styles.roleChip, active && styles.roleChipActive]}
                          onPress={() => setForm((f) => ({ ...f, representativeRole: role }))}
                        >
                          <Text style={[styles.roleChipText, active && styles.roleChipTextActive]}>
                            {role}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <Field
                  label="NPI du représentant (ANIP Bénin — 10 chiffres)"
                  value={form.representativeNpi}
                  onChangeText={(v) =>
                    setForm((f) => ({ ...f, representativeNpi: v.replace(/\D/g, "").slice(0, 12) }))
                  }
                  placeholder="Ex. 1094827361"
                  keyboardType="number-pad"
                  maxLength={12}
                  required
                />
              </>
            ) : (
              <Field
                label="Nom complet (comme sur ta pièce d'identité)"
                value={form.fullName}
                onChangeText={(fullName) => setForm((f) => ({ ...f, fullName }))}
                placeholder="Ex. Rodrigue Ahouandjinou"
                autoCapitalize="words"
                required
              />
            )}

            <Field
              label={isAgency ? "Ville d'implantation principale" : "Ville"}
              value={form.city}
              onChangeText={(city) => setForm((f) => ({ ...f, city }))}
              placeholder="Ex. Cotonou"
              autoCapitalize="words"
              required
            />
            <Field
              label="Zones desservies (séparées par des virgules)"
              value={form.zones}
              onChangeText={(zones) => setForm((f) => ({ ...f, zones }))}
              placeholder="Ex. Fidjrossè, Cadjèhoun, Haie Vive"
            />
            <Field
              label={isAgency ? "Années d'existence / expérience flotte" : "Années d'expérience"}
              value={form.experienceYears}
              onChangeText={(experienceYears) => setForm((f) => ({ ...f, experienceYears }))}
              placeholder="Ex. 3"
              keyboardType="number-pad"
              maxLength={2}
            />
          </View>
        )}

        {/* --------------------------------------- 2. Véhicule / Agence */}
        {step === 2 && (
          <View style={{ gap: spacing.md }}>
            <Text style={styles.title}>
              {isAgency ? "Informations légales & Flotte" : "Ton véhicule"}
            </Text>

            {isAgency ? (
              <>
                <Text style={styles.muted}>
                  Renseigne les identifiants officiels de ton entreprise au Bénin (IFU DGI, RCCM GUFE) ainsi que le compte Mobile Money de reversement de l'agence.
                </Text>
                <Field
                  label="Raison sociale / Nom commercial de l'agence"
                  value={form.agencyName}
                  onChangeText={(agencyName) => setForm((f) => ({ ...f, agencyName }))}
                  placeholder="Ex. Cotonou Flotte Express SARL"
                  autoCapitalize="words"
                  required
                />

                <View style={{ gap: 6 }}>
                  <Text style={styles.fieldLabel}>Forme juridique</Text>
                  <View style={styles.chipRow}>
                    {LEGAL_FORMS.map((lf) => {
                      const active = form.legalForm === lf;
                      return (
                        <Pressable
                          key={lf}
                          style={[styles.roleChip, active && styles.roleChipActive]}
                          onPress={() => setForm((f) => ({ ...f, legalForm: lf }))}
                        >
                          <Text style={[styles.roleChipText, active && styles.roleChipTextActive]}>
                            {lf}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <Field
                  label="N° IFU de l'entreprise (13 chiffres — DGI Bénin)"
                  value={form.ifuNumber}
                  onChangeText={(v) =>
                    setForm((f) => ({ ...f, ifuNumber: v.replace(/\D/g, "").slice(0, 13) }))
                  }
                  placeholder="Ex. 3202410894512"
                  keyboardType="number-pad"
                  maxLength={13}
                  required
                />

                <Field
                  label="N° RCCM (Registre du Commerce et du Crédit Mobilier)"
                  value={form.rccmNumber}
                  onChangeText={(rccmNumber) => setForm((f) => ({ ...f, rccmNumber }))}
                  placeholder="Ex. RB/COT/24 B 12345"
                  autoCapitalize="characters"
                  required
                />

                <Field
                  label="Adresse du siège social (Quartier, Ilot / Repère)"
                  value={form.headquartersAddress}
                  onChangeText={(headquartersAddress) =>
                    setForm((f) => ({ ...f, headquartersAddress }))
                  }
                  placeholder="Ex. Cotonou, Quartier Ganhi, Ilot 412, Immeuble Marina"
                  required
                />

                <View style={styles.twoColRow}>
                  <View style={{ flex: 1 }}>
                    <Field
                      label="Téléphone pro (01...)"
                      value={form.businessPhone}
                      onChangeText={(businessPhone) => setForm((f) => ({ ...f, businessPhone }))}
                      placeholder="Ex. 01 XX XX XX XX"
                      keyboardType="number-pad"
                      maxLength={14}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field
                      label="Taille du parc (véhicules)"
                      value={form.fleetSize}
                      onChangeText={(v) =>
                        setForm((f) => ({ ...f, fleetSize: v.replace(/\D/g, "").slice(0, 4) }))
                      }
                      placeholder="Ex. 15"
                      keyboardType="number-pad"
                      maxLength={4}
                    />
                  </View>
                </View>

                <Field
                  label="Email professionnel de l'agence"
                  value={form.businessEmail}
                  onChangeText={(businessEmail) => setForm((f) => ({ ...f, businessEmail }))}
                  placeholder="Ex. direction@cotonouflotte.bj"
                  autoCapitalize="none"
                />

                <Field
                  label="Compte Mobile Money Entreprise (Reversements MTN / Moov — 01...)"
                  value={form.payoutPhone}
                  onChangeText={(payoutPhone) => setForm((f) => ({ ...f, payoutPhone }))}
                  placeholder="Ex. 01 XX XX XX XX"
                  keyboardType="number-pad"
                  maxLength={14}
                />

                <Text style={styles.sectionTitle}>Formule officielle AZƆ̀</Text>
                {(req?.plans?.length ? req.plans : DEFAULT_AGENCY_PLANS).map((p) => {
                  const selected = form.plan === p.plan;
                  return (
                    <Pressable
                      key={p.plan}
                      style={[styles.choiceRow, selected && styles.choiceRowSelected]}
                      onPress={() => setForm((f) => ({ ...f, plan: p.plan }))}
                    >
                      <MaterialIcons
                        name="workspace-premium"
                        size={20}
                        color={selected ? colors.primary : colors.onSurfaceVariant}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.choiceTitle}>{p.label.toUpperCase()}</Text>
                        <Text style={styles.cardMeta}>
                          Activation unique : {fcfa(p.fee)} · Jusqu'à {p.maxAccounts.toLocaleString("fr-FR")} comptes · Commission :{" "}
                          {(p.commissionRate * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %
                        </Text>
                      </View>
                      {selected && <MaterialIcons name="check-circle" size={20} color={colors.primary} />}
                    </Pressable>
                  );
                })}
              </>
            ) : (
              <>
                <Text style={styles.muted}>
                  L'immatriculation est comparée à la carte grise / photo du véhicule que tu fourniras
                  à l'étape suivante.
                </Text>
                <Field
                  label="Modèle du véhicule / de la moto"
                  value={form.vehicleModel}
                  onChangeText={(vehicleModel) => setForm((f) => ({ ...f, vehicleModel }))}
                  placeholder="Ex. Haojue DK150, Bajaj Boxer, Toyota Corolla"
                />
                <Field
                  label="Immatriculation"
                  value={form.plateNumber}
                  onChangeText={(plateNumber) => setForm((f) => ({ ...f, plateNumber }))}
                  placeholder="Ex. AB-1234-RB"
                  autoCapitalize="characters"
                  required
                />
              </>
            )}
          </View>
        )}

        {/* ---------------------------------------------------- 3. Pièces */}
        {step === 3 && (
          <View style={{ gap: spacing.md }}>
            <Text style={styles.title}>Tes pièces justificatives</Text>
            <Text style={styles.muted}>
              Le selfie et la pièce d'identité sont obligatoires en photo. Assure-toi que le texte
              est bien lisible avant d'envoyer.
            </Text>

            {(dossier?.checklist ?? []).map((item) => (
              <DocumentCard
                key={item.kind}
                item={item}
                localUri={localThumbs[item.kind]}
                busy={!!uploading[item.kind]}
                expiryDraft={expiryDraft[item.kind] ?? ""}
                showExpiry={EXPIRY_KINDS.includes(item.kind)}
                onExpiryChange={(v) => setExpiryDraft((s) => ({ ...s, [item.kind]: v }))}
                onSaveExpiry={() => saveExpiry(item.kind)}
                onCamera={() => uploadDocument(item.kind, "camera")}
                onLibrary={() => uploadDocument(item.kind, "library")}
              />
            ))}
          </View>
        )}

        {/* ---------------------------------------------- 4. Confirmation */}
        {step === 4 && (
          <View style={{ gap: spacing.md }}>
            <Text style={styles.title}>Vérifie et dépose ton dossier</Text>

            <View style={styles.summaryCard}>
              <SummaryRow label="Activité" value={typeConfig?.label ?? dossier?.typeLabel ?? "—"} />
              {isAgency && (
                <SummaryRow
                  label="Type d'agence"
                  value={
                    DEFAULT_AGENCY_TYPES.find((at) => at.id === form.agencyType)?.label ??
                    form.agencyType
                  }
                />
              )}
              {isCourier && (
                <SummaryRow
                  label="Spécialité"
                  value={
                    DEFAULT_COURIER_SPECIALTIES.find((s) => s.id === form.categoryId)?.label ??
                    form.categoryId
                  }
                />
              )}
              {!isAgency && form.vehicleType && (
                <SummaryRow
                  label="Véhicule"
                  value={
                    typeConfig?.vehicleChoices.find((v) => v.value === form.vehicleType)?.label ??
                    form.vehicleType
                  }
                />
              )}
              {isAgency ? (
                <>
                  <SummaryRow
                    label="Représentant légal"
                    value={
                      `${form.representativeFirstName} ${form.representativeLastName}`.trim() ||
                      form.fullName ||
                      "—"
                    }
                  />
                  <SummaryRow label="Fonction" value={form.representativeRole || "Gérant"} />
                  <SummaryRow label="NPI Représentant" value={form.representativeNpi || "—"} />
                  <SummaryRow label="Raison sociale" value={form.agencyName || "—"} />
                  <SummaryRow label="Forme juridique" value={form.legalForm || "SARL"} />
                  <SummaryRow label="N° IFU (DGI)" value={form.ifuNumber || "—"} />
                  <SummaryRow label="N° RCCM" value={form.rccmNumber || "—"} />
                  <SummaryRow label="Siège social" value={form.headquartersAddress || "—"} />
                  {form.businessPhone.trim() ? (
                    <SummaryRow label="Téléphone pro" value={form.businessPhone} />
                  ) : null}
                  {form.businessEmail.trim() ? (
                    <SummaryRow label="Email pro" value={form.businessEmail} />
                  ) : null}
                  {form.payoutPhone.trim() ? (
                    <SummaryRow label="Reversements MoMo" value={form.payoutPhone} />
                  ) : null}
                  {form.fleetSize.trim() ? (
                    <SummaryRow label="Taille du parc" value={`${form.fleetSize} véhicules`} />
                  ) : null}
                  <SummaryRow
                    label="Formule"
                    value={
                      (req?.plans?.length ? req.plans : DEFAULT_AGENCY_PLANS).find(
                        (p) => p.plan === form.plan
                      )?.label ?? "—"
                    }
                  />
                  <SummaryRow
                    label="Activation unique"
                    value={
                      form.plan
                        ? fcfa(
                            (req?.plans?.length ? req.plans : DEFAULT_AGENCY_PLANS).find(
                              (p) => p.plan === form.plan
                            )?.fee ?? 0
                          )
                        : "—"
                    }
                  />
                </>
              ) : (
                <>
                  <SummaryRow label="Nom complet" value={form.fullName || "—"} />
                  <SummaryRow label="Immatriculation" value={form.plateNumber.toUpperCase() || "—"} />
                  <SummaryRow label="Modèle" value={form.vehicleModel || "—"} />
                </>
              )}
              <SummaryRow label="Ville" value={form.city || "—"} />
              {form.zones.trim() ? <SummaryRow label="Zones" value={form.zones} /> : null}
              <SummaryRow
                label="Pièces fournies"
                value={`${(dossier?.checklist ?? []).filter((c) => c.hasFile).length}/${
                  (dossier?.checklist ?? []).filter((c) => c.required).length
                } obligatoires`}
              />
            </View>

            <View style={styles.consentCard}>
              <Consent
                checked={consents.truth}
                onToggle={() => setConsents((c) => ({ ...c, truth: !c.truth }))}
                label="Je certifie que ces informations sont exactes."
                detail="Toute fausse déclaration entraîne la suspension du compte."
              />
              <Consent
                checked={consents.charter}
                onToggle={() => setConsents((c) => ({ ...c, charter: !c.charter }))}
                label="J'accepte la charte AZƆ̀."
                detail="Comportement, sécurité, tarifs affichés, respect des clients."
              />
              <Consent
                checked={consents.geo}
                onToggle={() => setConsents((c) => ({ ...c, geo: !c.geo }))}
                label="J'autorise la géolocalisation pendant mes missions."
                detail="Indispensable pour proposer des courses/livraisons proches et suivre le trajet."
              />
            </View>

            <Text style={styles.muted}>
              Après le dépôt, un administrateur AZƆ̀ examine ton dossier et répond sous{" "}
              {req?.review.slaHours ?? 48} h. Tu peux continuer à utiliser l'app comme client pendant
              ce temps.
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.secondaryBtn} onPress={goBack} disabled={busy}>
          <Text style={styles.secondaryText}>{step === 0 ? "Quitter" : "Précédent"}</Text>
        </Pressable>
        <Pressable
          style={[styles.primaryBtn, { flex: 1 }, busy && styles.btnDisabled]}
          onPress={goNext}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryText}>
              {step === TOTAL_STEPS - 1 ? "Déposer mon dossier" : "Continuer"}
            </Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sous-composants                                                            */
/* -------------------------------------------------------------------------- */

function Field(props: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "number-pad";
  autoCapitalize?: "none" | "words" | "characters" | "sentences";
  maxLength?: number;
  required?: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.fieldLabel}>
        {props.label}
        {props.required ? <Text style={styles.requiredStar}> *</Text> : null}
      </Text>
      <TextInput
        style={styles.input}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={colors.outline}
        keyboardType={props.keyboardType ?? "default"}
        autoCapitalize={props.autoCapitalize ?? "sentences"}
        maxLength={props.maxLength}
      />
    </View>
  );
}

function DocumentCard(props: {
  item: ProviderChecklistItem;
  localUri?: string;
  busy: boolean;
  showExpiry: boolean;
  expiryDraft: string;
  onExpiryChange: (v: string) => void;
  onSaveExpiry: () => void;
  onCamera: () => void;
  onLibrary: () => void;
}) {
  const { item, localUri } = props;
  const badge =
    item.status === "VALID"
      ? { label: "Validée", color: "#146C2E", bg: "#D7F0DC" }
      : item.status === "INVALID"
        ? { label: "Refusée", color: colors.error, bg: colors.errorContainer }
        : item.hasFile || localUri
          ? { label: "Photo enregistrée", color: "#146C2E", bg: "#D7F0DC" }
          : {
              label: item.photoRequired ? "Photo obligatoire" : "À fournir",
              color: colors.error,
              bg: colors.errorContainer,
            };

  const imgSource = localUri
    ? { uri: localUri }
    : item.hasFile && item.documentId
      ? providersApi.fileSource(item.documentId)
      : null;

  return (
    <View style={[styles.docCard, item.photoRequired && !item.hasFile && !localUri && styles.docCardMissing]}>
      <View style={styles.docHead}>
        {imgSource ? (
          <Image source={imgSource} style={styles.thumb} />
        ) : (
          <View style={styles.thumbPlaceholder}>
            <MaterialIcons name="photo-camera" size={22} color={colors.outline} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.docTitle}>
            {item.label.charAt(0).toUpperCase() + item.label.slice(1)}
            {item.required ? <Text style={styles.requiredStar}> *</Text> : null}
          </Text>
          <View style={[styles.badge, { backgroundColor: badge.bg }]}>
            <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
          </View>
          {item.expired && <Text style={styles.warnText}>Expirée — à remplacer</Text>}
          {item.expiresSoon && !item.expired && <Text style={styles.warnText}>Expire dans moins de 30 jours</Text>}
          {!!item.note && <Text style={styles.noteText}>Note : {item.note}</Text>}
        </View>
      </View>

      <View style={styles.docActions}>
        <Pressable style={styles.docBtn} onPress={props.onCamera} disabled={props.busy}>
          {props.busy ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <>
              <MaterialIcons name="photo-camera" size={16} color={colors.primary} />
              <Text style={styles.docBtnText}>{item.hasFile || localUri ? "Reprendre" : "Prendre une photo"}</Text>
            </>
          )}
        </Pressable>
        <Pressable style={styles.docBtnGhost} onPress={props.onLibrary} disabled={props.busy}>
          <MaterialIcons name="collections" size={16} color={colors.onSurfaceVariant} />
          <Text style={styles.docBtnGhostText}>Galerie</Text>
        </Pressable>
      </View>

      {props.showExpiry && (
        <View style={styles.expiryRow}>
          <TextInput
            style={styles.expiryInput}
            value={props.expiryDraft}
            onChangeText={props.onExpiryChange}
            placeholder="Expiration JJ/MM/AAAA"
            placeholderTextColor={colors.outline}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
          <Pressable style={styles.expiryBtn} onPress={props.onSaveExpiry}>
            <Text style={styles.expiryBtnText}>Enregistrer</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function Consent({
  checked,
  onToggle,
  label,
  detail,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  detail: string;
}) {
  return (
    <Pressable style={styles.consentRow} onPress={onToggle}>
      <MaterialIcons
        name={checked ? "check-box" : "check-box-outline-blank"}
        size={22}
        color={checked ? colors.primary : colors.outline}
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.consentLabel}>{label}</Text>
        <Text style={styles.cardMeta}>{detail}</Text>
      </View>
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: spacing.lg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceContainer,
  },
  headerTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  headerSub: { ...typography.labelSm, color: colors.onSurfaceVariant },
  kycBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.primaryFixed,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  kycBadgeText: { ...typography.labelSm, color: colors.primary, fontWeight: "700" },
  progressRow: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  progressDot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.surfaceContainerHigh },
  progressDotActive: { backgroundColor: colors.primary },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: 100 },
  title: { ...typography.headlineMd, color: colors.onSurface, fontWeight: "800" },
  sectionTitle: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
  muted: { ...typography.bodySm, color: colors.onSurfaceVariant, lineHeight: 20 },
  errorText: { ...typography.bodyMd, color: colors.error, textAlign: "center" },
  warnText: { ...typography.labelSm, color: colors.secondary, marginTop: 2 },
  noteText: { ...typography.labelSm, color: colors.error, marginTop: 2 },
  subSection: {
    gap: spacing.sm,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.xl,
    padding: spacing.sm + 2,
  },

  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    padding: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.surfaceContainer,
  },
  cardSelected: { borderColor: colors.primary, backgroundColor: colors.primaryFixed },
  cardIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: "center",
    justifyContent: "center",
  },
  cardIconWrapSelected: {
    backgroundColor: colors.surfaceContainerLowest,
  },
  cardTitle: { ...typography.bodyMd, color: colors.onSurface, fontWeight: "700" },
  cardMeta: { ...typography.labelSm, color: colors.onSurfaceVariant, marginTop: 2, lineHeight: 17 },

  choiceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.sm + 2,
    borderWidth: 1.5,
    borderColor: colors.surfaceContainer,
  },
  choiceRowSelected: { borderColor: colors.primary },
  choiceTitle: { ...typography.bodySm, color: colors.onSurface, fontWeight: "700" },

  fieldLabel: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  requiredStar: { color: colors.error },
  twoColRow: {
    flexDirection: "row",
    gap: 10,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  roleChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1.5,
    borderColor: colors.surfaceContainer,
  },
  roleChipActive: {
    backgroundColor: colors.primaryFixed,
    borderColor: colors.primary,
  },
  roleChipText: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
    fontWeight: "600",
  },
  roleChipTextActive: {
    color: colors.primary,
    fontWeight: "700",
  },
  input: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.surfaceContainer,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    ...typography.bodyMd,
    color: colors.onSurface,
  },

  docCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.surfaceContainer,
  },
  docCardMissing: { borderColor: colors.error, backgroundColor: "#FFF8F7" },
  docHead: { flexDirection: "row", gap: 12, alignItems: "center" },
  thumb: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceContainer },
  thumbPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: "center",
    justifyContent: "center",
  },
  docTitle: { ...typography.bodyMd, color: colors.onSurface, fontWeight: "700" },
  badge: {
    alignSelf: "flex-start",
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 4,
  },
  badgeText: { ...typography.labelSm, fontWeight: "700" },
  docActions: { flexDirection: "row", gap: 8 },
  docBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 40,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.primary,
    paddingHorizontal: 14,
  },
  docBtnText: { ...typography.labelSm, color: colors.primary, fontWeight: "700" },
  docBtnGhost: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 40,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.outlineVariant,
    paddingHorizontal: 14,
  },
  docBtnGhostText: { ...typography.labelSm, color: colors.onSurfaceVariant, fontWeight: "700" },
  expiryRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  expiryInput: {
    flex: 1,
    height: 40,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    ...typography.bodySm,
    color: colors.onSurface,
  },
  expiryBtn: {
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radius.full,
    paddingHorizontal: 16,
  },
  expiryBtnText: { ...typography.labelSm, color: colors.onSurface, fontWeight: "700" },

  summaryCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: 2,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.surfaceContainer,
  },
  summaryLabel: { ...typography.labelMd, color: colors.onSurfaceVariant },
  summaryValue: {
    ...typography.labelMd,
    color: colors.onSurface,
    fontWeight: "700",
    flexShrink: 1,
    textAlign: "right",
  },
  consentCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.sm,
  },
  consentRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  consentLabel: { ...typography.bodySm, color: colors.onSurface, fontWeight: "700" },

  footer: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.outlineVariant,
    backgroundColor: colors.surfaceContainerLowest,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingVertical: 14,
    paddingHorizontal: 22,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 130,
  },
  primaryText: { ...typography.labelMd, color: "#fff", fontWeight: "800", fontSize: 15 },
  secondaryBtn: {
    borderRadius: radius.full,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.outline,
  },
  secondaryText: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  btnDisabled: { opacity: 0.6 },
});
