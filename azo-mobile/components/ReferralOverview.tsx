import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { ReferralItem, ReferralKind, ReferralOverviewData, ReferralStatus } from "../services/api";
import { fcfa } from "../utils/rideDisplay";
import { formatBeninPhoneDisplay } from "../utils/phone";

export const KIND_INFO: Record<ReferralKind, { label: string; plural: string; icon: keyof typeof MaterialIcons.glyphMap }> = {
  SPEEDER: { label: "Speeder", plural: "Speeders", icon: "two-wheeler" },
  AGENCE: { label: "Agence", plural: "Agences", icon: "apartment" },
  COURSIER_PERSONNEL: { label: "Coursier personnel", plural: "Coursiers personnels", icon: "directions-run" },
  LIVREUR_EXPRESS: { label: "Livreur express", plural: "Livreurs express", icon: "local-shipping" },
  CLIENT: { label: "Client", plural: "Clients", icon: "person" },
};
export const REFERRAL_KINDS: ReferralKind[] = ["SPEEDER", "AGENCE", "COURSIER_PERSONNEL", "LIVREUR_EXPRESS", "CLIENT"];

const STATUS_INFO: Record<ReferralStatus, { label: string; bg: string; fg: string }> = {
  ACTIF: { label: "Actif", bg: "#DDF3E4", fg: "#146C2E" },
  INACTIF: { label: "Inactif", bg: colors.secondaryFixed, fg: colors.secondary },
  EN_ATTENTE: { label: "Dossier en attente", bg: colors.tertiaryFixed, fg: colors.tertiary },
  REFUSE: { label: "Dossier refusé", bg: colors.errorContainer, fg: colors.error },
  SUSPENDU: { label: "Suspendu", bg: colors.errorContainer, fg: colors.error },
};

export type StatusFilter = "ALL" | "ACTIF" | "INACTIF" | "EN_ATTENTE" | "RECHARGE";
const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "ALL", label: "Tous" },
  { id: "ACTIF", label: "Actifs" },
  { id: "INACTIF", label: "Inactifs" },
  { id: "EN_ATTENTE", label: "En attente" },
  { id: "RECHARGE", label: "Ont rechargé" },
];

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");

/* ------------------------------------------------------------------------------------------------------------------ */
/*  Chiffres : par catégorie, vue d'ensemble, recharges                                                               */
/* ------------------------------------------------------------------------------------------------------------------ */

type SummaryProps = {
  data: ReferralOverviewData;
  /** Catégorie sélectionnée (mise en évidence) ; `onSelectKind` est appelé au toucher d'une carte. */
  kind?: ReferralKind | "ALL";
  onSelectKind?: (kind: ReferralKind | "ALL") => void;
};

