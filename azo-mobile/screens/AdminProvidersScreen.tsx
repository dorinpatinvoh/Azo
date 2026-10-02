import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
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
import {
  AdminProviderDetail,
  AdminProviderQueue,
  AdminProviderStats,
  DocumentKind,
  ProviderChecklistItem,
  ProviderDecision,
  ProviderStatus,
  ProviderType,
  errorMessage,
  adminProvidersApi,
  providersApi,
} from "../services/api";
import { formatBeninPhoneDisplay } from "../utils/phone";

type Props = {
  onBack: () => void;
  onOpenDashboard?: () => void;
};

type Filter = { id: ProviderStatus | "ALL"; label: string };

const FILTERS: Filter[] = [
  { id: "SUBMITTED", label: "À valider" },
  { id: "UNDER_REVIEW", label: "En examen" },
  { id: "NEED_INFO", label: "Infos manquantes" },
  { id: "APPROVED", label: "Actifs" },
  { id: "SUSPENDED", label: "Suspendus" },
  { id: "REJECTED", label: "Refusés" },
  { id: "ALL", label: "Tous" },
];

const TYPE_FILTERS: { id: ProviderType | "ALL"; label: string }[] = [
  { id: "ALL", label: "Toutes activités" },
  { id: "DRIVER", label: "Zem / Chauffeur" },
  { id: "COURIER", label: "Coursier / Livreur" },
  { id: "AGENCY", label: "Agence" },
];

const STATUS_LABEL: Record<ProviderStatus, string> = {
  DRAFT: "Brouillon",
  SUBMITTED: "À valider",
  UNDER_REVIEW: "En examen",
  NEED_INFO: "Infos manquantes",
  APPROVED: "Actif",
  REJECTED: "Refusé",
  SUSPENDED: "Suspendu",
};

const STATUS_COLOR: Record<ProviderStatus, string> = {
  DRAFT: colors.outline,
  SUBMITTED: colors.secondary,
  UNDER_REVIEW: colors.primary,
  NEED_INFO: colors.tertiary,
  APPROVED: "#146C2E",
  REJECTED: colors.error,
  SUSPENDED: colors.error,
};

const EVENT_LABELS: Record<string, string> = {
  CREATED: "Dossier créé",
  UPDATED: "Dossier mis à jour",
  SUBMITTED: "Dossier déposé",
  DOCUMENT_ADDED: "Pièce ajoutée",
  DOCUMENT_VALIDATED: "Pièce validée",
  DOCUMENT_REJECTED: "Pièce refusée",
  REVIEW_STARTED: "Examen démarré",
  INFO_REQUESTED: "Information demandée",
  APPROVED: "Approuvé",
  REJECTED: "Refusé",
  SUSPENDED: "Suspendu",
  REINSTATED: "Réactivé",
  AGENCY_ATTACHED: "Rattaché à une agence",
  AGENCY_DETACHED: "Retiré de l'agence",
};

const TYPE_ICON: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  DRIVER: "two-wheeler",
  COURIER: "local-shipping",
  AGENCY: "apartment",
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function hoursLabel(hours: number | null) {
  if (hours == null) return "non déposé";
  if (hours < 1) return "à l'instant";
  if (hours < 48) return `il y a ${hours} h`;
  return `il y a ${Math.round(hours / 24)} j`;
}

function submissionMetaLabel(waitingHours: number | null, status: ProviderStatus) {
  if (status === "DRAFT") return "Brouillon non déposé";
  if (waitingHours == null) {
    return status === "APPROVED" ? "Compte régularisé" : "Non déposé";
  }
  return `Déposé ${hoursLabel(waitingHours)}`;
}

