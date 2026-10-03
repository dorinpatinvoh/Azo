import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import * as SecureStore from "expo-secure-store";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import {
  ProviderChecklistItem,
  ProviderMe,
  ProviderStatus,
  ProviderType,
  errorMessage,
  providersApi,
} from "../services/api";

type Props = {
  onEdit: () => void; // reprendre / compléter le dossier
  onEnterWorkspace: (type: ProviderType) => void; // dossier approuvé -> espace métier
  onBack: () => void; // continuer comme client
};

const STATUS_VIEW: Record<ProviderStatus, { icon: keyof typeof MaterialIcons.glyphMap; title: string; color: string; bg: string }> = {
  DRAFT: { icon: "edit-note", title: "Dossier non terminé", color: colors.tertiary, bg: colors.tertiaryFixed },
  SUBMITTED: { icon: "hourglass-top", title: "Dossier déposé", color: colors.primary, bg: colors.primaryFixed },
  UNDER_REVIEW: { icon: "fact-check", title: "En cours d'examen", color: colors.primary, bg: colors.primaryFixed },
  NEED_INFO: { icon: "help", title: "Information manquante", color: colors.secondary, bg: colors.secondaryFixed },
  APPROVED: { icon: "verified", title: "Compte prestataire activé", color: "#146C2E", bg: "#D7F0DC" },
  REJECTED: { icon: "cancel", title: "Dossier refusé", color: colors.error, bg: colors.errorContainer },
  SUSPENDED: { icon: "block", title: "Compte suspendu", color: colors.error, bg: colors.errorContainer },
};