export function ReferralSummary({ data, kind = "ALL", onSelectKind }: SummaryProps) {
  const { summary } = data;
  const t = summary.totals;
  return (
    <View style={{ gap: spacing.md }}>
      <View style={styles.kindGrid}>
        {REFERRAL_KINDS.map((k) => {
          const s = summary.byKind[k];
          return (
            <Pressable key={k} style={[styles.kindCard, kind === k && styles.kindCardActive]} onPress={() => onSelectKind?.(kind === k ? "ALL" : k)} disabled={!onSelectKind} accessibilityRole="button">
              <View style={styles.kindIcon}>
                <MaterialIcons name={KIND_INFO[k].icon} size={20} color={colors.primary} />
              </View>
              <Text style={styles.kindTotal}>{s.total}</Text>
              <Text style={styles.kindLabel} numberOfLines={1}>{KIND_INFO[k].plural}</Text>
              <Text style={styles.kindSub} numberOfLines={1}>{s.actifs} actifs · {s.inactifs} inactifs</Text>
              <Text style={styles.kindSub} numberOfLines={1}>{s.enAttente} en attente · {s.ontRecharge} rechargé</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.stats}>
        <Stat value={t.total} label="Recrutés" />
        <Stat value={t.actifs} label="Actifs" color="#146C2E" />
        <Stat value={t.inactifs} label="Inactifs" color={colors.secondary} />
        <Stat value={t.enAttente} label="En attente" color={colors.tertiary} />
      </View>
      <View style={styles.rechargeBox}>
        <MaterialIcons name="account-balance-wallet" size={20} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.rechargeTitle}>{t.ontRecharge} ont rechargé leur compte AZƆ̀ Pay</Text>
          <Text style={styles.rechargeSub}>Total rechargé : {fcfa(t.montantRecharge)}</Text>
        </View>
      </View>
      <Text style={styles.note}>
        « Actif » : au moins une course ou livraison terminée ces {summary.activeWindowDays} derniers jours. « Inactif » : dossier validé (ou inscription terminée pour un client), mais aucune activité récente.
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------------------------------------------------------ */
/*  Liste des recrues avec filtres                                                                                    */
/* ------------------------------------------------------------------------------------------------------------------ */

type ListProps = {
  data: ReferralOverviewData;
  kind: ReferralKind | "ALL";
  onKindChange: (kind: ReferralKind | "ALL") => void;
  status: StatusFilter;
  onStatusChange: (status: StatusFilter) => void;
  /** Version réduite (accueil) : sans filtres ni compteur. */
  compact?: boolean;
};

export function ReferralList({ data, kind, onKindChange, status, onStatusChange, compact }: ListProps) {
  const { referrals } = data;
  const filtered = useMemo(
    () =>
      referrals.filter((r) => {
        if (kind !== "ALL" && r.kind !== kind) return false;
        if (status === "RECHARGE") return r.recharged;
        if (status === "ALL") return true;
        return r.status === status;
      }),
    [referrals, status, kind]
  );

  return (
    <View style={{ gap: spacing.sm }}>
      {compact ? null : (
        <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {STATUS_FILTERS.map((f) => (
          <Pressable key={f.id} style={[styles.chip, status === f.id && styles.chipActive]} onPress={() => onStatusChange(f.id)} accessibilityRole="button">
            <Text style={[styles.chipText, status === f.id && styles.chipTextActive]}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Pressable style={[styles.chip, kind === "ALL" && styles.chipActive]} onPress={() => onKindChange("ALL")} accessibilityRole="button">
          <Text style={[styles.chipText, kind === "ALL" && styles.chipTextActive]}>Toutes catégories</Text>
        </Pressable>
        {REFERRAL_KINDS.map((k) => (
          <Pressable key={k} style={[styles.chip, kind === k && styles.chipActive]} onPress={() => onKindChange(kind === k ? "ALL" : k)} accessibilityRole="button">
            <Text style={[styles.chipText, kind === k && styles.chipTextActive]}>{KIND_INFO[k].plural}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Text style={styles.count}>{filtered.length} {filtered.length > 1 ? "recrues" : "recrue"}</Text>
        </>
      )}

      {filtered.length === 0 ? (
        <View style={styles.empty}>
          <MaterialIcons name="people-outline" size={30} color={colors.outline} />
          <Text style={styles.emptyText}>{referrals.length === 0 ? "Aucune recrue pour le moment." : "Aucune recrue dans cette vue."}</Text>
        </View>
      ) : (
        filtered.map((r) => <Row key={r.userId} item={r} />)
      )}
    </View>
  );
}

function Stat({ value, label, color }: { value: number; label: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, color ? { color } : null]}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function Row({ item: r }: { item: ReferralItem }) {
  // Un client « en attente » n'a pas fini son inscription (pas de dossier) ; un client actif a terminé une course ou une livraison ces 30 jours
  const st = r.kind === "CLIENT" && r.status === "EN_ATTENTE" ? { ...STATUS_INFO.EN_ATTENTE, label: "Inscription à terminer" } : STATUS_INFO[r.status];
  const k = r.kind ? KIND_INFO[r.kind] : null;
  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <View style={styles.rowIcon}>
          <MaterialIcons name={k?.icon ?? "person"} size={20} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowName} numberOfLines={1}>{r.name}</Text>
          <Text style={styles.rowSub} numberOfLines={1}>
            {k?.label ?? "Prestataire"} · {r.phone.startsWith("+") ? formatBeninPhoneDisplay(r.phone) : r.phone}{r.city ? ` · ${r.city}` : ""}
          </Text>
        </View>
        <View style={[styles.pill, { backgroundColor: st.bg }]}>
          <Text style={[styles.pillText, { color: st.fg }]} numberOfLines={1}>{st.label}</Text>
        </View>
      </View>
      <View style={styles.facts}>
        <Text style={styles.fact}>Inscrit le {day(r.registeredAt)}</Text>
        {r.approvedAt ? <Text style={styles.fact}>Validé le {day(r.approvedAt)}</Text> : null}
        <Text style={styles.fact}>Dernière activité : {day(r.lastActivityAt)}</Text>
        <Text style={styles.fact}>
          {r.jobsTotal} mission(s) au total · {r.jobsLast30Days} sur 30 jours
          {r.kind === "AGENCE" && r.fleetSize != null ? ` · flotte de ${r.fleetSize}` : ""}
        </Text>
        <Text style={[styles.fact, r.recharged && { color: "#146C2E", fontWeight: "700" }]}>
          {r.recharged
            ? `A rechargé ${r.rechargeCount} fois · ${fcfa(r.rechargedTotal)} (dernière le ${day(r.lastRechargeAt)})`
            : "N'a jamais rechargé son compte"}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  kindGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  kindCard: { width: "48.5%", backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.sm + 2, borderWidth: 1.5, borderColor: colors.surfaceContainer, gap: 2 },
  kindCardActive: { borderColor: colors.primary, backgroundColor: colors.primaryFixed },
  kindIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  kindTotal: { ...typography.headlineMd, color: colors.onSurface, fontWeight: "800" },
  kindLabel: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
  kindSub: { ...typography.bodySm, color: colors.onSurfaceVariant, fontSize: 11 },
  stats: { flexDirection: "row", gap: spacing.xs, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.sm, borderWidth: 1, borderColor: colors.surfaceContainer },
  stat: { flex: 1, alignItems: "center" },
  statValue: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  statLabel: { ...typography.bodySm, color: colors.onSurfaceVariant, fontSize: 11 },
  rechargeBox: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.primaryFixed, borderRadius: radius.lg, padding: spacing.sm + 2 },
  rechargeTitle: { ...typography.labelLg, color: colors.onPrimaryFixed, fontWeight: "800" },
  rechargeSub: { ...typography.bodySm, color: colors.onPrimaryFixed },
  note: { ...typography.bodySm, color: colors.onSurfaceVariant, fontSize: 11 },
  chips: { gap: spacing.xs, paddingVertical: 2 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.full, backgroundColor: colors.surfaceContainerLowest, borderWidth: 1, borderColor: colors.surfaceContainerHigh },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  chipTextActive: { color: "#fff" },
  count: { ...typography.labelMd, color: colors.onSurfaceVariant, fontWeight: "700" },
  empty: { alignItems: "center", gap: 6, paddingVertical: spacing.lg },
  emptyText: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  row: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.sm + 2, gap: spacing.xs + 2, borderWidth: 1, borderColor: colors.surfaceContainer },
  rowTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center" },
  rowName: { ...typography.labelLg, color: colors.onSurface, fontWeight: "800" },
  rowSub: { ...typography.bodySm, color: colors.onSurfaceVariant },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full, maxWidth: 140 },
  pillText: { ...typography.labelSm, fontWeight: "800" },
  facts: { gap: 2 },
  fact: { ...typography.bodySm, color: colors.onSurfaceVariant },
});