/** Dialogue de motif : Alert.prompt n'existe pas sur Android, d'où cette modale. */
function ReasonModal(props: {
  visible: boolean;
  title: string;
  placeholder: string;
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [value, setValue] = useState("");
  useEffect(() => {
    if (props.visible) setValue("");
  }, [props.visible]);

  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{props.title}</Text>
          <TextInput
            style={styles.modalInput}
            value={value}
            onChangeText={setValue}
            placeholder={props.placeholder}
            placeholderTextColor={colors.outline}
            multiline
            autoFocus
          />
          <Text style={styles.modalHint}>
            Le motif est notifié au candidat et inscrit au journal du dossier (5 caractères minimum).
          </Text>
          <View style={styles.modalActions}>
            <Pressable style={styles.modalCancel} onPress={props.onCancel}>
              <Text style={styles.modalCancelText}>Annuler</Text>
            </Pressable>
            <Pressable
              style={[styles.modalConfirm, props.destructive && { backgroundColor: colors.error }]}
              onPress={() => props.onConfirm(value.trim())}
            >
              <Text style={styles.modalConfirmText}>{props.confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function AdminProvidersScreen({ onBack, onOpenDashboard }: Props) {
  const [filter, setFilter] = useState<ProviderStatus | "ALL">("SUBMITTED");
  const [typeFilter, setTypeFilter] = useState<ProviderType | "ALL">("ALL");
  const [queue, setQueue] = useState<AdminProviderQueue | null>(null);
  const [stats, setStats] = useState<AdminProviderStats | null>(null);
  const [detail, setDetail] = useState<AdminProviderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [override, setOverride] = useState(false);
  const [viewer, setViewer] = useState<{ kind: DocumentKind; label: string; documentId: string } | null>(null);
  const [reason, setReason] = useState<{
    action: ProviderDecision | "DOCUMENT_INVALID";
    documentId?: string;
    title: string;
    placeholder: string;
  } | null>(null);

  const selectedId = detail?.id ?? null;

  const loadQueue = useCallback(async () => {
    const [q, s] = await Promise.all([
      adminProvidersApi.queue({
        ...(filter === "ALL" ? {} : { status: filter }),
        ...(typeFilter === "ALL" ? {} : { type: typeFilter }),
      }),
      adminProvidersApi.stats(),
    ]);
    setQueue(q);
    setStats(s);
  }, [filter, typeFilter]);

  const loadDetail = useCallback(async (id: string) => {
    const d = await adminProvidersApi.detail(id);
    setDetail(d);
    setOverride(false);
    return d;
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadQueue()
      .catch((e) => alive && setError(errorMessage(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [loadQueue]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      if (selectedId) await loadDetail(selectedId);
      else await loadQueue();
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRefreshing(false);
    }
  }

  async function run(action: () => Promise<unknown>, successMessage?: string) {
    setBusy(true);
    try {
      await action();
      if (selectedId) await loadDetail(selectedId);
      else await loadQueue();
      setError(null);
      if (successMessage) Alert.alert("Fait", successMessage);
    } catch (e) {
      setError(errorMessage(e));
      Alert.alert("Action impossible", errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function askReason(
    action: ProviderDecision | "DOCUMENT_INVALID",
    opts: { title: string; placeholder: string; documentId?: string }
  ) {
    setReason({ action, title: opts.title, placeholder: opts.placeholder, documentId: opts.documentId });
  }

  async function confirmReason(text: string) {
    if (!reason || !selectedId) return;
    const target = reason;
    setReason(null);
    if (text.length < 5) {
      Alert.alert("Motif trop court", "Indique au moins 5 caractères : le candidat doit pouvoir se corriger.");
      return;
    }
    const action = target.action;
    const documentId = target.documentId;
    if (action === "DOCUMENT_INVALID") {
      if (!documentId) return;
      await run(() => adminProvidersApi.decideDocument(selectedId, documentId, "INVALID", text));
      return;
    }
    await run(() => adminProvidersApi.decide(selectedId, action, text));
  }

  function confirmExit() {
    Alert.alert("Quitter la console admin", "Que souhaites-tu faire ?", [
      { text: "Annuler", style: "cancel" },
      ...(onOpenDashboard
        ? [{ text: "Tableau de bord", onPress: onOpenDashboard }]
        : []),
      { text: "Se déconnecter", style: "destructive", onPress: onBack },
    ]);
  }

  const counts = useMemo(() => stats?.byStatus ?? {}, [stats]);
  const totalAll = useMemo(
    () => Object.values(counts).reduce((sum, n) => sum + (n || 0), 0),
    [counts]
  );

  /* ------------------------------------------------------------ vue liste */

  if (!selectedId) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.header}>
          <Pressable onPress={confirmExit} style={styles.iconBtn} accessibilityLabel="Menu ou déconnexion">
            <MaterialIcons name="arrow-back-ios-new" size={18} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              Validation des prestataires
            </Text>
            <Text style={styles.headerSub} numberOfLines={1}>
              {stats ? `${stats.pending} en attente · ${stats.overdue} hors délai` : "Console administrateur"}
            </Text>
          </View>
          {onOpenDashboard ? (
            <Pressable
              onPress={onOpenDashboard}
              style={styles.dashboardBtn}
              accessibilityLabel="Tableau de bord admin"
            >
              <MaterialIcons name="dashboard" size={16} color={colors.primary} />
              <Text style={styles.dashboardBtnText}>Pilotage</Text>
            </Pressable>
          ) : null}
        </View>

        {/* Barre de filtres par statut — conteneur à hauteur fixe pour empêcher l'étirement vertical */}
        <View style={styles.filterBarWrapper}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipsScroll}
            contentContainerStyle={styles.chips}
          >
            {FILTERS.map((f) => {
              const active = filter === f.id;
              const count = f.id === "ALL" ? totalAll || queue?.total || 0 : counts[f.id] ?? 0;
              return (
                <Pressable
                  key={f.id}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setFilter(f.id)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                    {f.label}
                  </Text>
                  {count > 0 ? (
                    <View style={[styles.chipCountBadge, active && styles.chipCountBadgeActive]}>
                      <Text style={[styles.chipCount, active && styles.chipCountActive]}>{count}</Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Filtre secondaire par activité (Zem, Coursier, Agence) */}
        <View style={styles.subFilterWrapper}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipsScroll}
            contentContainerStyle={styles.subChips}
          >
            {TYPE_FILTERS.map((tf) => {
              const active = typeFilter === tf.id;
              return (
                <Pressable
                  key={tf.id}
                  style={[styles.subChip, active && styles.subChipActive]}
                  onPress={() => setTypeFilter(tf.id)}
                >
                  <Text style={[styles.subChipText, active && styles.subChipTextActive]} numberOfLines={1}>
                    {tf.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {stats ? (
          <View style={styles.statsRow}>
            <Stat
              label="Délai moyen"
              value={stats.averageReviewHours != null ? `${stats.averageReviewHours} h` : "—"}
            />
            <Stat label="Approuvés" value={String(stats.approved)} />
            <Stat label="Suspendus" value={String(stats.suspended)} />
            <Stat label="SLA" value={`${stats.slaHours} h`} />
          </View>
        ) : null}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <ScrollView
            style={styles.listScroll}
            contentContainerStyle={styles.scroll}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
          >
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            {(queue?.items ?? []).length === 0 && !error ? (
              <View style={styles.empty}>
                <View style={styles.emptyIconCircle}>
                  <MaterialIcons name="task-alt" size={32} color={colors.primary} />
                </View>
                <Text style={styles.emptyTitle}>Aucun dossier dans cette file</Text>
                <Text style={styles.muted}>
                  Change d'onglet ci-dessus (ex. « Tous » ou « Actifs ») ou tire vers le bas pour actualiser.
                </Text>
              </View>
            ) : null}

            {(queue?.items ?? []).map((item) => (
              <Pressable key={item.id} style={styles.row} onPress={() => run(() => loadDetail(item.id))}>
                <View style={styles.rowIcon}>
                  <MaterialIcons name={TYPE_ICON[item.type] ?? "person"} size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.identity.fullName ?? item.user.fullName ?? formatBeninPhoneDisplay(item.user.phone)}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {item.typeLabel}
                    {item.identity.city ? ` · ${item.identity.city}` : ""} · {formatBeninPhoneDisplay(item.user.phone)}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {submissionMetaLabel(item.review.waitingHours, item.status)} · pièces{" "}
                    {item.checklist.filter((c) => c.hasFile).length}/
                    {item.checklist.filter((c) => c.required).length} · KYC {item.activation.kycScore}/100
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <View style={[styles.statusPill, { backgroundColor: `${STATUS_COLOR[item.status]}1A` }]}>
                    <Text style={[styles.statusPillText, { color: STATUS_COLOR[item.status] }]}>
                      {STATUS_LABEL[item.status]}
                    </Text>
                  </View>
                  {item.review.overdue ? (
                    <Text style={styles.overdueText}>Hors délai</Text>
                  ) : (
                    <MaterialIcons name="chevron-right" size={20} color={colors.outline} />
                  )}
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
    );
  }

  /* ---------------------------------------------------------- vue détail */

  const d = detail!;
  const hasMissing = d.missingDocuments.length > 0 || d.missingFields.length > 0;
  const decidable = ["SUBMITTED", "UNDER_REVIEW", "NEED_INFO"].includes(d.status);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => setDetail(null)} style={styles.iconBtn} accessibilityLabel="Retour à la liste">
          <MaterialIcons name="arrow-back-ios-new" size={18} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {d.identity.fullName ?? formatBeninPhoneDisplay(d.user.phone)}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {formatBeninPhoneDisplay(d.user.phone)} · {d.typeLabel}
            {d.identity.city ? ` · ${d.identity.city}` : ""}
          </Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: `${STATUS_COLOR[d.status]}1A` }]}>
          <Text style={[styles.statusPillText, { color: STATUS_COLOR[d.status] }]}>{STATUS_LABEL[d.status]}</Text>
        </View>
      </View>

      {busy ? (
        <View style={styles.busyBar}>
          <ActivityIndicator size="small" color="#fff" />
          <Text style={styles.busyText}>Traitement en cours…</Text>
        </View>
      ) : null}

      <ScrollView
        style={styles.listScroll}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
      >
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {/* Identité + activité */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Candidature</Text>
          <Info label="Statut du compte" value={`${d.user.role} · ${d.user.status}`} />
          <Info label="Téléphone" value={formatBeninPhoneDisplay(d.user.phone)} />
          <Info label="Inscrit le" value={fmtDate(d.user.createdAt)} />
          <Info label="Déposé le" value={fmtDate(d.review.submittedAt)} />
          <Info
            label="Ancienneté"
            value={submissionMetaLabel(d.review.waitingHours, d.status)}
            warn={d.review.overdue}
          />
          {d.activity.categoryId ? <Info label="Spécialité" value={d.activity.categoryId} /> : null}
          {d.activity.vehicleType ? <Info label="Véhicule" value={d.activity.vehicleType} /> : null}
          {d.activity.plateNumber ? <Info label="Immatriculation" value={d.activity.plateNumber} /> : null}
          {d.activity.vehicleModel ? <Info label="Modèle" value={d.activity.vehicleModel} /> : null}
          {d.activity.agencyName ? <Info label="Raison sociale" value={d.activity.agencyName} /> : null}
          {d.activity.planLabel ? (
            <Info
              label="Formule"
              value={`${d.activity.planLabel} · ${d.activity.planFee?.toLocaleString("fr-FR") ?? 0} F · commission ${((d.activity.planCommissionRate ?? 0) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`}
            />
          ) : null}
          {d.identity.zones?.length ? <Info label="Zones" value={d.identity.zones.join(", ")} /> : null}
          {d.identity.experienceYears != null ? (
            <Info label="Expérience" value={`${d.identity.experienceYears} an(s)`} />
          ) : null}
          {d.missingFields.length ? (
            <Info label="Champs manquants" value={d.missingFields.join(", ")} warn />
          ) : null}
        </View>

        {/* Pièces */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Pièces justificatives</Text>
          {d.checklist.map((item) => (
            <DocumentRow
              key={item.kind}
              item={item}
              onOpen={() => {
                const docId = item.documentId;
                if (docId) setViewer({ kind: item.kind, label: item.label, documentId: docId });
              }}
              onValidate={() => {
                const docId = item.documentId;
                if (!docId) return;
                run(() => adminProvidersApi.decideDocument(d.id, docId, "VALID"), `${item.label} validée`);
              }}
              onReject={() => {
                const docId = item.documentId;
                if (!docId) return;
                askReason("DOCUMENT_INVALID", {
                  title: `Refuser « ${item.label} »`,
                  placeholder: "Ex. photo floue, nom illisible, document expiré…",
                  documentId: docId,
                });
              }}
            />
          ))}
          {d.missingDocuments.length ? (
            <Text style={styles.warnText}>
              Manquent : {d.missingDocuments.map((m) => m.label).join(", ")}
            </Text>
          ) : null}
        </View>

        {/* Décisions */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Décision</Text>

          {decidable && d.status !== "UNDER_REVIEW" ? (
            <Pressable
              style={styles.actionGhost}
              onPress={() => run(() => adminProvidersApi.startReview(d.id))}
              disabled={busy}
            >
              <MaterialIcons name="touch-app" size={18} color={colors.onSurface} />
              <Text style={styles.actionGhostText}>Prendre en charge le dossier</Text>
            </Pressable>
          ) : null}

          {decidable || d.status === "DRAFT" ? (
            <>
              {hasMissing ? (
                <Pressable style={styles.overrideRow} onPress={() => setOverride((o) => !o)}>
                  <MaterialIcons
                    name={override ? "check-box" : "check-box-outline-blank"}
                    size={20}
                    color={override ? colors.secondary : colors.outline}
                  />
                  <Text style={styles.overrideText}>
                    Dérogation : approuver malgré les pièces manquantes (tracée au journal)
                  </Text>
                </Pressable>
              ) : null}

              {decidable ? (
                <>
                  <Pressable
                    style={[styles.actionPrimary, busy && styles.disabled]}
                    disabled={busy}
                    onPress={() =>
                      run(
                        () => adminProvidersApi.decide(d.id, "APPROVE", undefined, override || undefined),
                        "Dossier approuvé : le rôle est accordé."
                      )
                    }
                  >
                    <MaterialIcons name="verified" size={18} color="#fff" />
                    <Text style={styles.actionPrimaryText}>Approuver et activer le compte</Text>
                  </Pressable>

                  <Pressable
                    style={styles.actionGhost}
                    disabled={busy}
                    onPress={() =>
                      askReason("NEED_INFO", {
                        title: "Demander une information",
                        placeholder: "Ex. renvoie une photo lisible de ton permis",
                      })
                    }
                  >
                    <MaterialIcons name="help-outline" size={18} color={colors.onSurface} />
                    <Text style={styles.actionGhostText}>Demander une pièce / information</Text>
                  </Pressable>

                  <Pressable
                    style={styles.actionDangerGhost}
                    disabled={busy}
                    onPress={() =>
                      askReason("REJECT", {
                        title: "Refuser le dossier",
                        placeholder: "Motif du refus (visible par le candidat)",
                      })
                    }
                  >
                    <MaterialIcons name="cancel" size={18} color={colors.error} />
                    <Text style={styles.actionDangerText}>Refuser le dossier</Text>
                  </Pressable>
                </>
              ) : (
                <Text style={styles.muted}>
                  Ce dossier est encore en brouillon : le candidat ne l'a pas encore soumis pour validation.
                </Text>
              )}
            </>
          ) : null}

          {d.status === "APPROVED" ? (
            <Pressable
              style={styles.actionDangerGhost}
              disabled={busy}
              onPress={() =>
                askReason("SUSPEND", {
                  title: "Suspendre le compte",
                  placeholder: "Motif de la suspension (visible par le prestataire)",
                })
              }
            >
              <MaterialIcons name="block" size={18} color={colors.error} />
              <Text style={styles.actionDangerText}>Suspendre ce prestataire</Text>
            </Pressable>
          ) : null}

          {d.status === "SUSPENDED" ? (
            <Pressable
              style={[styles.actionPrimary, busy && styles.disabled]}
              disabled={busy}
              onPress={() => run(() => adminProvidersApi.reinstate(d.id), "Suspension levée.")}
            >
              <MaterialIcons name="restart-alt" size={18} color="#fff" />
              <Text style={styles.actionPrimaryText}>Lever la suspension</Text>
            </Pressable>
          ) : null}

          {d.status === "REJECTED" ? (
            <Text style={styles.muted}>Dossier refusé : {d.review.rejectReason ?? "—"}</Text>
          ) : null}
          {d.status === "NEED_INFO" ? (
            <Text style={styles.muted}>Attendu du candidat : {d.review.infoRequested ?? "—"}</Text>
          ) : null}
          {d.status === "SUSPENDED" ? (
            <Text style={styles.muted}>Motif : {d.review.suspensionReason ?? "—"}</Text>
          ) : null}
        </View>

        {/* Journal */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Journal du dossier</Text>
          {(d.timeline ?? []).map((e) => (
            <View key={e.id} style={styles.eventRow}>
              <Text style={styles.eventTitle}>{EVENT_LABELS[e.type] ?? e.type}</Text>
              {!!e.comment && <Text style={styles.eventComment}>{e.comment}</Text>}
              <Text style={styles.eventDate}>{fmtDate(e.createdAt)}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Visionneuse de pièce */}
      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <View style={styles.viewerBackdrop}>
          <View style={styles.viewerBar}>
            <Text style={styles.viewerTitle} numberOfLines={1}>
              {viewer?.label ?? ""}
            </Text>
            <Pressable onPress={() => setViewer(null)} style={styles.iconBtnDark}>
              <MaterialIcons name="close" size={22} color="#fff" />
            </Pressable>
          </View>
          {viewer ? (
            <Image
              source={providersApi.fileSource(viewer.documentId)}
              style={styles.viewerImage}
              resizeMode="contain"
            />
          ) : null}
          <Text style={styles.viewerHint}>
            Compare la pièce au selfie et au nom déclaré avant de valider.
          </Text>
        </View>
      </Modal>

      <ReasonModal
        visible={!!reason}
        title={reason?.title ?? ""}
        placeholder={reason?.placeholder ?? ""}
        confirmLabel={reason?.action === "REJECT" || reason?.action === "SUSPEND" ? "Confirmer" : "Envoyer"}
        destructive={reason?.action === "REJECT" || reason?.action === "SUSPEND"}
        onCancel={() => setReason(null)}
        onConfirm={confirmReason}
      />
    </SafeAreaView>
  );
}

/* -------------------------------------------------------------------------- */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
        {value}
      </Text>
      <Text style={styles.statLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
        {label}
      </Text>
    </View>
  );
}

function Info({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, warn && { color: colors.error }]} numberOfLines={3}>
        {value}
      </Text>
    </View>
  );
}

function DocumentRow(props: {
  item: ProviderChecklistItem;
  onOpen: () => void;
  onValidate: () => void;
  onReject: () => void;
}) {
  const { item } = props;
  const state =
    item.status === "VALID"
      ? { text: "Validée", color: "#146C2E" }
      : item.status === "INVALID"
        ? { text: "Refusée", color: colors.error }
        : item.hasFile
          ? { text: "À vérifier", color: colors.tertiary }
          : { text: item.photoRequired ? "Photo manquante" : "Manquante", color: colors.error };

  return (
    <View style={styles.docRow}>
      {item.hasFile && item.documentId ? (
        <Pressable onPress={props.onOpen}>
          <Image source={providersApi.fileSource(item.documentId)} style={styles.docThumb} />
        </Pressable>
      ) : (
        <View style={[styles.docThumb, styles.docThumbEmpty]}>
          <MaterialIcons name="image-not-supported" size={18} color={colors.outline} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.docLabel}>
          {item.label.charAt(0).toUpperCase() + item.label.slice(1)}
          {item.required ? <Text style={{ color: colors.error }}> *</Text> : null}
          {item.photoRequired ? <Text style={styles.photoTag}> photo</Text> : null}
        </Text>
        <Text style={[styles.docState, { color: state.color }]}>
          {state.text}
          {item.expired ? " · expirée" : item.expiresAt ? ` · expire le ${fmtDate(item.expiresAt)}` : ""}
        </Text>
        {!!item.note && <Text style={styles.docNote}>{item.note}</Text>}
        {item.hasFile ? (
          <View style={styles.docActions}>
            <Pressable style={styles.miniBtn} onPress={props.onValidate}>
              <Text style={styles.miniBtnText}>Valider</Text>
            </Pressable>
            <Pressable style={[styles.miniBtn, styles.miniBtnDanger]} onPress={props.onReject}>
              <Text style={[styles.miniBtnText, { color: colors.error }]}>Refuser</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceContainer,
  },
  iconBtnDark: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  headerTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  headerSub: { ...typography.labelSm, color: colors.onSurfaceVariant },
  dashboardBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.primaryFixed,
    paddingHorizontal: 12,
    height: 36,
    borderRadius: radius.full,
  },
  dashboardBtnText: { ...typography.labelSm, color: colors.primary, fontWeight: "800" },

  // Conteneur à taille fixe (flexGrow: 0, flexShrink: 0) : les boutons de filtre gardent
  // exactement la même hauteur (36px) même quand la liste en dessous est vide.
  filterBarWrapper: {
    flexGrow: 0,
    flexShrink: 0,
    height: 48,
    justifyContent: "center",
  },
  subFilterWrapper: {
    flexGrow: 0,
    flexShrink: 0,
    height: 38,
    justifyContent: "center",
    marginBottom: 4,
  },
  chipsScroll: {
    flexGrow: 0,
  },
  chips: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: spacing.md,
  },
  chip: {
    height: 36,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.outlineVariant,
    paddingHorizontal: 14,
    backgroundColor: colors.surfaceContainerLowest,
  },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryFixed },
  chipText: { ...typography.labelSm, color: colors.onSurfaceVariant, fontWeight: "700" },
  chipTextActive: { color: colors.primary, fontWeight: "800" },
  chipCountBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    backgroundColor: colors.surfaceContainer,
    alignItems: "center",
    justifyContent: "center",
  },
  chipCountBadgeActive: {
    backgroundColor: colors.primary,
  },
  chipCount: { fontSize: 11, color: colors.onSurfaceVariant, fontWeight: "800" },
  chipCountActive: { color: "#fff" },

  subChips: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
  },
  subChip: {
    height: 30,
    alignSelf: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    paddingHorizontal: 12,
    backgroundColor: colors.surfaceContainerLow,
  },
  subChipActive: {
    backgroundColor: colors.onSurface,
  },
  subChipText: { ...typography.labelSm, color: colors.onSurfaceVariant, fontWeight: "600" },
  subChipTextActive: { color: "#fff", fontWeight: "700" },

  statsRow: {
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  stat: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
  },
  statValue: { ...typography.labelLg, color: colors.primary, fontWeight: "800", textAlign: "center" },
  statLabel: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
    textAlign: "center",
    marginTop: 2,
  },

  listScroll: { flex: 1 },
  scroll: { padding: spacing.md, gap: spacing.sm, paddingBottom: 100 },
  errorText: { ...typography.bodySm, color: colors.error, textAlign: "center" },
  muted: { ...typography.bodySm, color: colors.onSurfaceVariant, lineHeight: 20, textAlign: "center" },
  warnText: { ...typography.labelSm, color: colors.error, marginTop: 6 },
  empty: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 48,
    paddingHorizontal: spacing.lg,
  },
  emptyIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primaryFixed,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "700" },
  busyBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  busyText: { ...typography.labelSm, color: "#fff", fontWeight: "700" },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
  },
  rowIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primaryFixed,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: { ...typography.bodyMd, color: colors.onSurface, fontWeight: "700" },
  rowMeta: { ...typography.labelSm, color: colors.onSurfaceVariant, marginTop: 2 },
  statusPill: { borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  statusPillText: { ...typography.labelSm, fontWeight: "700" },
  overdueText: { ...typography.labelSm, color: colors.error, fontWeight: "700" },

  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: 6,
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
  },
  cardTitle: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700", marginBottom: 4 },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.surfaceContainer,
  },
  infoLabel: { ...typography.labelMd, color: colors.onSurfaceVariant },
  infoValue: {
    ...typography.labelMd,
    color: colors.onSurface,
    fontWeight: "700",
    flexShrink: 1,
    textAlign: "right",
  },

  docRow: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.surfaceContainer,
  },
  docThumb: { width: 62, height: 62, borderRadius: radius.md, backgroundColor: colors.surfaceContainer },
  docThumbEmpty: { alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceContainerLow },
  docLabel: { ...typography.bodySm, color: colors.onSurface, fontWeight: "700" },
  photoTag: { ...typography.labelSm, color: colors.secondary },
  docState: { ...typography.labelSm, marginTop: 2 },
  docNote: { ...typography.labelSm, color: colors.error, marginTop: 2 },
  docActions: { flexDirection: "row", gap: 8, marginTop: 6 },
  miniBtn: {
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: "#146C2E",
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  miniBtnDanger: { borderColor: colors.error },
  miniBtnText: { ...typography.labelSm, color: "#146C2E", fontWeight: "700" },

  actionPrimary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingVertical: 13,
    marginTop: 4,
  },
  actionPrimaryText: { ...typography.labelMd, color: "#fff", fontWeight: "800" },
  actionGhost: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.outline,
    paddingVertical: 12,
    marginTop: 4,
  },
  actionGhostText: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  actionDangerGhost: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.error,
    paddingVertical: 12,
    marginTop: 4,
  },
  actionDangerText: { ...typography.labelMd, color: colors.error, fontWeight: "700" },
  disabled: { opacity: 0.6 },
  overrideRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    backgroundColor: colors.secondaryFixed,
    borderRadius: radius.lg,
    padding: spacing.sm + 2,
  },
  overrideText: { ...typography.labelSm, color: colors.onSecondaryFixed, flex: 1, fontWeight: "600" },

  eventRow: {
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.surfaceContainer,
  },
  eventTitle: { ...typography.bodySm, color: colors.onSurface, fontWeight: "700" },
  eventComment: { ...typography.labelSm, color: colors.onSurfaceVariant },
  eventDate: { ...typography.labelSm, color: colors.outline, marginTop: 1 },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: spacing.lg },
  modalCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.sm,
  },
  modalTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  modalInput: {
    minHeight: 90,
    textAlignVertical: "top",
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.lg,
    padding: spacing.sm + 2,
    ...typography.bodySm,
    color: colors.onSurface,
  },
  modalHint: { ...typography.labelSm, color: colors.onSurfaceVariant },
  modalActions: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  modalCancel: {
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.outline,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  modalCancelText: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  modalConfirm: {
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  modalConfirmText: { ...typography.labelMd, color: "#fff", fontWeight: "800" },

  viewerBackdrop: { flex: 1, backgroundColor: "#000", paddingTop: 50 },
  viewerBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  viewerTitle: { ...typography.labelLg, color: "#fff", fontWeight: "700", flex: 1 },
  viewerImage: { flex: 1, width: "100%" },
  viewerHint: {
    ...typography.labelSm,
    color: "rgba(255,255,255,0.75)",
    textAlign: "center",
    padding: spacing.md,
  },
});