const EVENT_LABELS: Record<string, string> = {
  CREATED: "Dossier créé",
  UPDATED: "Dossier mis à jour",
  SUBMITTED: "Dossier déposé pour validation",
  DOCUMENT_ADDED: "Pièce ajoutée",
  DOCUMENT_VALIDATED: "Pièce validée",
  DOCUMENT_REJECTED: "Pièce refusée",
  REVIEW_STARTED: "Un administrateur examine ton dossier",
  INFO_REQUESTED: "Information demandée",
  APPROVED: "Dossier approuvé",
  REJECTED: "Dossier refusé",
  SUSPENDED: "Compte suspendu",
  REINSTATED: "Compte réactivé",
  AGENCY_ATTACHED: "Rattaché à une agence",
  AGENCY_DETACHED: "Retiré de l'agence",
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function ProviderStatusScreen({ onEdit, onEnterWorkspace, onBack }: Props) {
  const [data, setData] = useState<ProviderMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const me = await providersApi.me();
      setData(me);
      setError(null);

      // L'approbation d'un dossier change le rôle côté serveur : on le recopie localement,
      // sinon l'app routerait encore vers l'accueil client au prochain démarrage.
      const stored = await SecureStore.getItemAsync("userRole");
      if (me.account?.role && stored !== me.account.role) {
        await SecureStore.setItemAsync("userRole", me.account.role);
      }
      await SecureStore.setItemAsync("providerStatus", me.provider?.status ?? "");
      await SecureStore.setItemAsync("providerType", me.provider?.type ?? "");
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    load().finally(() => alive && setLoading(false));

    // Le statut peut changer à tout moment (décision de l'admin) : on revérifie
    // périodiquement tant que l'écran est ouvert.
    const timer = setInterval(() => {
      load().catch(() => undefined);
    }, 20000);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

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

  const provider = data?.provider ?? null;

  if (!provider) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <Header onBack={onBack} />
        <View style={styles.center}>
          <MaterialIcons name="badge" size={44} color={colors.primary} />
          <Text style={styles.title}>Deviens prestataire AZƆ̀</Text>
          <Text style={[styles.muted, { textAlign: "center" }]}>
            Chauffeur de zem, conducteur indépendant ou agence de flotte : dépose un dossier,
            il est vérifié par un administrateur avant l'ouverture de ton espace métier.
          </Text>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <Pressable style={styles.primaryBtn} onPress={onEdit}>
            <Text style={styles.primaryText}>Commencer mon inscription</Text>
          </Pressable>
          <Pressable style={styles.secondaryBtn} onPress={onBack}>
            <Text style={styles.secondaryText}>Continuer comme client</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const view = STATUS_VIEW[provider.status];
  const checklist = provider.checklist;
  const providedCount = checklist.filter((c) => c.hasFile).length;
  const requiredCount = checklist.filter((c) => c.required).length;
  const progress = requiredCount > 0 ? Math.min(1, providedCount / requiredCount) : 1;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Header onBack={onBack} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
      >
        {/* ---------------------------------------------- état du dossier */}
        <View style={[styles.hero, { backgroundColor: view.bg }]}>
          <MaterialIcons name={view.icon} size={30} color={view.color} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.heroTitle, { color: view.color }]}>{view.title}</Text>
            <Text style={styles.heroSub}>
              {provider.typeLabel}
              {provider.identity.city ? ` · ${provider.identity.city}` : ""}
            </Text>
          </View>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {/* ---------------------------------------------- délais / SLA */}
        {provider.status === "SUBMITTED" || provider.status === "UNDER_REVIEW" ? (
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>Délai de réponse</Text>
              <View style={[styles.pill, provider.review.overdue && styles.pillWarn]}>
                <Text style={[styles.pillText, provider.review.overdue && styles.pillWarnText]}>
                  {provider.review.overdue ? "Délai dépassé" : "Dans les temps"}
                </Text>
              </View>
            </View>
            <Text style={styles.muted}>
              En attente depuis {provider.review.waitingHours ?? 0} h · réponse annoncée sous{" "}
              {provider.review.slaHours} h. Tu recevras une notification dès la décision.
            </Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
            </View>
            <Text style={styles.smallMuted}>
              Dossier complet à {Math.round(progress * 100)} % ({providedCount}/{requiredCount} pièces fournies)
            </Text>
          </View>
        ) : null}

        {/* ---------------------------------------------- messages de l'admin */}
        {provider.status === "NEED_INFO" && provider.review.infoRequested ? (
          <View style={[styles.alertCard, { borderColor: colors.secondary }]}>
            <MaterialIcons name="markunread-mailbox" size={20} color={colors.secondary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.alertTitle}>Ce que l'administrateur attend</Text>
              <Text style={styles.alertText}>{provider.review.infoRequested}</Text>
            </View>
          </View>
        ) : null}

        {provider.status === "REJECTED" && provider.review.rejectReason ? (
          <View style={[styles.alertCard, { borderColor: colors.error }]}>
            <MaterialIcons name="report" size={20} color={colors.error} />
            <View style={{ flex: 1 }}>
              <Text style={styles.alertTitle}>Motif du refus</Text>
              <Text style={styles.alertText}>{provider.review.rejectReason}</Text>
              {!!provider.review.canResubmitAt && (
                <Text style={styles.smallMuted}>
                  Re-dépôt possible à partir du {fmtDate(provider.review.canResubmitAt)}, ou immédiatement
                  si tu remplaces les pièces signalées.
                </Text>
              )}
            </View>
          </View>
        ) : null}

        {provider.status === "SUSPENDED" && provider.review.suspensionReason ? (
          <View style={[styles.alertCard, { borderColor: colors.error }]}>
            <MaterialIcons name="block" size={20} color={colors.error} />
            <View style={{ flex: 1 }}>
              <Text style={styles.alertTitle}>Motif de la suspension</Text>
              <Text style={styles.alertText}>{provider.review.suspensionReason}</Text>
            </View>
          </View>
        ) : null}

        {/* ---------------------------------------------- fiche légale agence */}
        {provider.type === "AGENCY" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Fiche légale & fiscale de l'agence</Text>
            <StatusInfoRow label="Raison sociale" value={provider.activity.agencyName ?? "—"} />
            {provider.activity.agencyDetails?.legalForm ? (
              <StatusInfoRow label="Forme juridique" value={provider.activity.agencyDetails.legalForm} />
            ) : null}
            <StatusInfoRow
              label="Représentant légal"
              value={
                `${provider.activity.agencyDetails?.representativeFirstName ?? ""} ${provider.activity.agencyDetails?.representativeLastName ?? ""}`.trim() ||
                provider.identity.fullName ||
                "—"
              }
            />
            {provider.activity.agencyDetails?.representativeRole ? (
              <StatusInfoRow label="Fonction" value={provider.activity.agencyDetails.representativeRole} />
            ) : null}
            {provider.activity.agencyDetails?.representativeNpi ? (
              <StatusInfoRow label="NPI Représentant (ANIP)" value={provider.activity.agencyDetails.representativeNpi} />
            ) : null}
            {provider.activity.agencyDetails?.ifuNumber ? (
              <StatusInfoRow label="N° IFU (DGI Bénin)" value={provider.activity.agencyDetails.ifuNumber} />
            ) : null}
            {provider.activity.agencyDetails?.rccmNumber ? (
              <StatusInfoRow label="N° RCCM (GUFE)" value={provider.activity.agencyDetails.rccmNumber} />
            ) : null}
            {provider.activity.agencyDetails?.headquartersAddress ? (
              <StatusInfoRow label="Siège social" value={provider.activity.agencyDetails.headquartersAddress} />
            ) : null}
            {provider.activity.planLabel ? (
              <StatusInfoRow label="Formule AZƆ̀" value={provider.activity.planLabel} />
            ) : null}
          </View>
        )}

        {/* ---------------------------------------------- pièces */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Pièces du dossier</Text>
          {checklist.map((item) => (
            <ChecklistRow key={item.kind} item={item} />
          ))}
          {provider.missingDocuments.length > 0 && (
            <Text style={styles.smallMuted}>
              Manquent : {provider.missingDocuments.map((m) => m.label).join(", ")}
            </Text>
          )}
          {provider.status === "APPROVED" && (
            <View style={styles.kycRow}>
              <MaterialIcons name="verified-user" size={18} color="#146C2E" />
              <Text style={styles.smallMuted}>Score de vérification : {provider.activation.kycScore}/100</Text>
            </View>
          )}
        </View>

        {/* ---------------------------------------------- historique */}
        {!!data?.timeline?.length && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Suivi du dossier</Text>
            {data.timeline.map((e, i) => (
              <View key={e.id} style={styles.timelineRow}>
                <View style={styles.timelineRail}>
                  <View style={[styles.timelineDot, e.byAdmin && styles.timelineDotAdmin]} />
                  {i < (data.timeline?.length ?? 0) - 1 && <View style={styles.timelineLine} />}
                </View>
                <View style={{ flex: 1, paddingBottom: spacing.sm }}>
                  <Text style={styles.timelineTitle}>{EVENT_LABELS[e.type] ?? e.type}</Text>
                  {!!e.comment && <Text style={styles.timelineComment}>{e.comment}</Text>}
                  <Text style={styles.timelineDate}>
                    {fmtDate(e.createdAt)} · {e.byAdmin ? "AZƆ̀" : "toi"}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {provider.status === "APPROVED" ? (
          <Pressable style={[styles.primaryBtn, { flex: 1 }]} onPress={() => onEnterWorkspace(provider.type)}>
            <Text style={styles.primaryText}>Ouvrir mon espace {provider.typeLabel.toLowerCase()}</Text>
          </Pressable>
        ) : (
          <>
            {provider.editable && (
              <Pressable style={[styles.primaryBtn, { flex: 1 }]} onPress={onEdit}>
                <Text style={styles.primaryText}>
                  {provider.status === "DRAFT" ? "Compléter mon dossier" : "Modifier mon dossier"}
                </Text>
              </Pressable>
            )}
            <Pressable style={styles.secondaryBtn} onPress={onBack}>
              <Text style={styles.secondaryText}>Continuer comme client</Text>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.iconBtn} accessibilityLabel="Retour">
        <MaterialIcons name="arrow-back-ios-new" size={18} color={colors.onSurface} />
      </Pressable>
      <Text style={styles.headerTitle}>Mon dossier prestataire</Text>
      <View style={{ width: 36 }} />
    </View>
  );
}

function StatusInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.checkRow}>
      <Text style={[styles.muted, { flex: 1 }]}>{label}</Text>
      <Text style={[styles.checkLabel, { textAlign: "right", maxWidth: "60%" }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function ChecklistRow({ item }: { item: ProviderChecklistItem }) {
  const state =
    item.status === "VALID"
      ? { icon: "check-circle" as const, color: "#146C2E", text: "Validée" }
      : item.status === "INVALID"
        ? { icon: "cancel" as const, color: colors.error, text: "Refusée" }
        : item.hasFile
          ? { icon: "schedule" as const, color: colors.tertiary, text: "En attente" }
          : { icon: "error-outline" as const, color: colors.error, text: item.photoRequired ? "Photo manquante" : "Manquante" };

  return (
    <View style={styles.checkRow}>
      <MaterialIcons name={state.icon} size={18} color={state.color} />
      <View style={{ flex: 1 }}>
        <Text style={styles.checkLabel}>
          {item.label}
          {item.required ? <Text style={{ color: colors.error }}> *</Text> : null}
        </Text>
        {!!item.note && <Text style={styles.checkNote}>{item.note}</Text>}
        {item.expired && <Text style={styles.checkNote}>Expirée</Text>}
      </View>
      <Text style={[styles.checkState, { color: state.color }]}>{state.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceContainer },
  headerTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800", flex: 1 },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: 30 },
  title: { ...typography.headlineMd, color: colors.onSurface, fontWeight: "800", textAlign: "center" },
  muted: { ...typography.bodySm, color: colors.onSurfaceVariant, lineHeight: 20 },
  smallMuted: { ...typography.labelSm, color: colors.onSurfaceVariant, marginTop: 6 },
  errorText: { ...typography.bodySm, color: colors.error, textAlign: "center" },

  hero: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: radius.xl, padding: spacing.md },
  heroTitle: { ...typography.headlineSm, fontWeight: "800" },
  heroSub: { ...typography.labelSm, color: colors.onSurfaceVariant, marginTop: 2 },

  card: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, padding: spacing.md, gap: spacing.xs },
  cardTitle: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700", marginBottom: 4 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pill: { backgroundColor: "#D7F0DC", borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { ...typography.labelSm, color: "#146C2E", fontWeight: "700" },
  pillWarn: { backgroundColor: colors.errorContainer },
  pillWarnText: { color: colors.error },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceContainerHigh, marginTop: 8, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },

  alertCard: { flexDirection: "row", gap: 10, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, padding: spacing.md, borderWidth: 1.5 },
  alertTitle: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  alertText: { ...typography.bodySm, color: colors.onSurface, marginTop: 2, lineHeight: 20 },

  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.surfaceContainer },
  checkLabel: { ...typography.bodySm, color: colors.onSurface, fontWeight: "600" },
  checkNote: { ...typography.labelSm, color: colors.onSurfaceVariant },
  checkState: { ...typography.labelSm, fontWeight: "700" },
  kycRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },

  timelineRow: { flexDirection: "row", gap: 10 },
  timelineRail: { width: 18, alignItems: "center" },
  timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.outlineVariant, marginTop: 5 },
  timelineDotAdmin: { backgroundColor: colors.primary },
  timelineLine: { flex: 1, width: 2, backgroundColor: colors.surfaceContainerHigh, marginVertical: 2 },
  timelineTitle: { ...typography.bodySm, color: colors.onSurface, fontWeight: "700" },
  timelineComment: { ...typography.labelSm, color: colors.onSurfaceVariant, marginTop: 1 },
  timelineDate: { ...typography.labelSm, color: colors.outline, marginTop: 2 },

  footer: { flexDirection: "row", gap: 10, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.outlineVariant, backgroundColor: colors.surfaceContainerLowest },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
  primaryText: { ...typography.labelMd, color: "#fff", fontWeight: "800", fontSize: 15 },
  secondaryBtn: { borderRadius: radius.full, paddingVertical: 14, paddingHorizontal: 18, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: colors.outline },
  secondaryText: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
});
