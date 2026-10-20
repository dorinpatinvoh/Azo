import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, BackHandler, Modal, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { AdminReferrerDetail, AdminReferrerRow, ReferralItem, adminReferralsApi, errorMessage } from "../services/api";
import { cleanBeninDigits, formatBeninPhoneDisplay, formatBeninPhoneInput, isValidBeninPhone } from "../utils/phone";
import AdminTabBar, { type AdminTab } from "../components/AdminTabBar";
import ReferralOverview from "../components/ReferralOverview";
import CommercialPromoCard, { promoMessage } from "../components/CommercialPromoCard";
import { BrandAlert } from "../components/BrandAlert";
import { fcfa } from "../utils/rideDisplay";

type Props = { onNavigateTab?: (tab: AdminTab) => void };

/**
 * Commerciaux (console administrateur) : l'administrateur crée les commerciaux, voit leur code promo COM-AZO…, leur lien personnel
 * et leurs chiffres, et peut rattacher ou retirer un prestataire. Un commercial se connecte avec son numéro et suit ses recrues dans son espace.
 */
export default function AdminReferralsScreen({ onNavigateTab }: Props) {
  const [rows, setRows] = useState<AdminReferrerRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminReferrerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Création d'un commercial
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Rattachement d'un prestataire existant
  const [attaching, setAttaching] = useState(false);
  const [attachPhone, setAttachPhone] = useState("");

  const loadList = useCallback(async () => {
    try {
      setRows(await adminReferralsApi.list());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      setDetail(await adminReferralsApi.detail(id));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    loadList().finally(() => setLoading(false));
  }, [loadList]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    loadDetail(selected);
  }, [selected, loadDetail]);

  // Le bouton retour du téléphone ferme d'abord la fiche d'un commercial
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (selected) {
        setSelected(null);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [selected]);

  async function onRefresh() {
    setRefreshing(true);
    await (selected ? loadDetail(selected) : loadList());
    setRefreshing(false);
  }

  const phoneDigits = cleanBeninDigits(phone);
  const canCreate = name.trim().length >= 2 && isValidBeninPhone(phone) && !busy;

  async function submitCreate() {
    setBusy(true);
    try {
      const created = await adminReferralsApi.create({ fullName: name.trim(), phone: phoneDigits, ...(note.trim() ? { note: note.trim() } : {}) });
      setCreating(false);
      setName("");
      setPhone("");
      setNote("");
      await loadList();
      BrandAlert.alert(
        "Commercial créé ✅",
        `${created.fullName} (${formatBeninPhoneDisplay(created.phone)})\nCode promo : ${created.code}\nLien : ${created.link}\n\nIl se connecte avec ce numéro et retrouve son code, son lien et ses recrues.`,
        [
          { text: "Partager son lien", onPress: () => { Share.share({ message: promoMessage(created.code, created.link, created.fullName) }).catch(() => undefined); } },
          { text: "OK" },
        ]
      );
    } catch (e) {
      BrandAlert.alert("Création impossible", errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitAttach() {
    if (!selected || !isValidBeninPhone(attachPhone)) return;
    setBusy(true);
    try {
      setDetail(await adminReferralsApi.attach(selected, cleanBeninDigits(attachPhone)));
      setAttaching(false);
      setAttachPhone("");
      loadList().catch(() => undefined);
    } catch (e) {
      BrandAlert.alert("Rattachement impossible", errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function confirmDetach(item: ReferralItem) {
    BrandAlert.alert("Retirer cette recrue", `${item.name} ne sera plus rattaché à ${detail?.referrer.fullName ?? "ce commercial"}.`, [
      { text: "Non", style: "cancel" },
      {
        text: "Retirer",
        style: "destructive",
        onPress: async () => {
          try {
            setDetail(await adminReferralsApi.detach(item.userId));
            loadList().catch(() => undefined);
          } catch (e) {
            BrandAlert.alert("Opération impossible", errorMessage(e));
          }
        },
      },
    ]);
  }

  function toggleActive() {
    if (!detail) return;
    const next = !detail.referrer.active;
    BrandAlert.alert(next ? "Réactiver ce commercial" : "Désactiver ce commercial", next ? "Il retrouve son espace et son code promo redevient valable." : "Il n'accède plus à son espace et son code promo n'est plus accepté pour de nouvelles inscriptions. Ses recrues restent rattachées.", [
      { text: "Annuler", style: "cancel" },
      {
        text: next ? "Réactiver" : "Désactiver",
        style: next ? "default" : "destructive",
        onPress: async () => {
          try {
            setDetail(await adminReferralsApi.update(detail.referrer.id, { active: next }));
            loadList().catch(() => undefined);
          } catch (e) {
            BrandAlert.alert("Opération impossible", errorMessage(e));
          }
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        {selected ? (
          <Pressable onPress={() => setSelected(null)} style={styles.back} accessibilityRole="button" accessibilityLabel="Retour à la liste">
            <MaterialIcons name="arrow-back" size={22} color={colors.onSurface} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{selected ? detail?.referrer.fullName ?? "Commercial" : "Commerciaux"}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {selected ? (detail ? `${formatBeninPhoneDisplay(detail.referrer.phone)} · ${detail.referrer.code}` : "Chargement…") : "Les commerciaux et leurs recrues"}
          </Text>
        </View>
        {!selected ? (
          <Pressable style={styles.addBtn} onPress={() => setCreating(true)} accessibilityRole="button">
            <MaterialIcons name="person-add-alt-1" size={18} color="#fff" />
            <Text style={styles.addText}>Ajouter</Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />} keyboardShouldPersistTaps="handled">
          {error ? (
            <View style={styles.errorCard}>
              <MaterialIcons name="error-outline" size={20} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
              <Pressable onPress={onRefresh}><Text style={styles.link}>Réessayer</Text></Pressable>
            </View>
          ) : null}

          {!selected ? (
            rows.length === 0 && !error ? (
              <View style={styles.empty}>
                <MaterialIcons name="groups" size={40} color={colors.outline} />
                <Text style={styles.emptyTitle}>Aucun commercial pour le moment</Text>
                <Text style={styles.emptyText}>Appuie sur « Ajouter » : tu saisis son nom et son numéro, il reçoit un code promo COM-AZO… avec son lien de téléchargement personnel, et un espace pour suivre ses recrues.</Text>
              </View>
            ) : (
              rows.map((r) => (
                <Pressable key={r.id} style={styles.card} onPress={() => setSelected(r.id)} accessibilityRole="button">
                  <View style={styles.cardTop}>
                    <View style={styles.avatar}><MaterialIcons name="handshake" size={20} color={colors.primary} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardName} numberOfLines={1}>{r.fullName ?? "Sans nom"}</Text>
                      <Text style={styles.cardSub} numberOfLines={1}>{formatBeninPhoneDisplay(r.phone)} · {r.code}</Text>
                    </View>
                    {!r.active ? <View style={styles.off}><Text style={styles.offText}>Désactivé</Text></View> : null}
                    <MaterialIcons name="chevron-right" size={22} color={colors.outline} />
                  </View>
                  <View style={styles.counts}>
                    <Count value={r.byKind.SPEEDER.total} label="Speeders" />
                    <Count value={r.byKind.AGENCE.total} label="Agences" />
                    <Count value={r.byKind.COURSIER_PERSONNEL.total} label="Coursiers" />
                    <Count value={r.byKind.LIVREUR_EXPRESS.total} label="Livreurs" />
                  </View>
                  <Text style={styles.cardSub}>
                    {r.totals.actifs} actifs · {r.totals.inactifs} inactifs · {r.totals.enAttente} en attente · {r.totals.ontRecharge} ont rechargé ({fcfa(r.totals.montantRecharge)})
                  </Text>
                </Pressable>
              ))
            )
          ) : detail ? (
            <>
              <CommercialPromoCard code={detail.referrer.code} link={detail.referrer.link} name={detail.referrer.fullName} />
              <View style={styles.actions}>
                <Pressable style={styles.action} onPress={() => setAttaching(true)} accessibilityRole="button">
                  <MaterialIcons name="link" size={18} color={colors.primary} />
                  <Text style={styles.actionText}>Rattacher un prestataire</Text>
                </Pressable>
                <Pressable style={styles.action} onPress={toggleActive} accessibilityRole="button">
                  <MaterialIcons name={detail.referrer.active ? "block" : "check-circle"} size={18} color={detail.referrer.active ? colors.error : colors.primary} />
                  <Text style={[styles.actionText, detail.referrer.active && { color: colors.error }]}>{detail.referrer.active ? "Désactiver" : "Réactiver"}</Text>
                </Pressable>
              </View>
              {detail.referrer.note ? <Text style={styles.cardSub}>Note : {detail.referrer.note}</Text> : null}
              <ReferralOverview data={detail} onDetach={confirmDetach} />
            </>
          ) : null}
        </ScrollView>
      )}

      <AdminTabBar active="referrals" onNavigate={onNavigateTab} />

      {/* Ajouter un commercial */}
      <Modal visible={creating} transparent animationType="fade" onRequestClose={() => setCreating(false)}>
        <View style={styles.backdrop}>
          <ScrollView contentContainerStyle={styles.modalWrap} keyboardShouldPersistTaps="handled">
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Ajouter un commercial</Text>
              <Text style={styles.modalSub}>Il reçoit un code promo COM-AZO…, son lien personnel de téléchargement et un espace pour suivre les prestataires qu'il recrute.</Text>
              <Text style={styles.fieldLabel}>Nom complet</Text>
              <View style={styles.field}>
                <TextInput style={styles.fieldInput} value={name} onChangeText={setName} placeholder="Ex. Kossi Adjovi" placeholderTextColor={colors.outline} autoCapitalize="words" maxLength={80} />
              </View>
              <View style={styles.labelRow}>
                <Text style={styles.fieldLabel}>Numéro de téléphone</Text>
                <Text style={styles.count}>{phoneDigits.length}/10</Text>
              </View>
              <View style={[styles.field, isValidBeninPhone(phone) && { borderColor: colors.primary }]}>
                <Text style={styles.prefix}>+229</Text>
                <TextInput style={styles.fieldInput} value={phone} onChangeText={(v) => setPhone(formatBeninPhoneInput(v))} placeholder="01 XX XX XX XX" placeholderTextColor={colors.outline} keyboardType="phone-pad" maxLength={14} />
              </View>
              <Text style={styles.fieldLabel}>Note (facultatif)</Text>
              <View style={styles.field}>
                <TextInput style={styles.fieldInput} value={note} onChangeText={setNote} placeholder="Ex. Zone Cotonou" placeholderTextColor={colors.outline} maxLength={300} />
              </View>
              <Pressable style={[styles.primary, !canCreate && { opacity: 0.5 }]} disabled={!canCreate} onPress={submitCreate}>
                {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryText}>Créer le commercial</Text>}
              </Pressable>
              <Pressable style={styles.cancel} onPress={() => setCreating(false)}>
                <Text style={styles.cancelText}>Annuler</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Rattacher un prestataire existant */}
      <Modal visible={attaching} transparent animationType="fade" onRequestClose={() => setAttaching(false)}>
        <View style={styles.backdrop}>
          <ScrollView contentContainerStyle={styles.modalWrap} keyboardShouldPersistTaps="handled">
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Rattacher un prestataire</Text>
              <Text style={styles.modalSub}>Numéro d'un Speeder, d'une agence, d'un livreur express ou d'un coursier déjà inscrit et sans commercial.</Text>
              <View style={[styles.field, isValidBeninPhone(attachPhone) && { borderColor: colors.primary }]}>
                <Text style={styles.prefix}>+229</Text>
                <TextInput style={styles.fieldInput} value={attachPhone} onChangeText={(v) => setAttachPhone(formatBeninPhoneInput(v))} placeholder="01 XX XX XX XX" placeholderTextColor={colors.outline} keyboardType="phone-pad" maxLength={14} />
              </View>
              <Pressable style={[styles.primary, (!isValidBeninPhone(attachPhone) || busy) && { opacity: 0.5 }]} disabled={!isValidBeninPhone(attachPhone) || busy} onPress={submitAttach}>
                {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryText}>Rattacher</Text>}
              </Pressable>
              <Pressable style={styles.cancel} onPress={() => setAttaching(false)}>
                <Text style={styles.cancelText}>Annuler</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Count({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.countBox}>
      <Text style={styles.countValue}>{value}</Text>
      <Text style={styles.countLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceContainerLowest, alignItems: "center", justifyContent: "center" },
  title: { ...typography.headlineLg, color: colors.onSurface, fontWeight: "800" },
  subtitle: { ...typography.bodySm, color: colors.onSurfaceVariant },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.primary, paddingHorizontal: 14, height: 40, borderRadius: radius.full },
  addText: { ...typography.labelLg, color: "#fff", fontWeight: "800" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
  errorCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.errorContainer, borderRadius: radius.lg, padding: spacing.sm + 2 },
  errorText: { ...typography.bodyMd, color: colors.error, flex: 1 },
  link: { ...typography.labelMd, color: colors.primary, fontWeight: "800" },
  empty: { alignItems: "center", gap: spacing.xs, paddingVertical: spacing.xl },
  emptyTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  emptyText: { ...typography.bodyMd, color: colors.onSurfaceVariant, textAlign: "center" },
  card: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.surfaceContainer },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center" },
  cardName: { ...typography.labelLg, color: colors.onSurface, fontWeight: "800" },
  cardSub: { ...typography.bodySm, color: colors.onSurfaceVariant },
  off: { backgroundColor: colors.errorContainer, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  offText: { ...typography.labelSm, color: colors.error, fontWeight: "800" },
  counts: { flexDirection: "row", gap: spacing.xs },
  countBox: { flex: 1, alignItems: "center", backgroundColor: colors.primaryFixed, borderRadius: radius.lg, paddingVertical: 6 },
  countValue: { ...typography.headlineSm, color: colors.onPrimaryFixed, fontWeight: "800" },
  countLabel: { ...typography.bodySm, color: colors.onPrimaryFixed, fontSize: 11 },
  actions: { flexDirection: "row", gap: spacing.sm },
  action: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderRadius: radius.full, backgroundColor: colors.surfaceContainerLowest, borderWidth: 1, borderColor: colors.surfaceContainerHigh },
  actionText: { ...typography.labelMd, color: colors.primary, fontWeight: "800" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center" },
  modalWrap: { flexGrow: 1, justifyContent: "center", padding: spacing.lg },
  modalCard: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.xl, padding: spacing.md, gap: spacing.sm },
  modalTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  modalSub: { ...typography.bodySm, color: colors.onSurfaceVariant },
  fieldLabel: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  count: { ...typography.bodySm, color: colors.onSurfaceVariant },
  field: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1.5, borderColor: colors.surfaceContainerHigh, borderRadius: radius.lg, paddingHorizontal: spacing.sm + 2, height: 48, backgroundColor: colors.surface },
  prefix: { ...typography.labelLg, color: colors.onSurfaceVariant, fontWeight: "700" },
  fieldInput: { flex: 1, ...typography.bodyLg, color: colors.onSurface },
  primary: { height: 50, borderRadius: radius.full, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", marginTop: spacing.xs },
  primaryText: { ...typography.labelLg, color: "#fff", fontWeight: "800" },
  cancel: { alignItems: "center", paddingVertical: spacing.sm },
  cancelText: { ...typography.labelLg, color: colors.primary, fontWeight: "700" },
});
