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
  fullName: string;
  city: string;
  zones: string;
  experienceYears: string;
  vehicleModel: string;
  plateNumber: string;
  agencyName: string;
  plan: AgencyPlanChoice | null;
};

const EMPTY_FORM: Form = {
  type: null,
  vehicleType: null,
  fullName: "",
  city: "",
  zones: "",
  experienceYears: "",
  vehicleModel: "",
  plateNumber: "",
  agencyName: "",
  plan: null,
};

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
  const [expiryDraft, setExpiryDraft] = useState<Record<string, string>>({});
  const [consents, setConsents] = useState({ truth: false, charter: false, geo: false });

  const typeConfig = useMemo(
    () => req?.types.find((t) => t.type === (form.type ?? dossier?.type)) ?? null,
    [req, form.type, dossier?.type]
  );
  const currentType = (form.type ?? dossier?.type ?? null) as ProviderType | null;
  const isAgency = currentType === "AGENCY";

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
          // Brouillon en cours : on reprend exactement là où le candidat s'est arrêté.
          setForm({
            type: existing.type,
            vehicleType: existing.activity.vehicleType,
            fullName: existing.identity.fullName ?? "",
            city: existing.identity.city ?? "",
            zones: existing.identity.zones.join(", "),
            experienceYears: existing.identity.experienceYears != null ? String(existing.identity.experienceYears) : "",
            vehicleModel: existing.activity.vehicleModel ?? "",
            plateNumber: existing.activity.plateNumber ?? "",
            agencyName: existing.activity.agencyName ?? "",
            plan: existing.activity.plan,
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
    return {
      ...(form.type ? { type: form.type } : {}),
      ...(form.fullName.trim() ? { fullName: form.fullName.trim() } : {}),
      ...(form.city.trim() ? { city: form.city.trim() } : {}),
      ...(zones.length ? { zones } : {}),
      ...(form.experienceYears.trim() ? { experienceYears: Number(form.experienceYears) || 0 } : {}),
      ...(form.vehicleType ? { vehicleType: form.vehicleType } : {}),
      ...(form.vehicleModel.trim() ? { vehicleModel: form.vehicleModel.trim() } : {}),
      ...(form.plateNumber.trim() ? { plateNumber: form.plateNumber.trim().toUpperCase() } : {}),
      ...(form.agencyName.trim() ? { agencyName: form.agencyName.trim() } : {}),
      ...(form.plan ? { plan: form.plan } : {}),
    };
  };

  // Sauvegarde le brouillon : rien n'est perdu si l'app est fermée ou si le réseau tombe.
  const saveDraft = useCallback(async () => {
    const saved = await providersApi.save(buildDraft());
    setDossier(saved);
    return saved;
  }, [form]); // eslint-disable-line react-hooks/exhaustive-deps

  function validateStep(index: number): string | null {
    if (index === 0) {
      if (!currentType) return "Choisis ton activité pour continuer.";
      if (!isAgency && !form.vehicleType) return "Choisis le véhicule avec lequel tu vas travailler.";
      return null;
    }
    if (index === 1) {
      if (form.fullName.trim().length < 3) return "Indique ton nom complet, tel qu'il figure sur ta pièce d'identité.";
      if (form.city.trim().length < 2) return "Indique ta ville (Cotonou, Porto-Novo, Abomey-Calavi…).";
      return null;
    }
    if (index === 2) {
      if (isAgency) {
        if (form.agencyName.trim().length < 2) return "Indique la raison sociale de ton agence.";
        if (!form.plan) return "Choisis la formule de ton agence.";
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
      if (step === 0) {
        // Le dossier est créé dès le choix de l'activité : il reçoit un identifiant,
        // nécessaire pour déposer les photos à l'étape suivante.
        if (!dossier) await saveDraft();
        else if (form.type && form.type !== dossier.type) await saveDraft();
        else if (form.vehicleType && form.vehicleType !== dossier?.activity.vehicleType) await saveDraft();
      } else if (step === 1 || step === 2) {
        await saveDraft();
      } else if (step === 3) {
        await saveDraft(); // zones, expérience… au cas où
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
      const res = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.6,
      });
      return res.canceled ? null : res.assets[0];
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Accès à la galerie refusé", "Autorise l'accès aux photos dans les réglages du téléphone.");
      return null;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.6,
    });
    return res.canceled ? null : res.assets[0];
  }

  async function uploadDocument(kind: DocumentKind, mode: "camera" | "library") {
    if (!dossier) {
      Alert.alert("Dossier non enregistré", "Reviens à l'étape 1 et choisis ton activité.");
      return;
    }
    setUploading((s) => ({ ...s, [kind]: true }));
    try {
      const asset = await pickImage(mode);
      if (!asset) return;
      const uri = asset.uri;
      const name = asset.fileName || `${kind.toLowerCase()}-${Date.now()}.jpg`;
      const type = asset.mimeType || (uri.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");
      await providersApi.uploadDocument(dossier.id, kind, { uri, name, type });
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

  // Dossier déjà déposé ou validé : plus rien à éditer ici.
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
              Le choix est définitif après soumission. Les candidatures artisans et coursiers ouvrent
              bientôt.
            </Text>

            {(req?.types ?? []).map((t) => {
              const selected = currentType === t.type;
              return (
                <Pressable
                  key={t.type}
                  style={[styles.card, selected && styles.cardSelected, !t.enabled && styles.cardDisabled]}
                  disabled={!t.enabled}
                  onPress={() => setForm((f) => ({ ...f, type: t.type, vehicleType: f.vehicleType }))}
                >
                  <MaterialIcons
                    name={t.type === "AGENCY" ? "apartment" : t.type === "ARTISAN" ? "build" : "two-wheeler"}
                    size={22}
                    color={selected ? colors.primary : colors.onSurfaceVariant}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{t.label}</Text>
                    <Text style={styles.cardMeta}>{t.description}</Text>
                    {!t.enabled && <Text style={styles.soonText}>Bientôt disponible</Text>}
                  </View>
                  <MaterialIcons
                    name={selected ? "radio-button-checked" : "radio-button-unchecked"}
                    size={20}
                    color={selected ? colors.primary : colors.outline}
                  />
                </Pressable>
              );
            })}

            {/* Zem / Zem électrique / Voiture indépendante */}
            {!isAgency && currentType && (
              <View style={styles.subSection}>
                <Text style={styles.sectionTitle}>Avec quel véhicule vas-tu travailler ?</Text>
                {(typeConfig?.vehicleChoices ?? []).map((v) => {
                  const selected = form.vehicleType === v.value;
                  return (
                    <Pressable
                      key={v.value}
                      style={[styles.choiceRow, selected && styles.choiceRowSelected]}
                      onPress={() => setForm((f) => ({ ...f, vehicleType: v.value }))}
                    >
                      <MaterialIcons
                        name={v.value === "CAR" ? "directions-car" : v.value === "ZEM_ELECTRIC" ? "electric-moped" : "two-wheeler"}
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
            <Text style={styles.title}>Ton identité</Text>
            <Text style={styles.muted}>
              Ces informations doivent correspondre exactement à ta pièce d'identité : elles sont
              vérifiées par un administrateur AZƆ̀.
            </Text>

            <Field
              label="Nom complet (comme sur ta pièce d'identité)"
              value={form.fullName}
              onChangeText={(fullName) => setForm((f) => ({ ...f, fullName }))}
              placeholder="Ex. Rodrigue Ahouandjinou"
              autoCapitalize="words"
              required
            />
            <Field
              label="Ville"
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
              label="Années d'expérience"
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
            <Text style={styles.title}>{isAgency ? "Ton agence" : "Ton véhicule"}</Text>

            {isAgency ? (
              <>
                <Text style={styles.muted}>
                  L'agence est créée à la validation de ton dossier. Les frais d'activation sont
                  indiqués à titre informatif.
                </Text>
                <Field
                  label="Raison sociale"
                  value={form.agencyName}
                  onChangeText={(agencyName) => setForm((f) => ({ ...f, agencyName }))}
                  placeholder="Ex. Transports Sahel & Frères"
                  autoCapitalize="words"
                  required
                />
                <Text style={styles.sectionTitle}>Formule</Text>
                {(req?.plans ?? []).map((p) => {
                  const selected = form.plan === p.plan;
                  return (
                    <Pressable
                      key={p.plan}
                      style={[styles.choiceRow, selected && styles.choiceRowSelected]}
                      onPress={() => setForm((f) => ({ ...f, plan: p.plan }))}
                    >
                      <MaterialIcons name="workspace-premium" size={20} color={selected ? colors.primary : colors.onSurfaceVariant} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.choiceTitle}>{p.label}</Text>
                        <Text style={styles.cardMeta}>
                          {fcfa(p.fee)} à l'activation · {p.maxAccounts} chauffeurs · commission{" "}
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
                  L'immatriculation est comparée à la carte grise que tu fourniras à l'étape suivante.
                </Text>
                <Field
                  label="Modèle du véhicule"
                  value={form.vehicleModel}
                  onChangeText={(vehicleModel) => setForm((f) => ({ ...f, vehicleModel }))}
                  placeholder="Ex. Haojue DK150, Toyota Corolla"
                />
                <Field
                  label="Immatriculation"
                  value={form.plateNumber}
                  onChangeText={(plateNumber) => setForm((f) => ({ ...f, plateNumber }))}
                  placeholder="Ex. AB-1234-CD"
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
              Les photos sont obligatoires : sans image lisible, ton dossier ne peut pas être validé.
              Formats acceptés JPG, PNG, WEBP ou PDF, 8 Mo maximum par pièce.
            </Text>

            {(dossier?.checklist ?? []).map((item) => (
              <DocumentCard
                key={item.kind}
                item={item}
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
              {!isAgency && form.vehicleType && (
                <SummaryRow
                  label="Véhicule"
                  value={typeConfig?.vehicleChoices.find((v) => v.value === form.vehicleType)?.label ?? form.vehicleType}
                />
              )}
              <SummaryRow label="Nom complet" value={form.fullName || "—"} />
              <SummaryRow label="Ville" value={form.city || "—"} />
              {form.zones.trim() ? <SummaryRow label="Zones" value={form.zones} /> : null}
              {isAgency ? (
                <>
                  <SummaryRow label="Agence" value={form.agencyName || "—"} />
                  <SummaryRow
                    label="Formule"
                    value={req?.plans.find((p) => p.plan === form.plan)?.label ?? "—"}
                  />
                  <SummaryRow
                    label="Frais d'activation"
                    value={form.plan ? fcfa(req?.plans.find((p) => p.plan === form.plan)?.fee ?? 0) : "—"}
                  />
                </>
              ) : (
                <>
                  <SummaryRow label="Immatriculation" value={form.plateNumber.toUpperCase() || "—"} />
                  <SummaryRow label="Modèle" value={form.vehicleModel || "—"} />
                </>
              )}
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
                detail="Indispensable pour proposer des courses proches et suivre le trajet."
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
        <Pressable style={[styles.primaryBtn, { flex: 1 }, busy && styles.btnDisabled]} onPress={goNext} disabled={busy}>
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
  busy: boolean;
  showExpiry: boolean;
  expiryDraft: string;
  onExpiryChange: (v: string) => void;
  onSaveExpiry: () => void;
  onCamera: () => void;
  onLibrary: () => void;
}) {
  const { item } = props;
  const badge =
    item.status === "VALID"
      ? { label: "Validée", color: "#146C2E", bg: "#D7F0DC" }
      : item.status === "INVALID"
        ? { label: "Refusée", color: colors.error, bg: colors.errorContainer }
        : item.hasFile
          ? { label: "En attente", color: colors.tertiary, bg: colors.tertiaryFixed }
          : { label: item.photoRequired ? "Photo obligatoire" : "À fournir", color: colors.error, bg: colors.errorContainer };

  return (
    <View style={[styles.docCard, item.photoRequired && !item.hasFile && styles.docCardMissing]}>
      <View style={styles.docHead}>
        {item.hasFile && item.documentId ? (
          <Image source={providersApi.fileSource(item.documentId)} style={styles.thumb} />
        ) : (
          <View style={styles.thumbPlaceholder}>
            <MaterialIcons name="photo-camera" size={22} color={colors.outline} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.docTitle}>
            {item.label}
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
              <Text style={styles.docBtnText}>{item.hasFile ? "Reprendre" : "Prendre une photo"}</Text>
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

function Consent({ checked, onToggle, label, detail }: { checked: boolean; onToggle: () => void; label: string; detail: string }) {
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
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceContainer },
  headerTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  headerSub: { ...typography.labelSm, color: colors.onSurfaceVariant },
  kycBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.primaryFixed, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 5 },
  kycBadgeText: { ...typography.labelSm, color: colors.primary, fontWeight: "700" },
  progressRow: { flexDirection: "row", gap: 6, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  progressDot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.surfaceContainerHigh },
  progressDotActive: { backgroundColor: colors.primary },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: 40 },
  title: { ...typography.headlineMd, color: colors.onSurface, fontWeight: "800" },
  sectionTitle: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
  muted: { ...typography.bodySm, color: colors.onSurfaceVariant, lineHeight: 20 },
  errorText: { ...typography.bodyMd, color: colors.error, textAlign: "center" },
  warnText: { ...typography.labelSm, color: colors.secondary, marginTop: 2 },
  noteText: { ...typography.labelSm, color: colors.error, marginTop: 2 },
  soonText: { ...typography.labelSm, color: colors.outline, marginTop: 2 },
  subSection: { gap: spacing.sm, backgroundColor: colors.surfaceContainerLow, borderRadius: radius.xl, padding: spacing.sm + 2 },

  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, padding: spacing.md, borderWidth: 1.5, borderColor: colors.surfaceContainer },
  cardSelected: { borderColor: colors.primary, backgroundColor: colors.primaryFixed },
  cardDisabled: { opacity: 0.5 },
  cardTitle: { ...typography.bodyMd, color: colors.onSurface, fontWeight: "700" },
  cardMeta: { ...typography.labelSm, color: colors.onSurfaceVariant, marginTop: 2 },

  choiceRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.sm + 2, borderWidth: 1.5, borderColor: colors.surfaceContainer },
  choiceRowSelected: { borderColor: colors.primary },
  choiceTitle: { ...typography.bodySm, color: colors.onSurface, fontWeight: "700" },

  fieldLabel: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  requiredStar: { color: colors.error },
  input: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.surfaceContainer, paddingHorizontal: spacing.md, paddingVertical: 12, ...typography.bodyMd, color: colors.onSurface },

  docCard: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, padding: spacing.md, gap: spacing.sm, borderWidth: 1.5, borderColor: colors.surfaceContainer },
  docCardMissing: { borderColor: colors.error, backgroundColor: "#FFF8F7" },
  docHead: { flexDirection: "row", gap: 12, alignItems: "center" },
  thumb: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceContainer },
  thumbPlaceholder: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceContainerLow, alignItems: "center", justifyContent: "center" },
  docTitle: { ...typography.bodyMd, color: colors.onSurface, fontWeight: "700" },
  badge: { alignSelf: "flex-start", borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 3, marginTop: 4 },
  badgeText: { ...typography.labelSm, fontWeight: "700" },
  docActions: { flexDirection: "row", gap: 8 },
  docBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.primary, paddingHorizontal: 12, paddingVertical: 8 },
  docBtnText: { ...typography.labelSm, color: colors.primary, fontWeight: "700" },
  docBtnGhost: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.outlineVariant, paddingHorizontal: 12, paddingVertical: 8 },
  docBtnGhostText: { ...typography.labelSm, color: colors.onSurfaceVariant, fontWeight: "700" },
  expiryRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  expiryInput: { flex: 1, backgroundColor: colors.surfaceContainerLow, borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 10, ...typography.bodySm, color: colors.onSurface },
  expiryBtn: { backgroundColor: colors.surfaceContainerHigh, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 10 },
  expiryBtnText: { ...typography.labelSm, color: colors.onSurface, fontWeight: "700" },

  summaryCard: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, padding: spacing.md, gap: 2 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.surfaceContainer },
  summaryLabel: { ...typography.labelMd, color: colors.onSurfaceVariant },
  summaryValue: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700", flexShrink: 1, textAlign: "right" },
  consentCard: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, padding: spacing.md, gap: spacing.sm },
  consentRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  consentLabel: { ...typography.bodySm, color: colors.onSurface, fontWeight: "700" },

  footer: { flexDirection: "row", gap: 10, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.outlineVariant, backgroundColor: colors.surfaceContainerLowest },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, paddingHorizontal: 22, alignItems: "center", justifyContent: "center", minWidth: 130 },
  primaryText: { ...typography.labelMd, color: "#fff", fontWeight: "800", fontSize: 15 },
  secondaryBtn: { borderRadius: radius.full, paddingVertical: 14, paddingHorizontal: 20, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: colors.outline },
  secondaryText: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  btnDisabled: { opacity: 0.6 },
});
