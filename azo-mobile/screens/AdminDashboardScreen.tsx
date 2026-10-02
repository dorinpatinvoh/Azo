import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
  AdminAuditEvent,
  AdminGlobalStats,
  AdminUserItem,
  adminApi,
  errorMessage,
} from "../services/api";
import { formatBeninPhoneDisplay } from "../utils/phone";

type Props = {
  onBack: () => void;
  onOpenProviders?: () => void;
};

type Tab = "OVERVIEW" | "USERS" | "AUDIT";

const fcfa = (n: number) => `${n.toLocaleString("fr-FR")} F`;

export default function AdminDashboardScreen({ onBack, onOpenProviders }: Props) {
  const [tab, setTab] = useState<Tab>("OVERVIEW");
  const [stats, setStats] = useState<AdminGlobalStats | null>(null);
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [audit, setAudit] = useState<AdminAuditEvent[]>([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [sRes, uRes, aRes] = await Promise.allSettled([
        adminApi.stats(),
        adminApi.users({ q: search.trim() || undefined, role: roleFilter || undefined }),
        adminApi.auditLog(),
      ]);
      if (sRes.status === "fulfilled") setStats(sRes.value);
      if (uRes.status === "fulfilled") setUsers(uRes.value);
      if (aRes.status === "fulfilled") setAudit(aRes.value);
      if (sRes.status === "rejected" && uRes.status === "rejected") {
        setError(errorMessage(sRes.reason));
      } else {
        setError(null);
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [search, roleFilter]);

  useEffect(() => {
    let alive = true;
    load().finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function toggleBlockUser(u: AdminUserItem) {
    const nextStatus = u.status === "BLOCKED" ? "ACTIVE" : "BLOCKED";
    const label = u.fullName || formatBeninPhoneDisplay(u.phone);
    Alert.alert(
      nextStatus === "BLOCKED" ? `Bloquer ${label}` : `Réactiver ${label}`,
      nextStatus === "BLOCKED"
        ? "Cet utilisateur ne pourra plus utiliser l'application tant que son compte reste bloqué."
        : "Le compte de cet utilisateur redeviendra actif immédiatement.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: nextStatus === "BLOCKED" ? "Bloquer" : "Réactiver",
          style: nextStatus === "BLOCKED" ? "destructive" : "default",
          onPress: async () => {
            setBusyUserId(u.id);
            try {
              await adminApi.setUserStatus(u.id, nextStatus);
              await load();
            } catch (e) {
              Alert.alert("Action impossible", errorMessage(e));
            } finally {
              setBusyUserId(null);
            }
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.iconButton} accessibilityLabel="Retour">
          <MaterialIcons name="arrow-back-ios-new" size={18} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Pilotage administrateur
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            Supervision globale AZƆ̀ Bénin
          </Text>
        </View>
        {onOpenProviders ? (
          <Pressable style={styles.providersBtn} onPress={onOpenProviders}>
            <MaterialIcons name="verified-user" size={15} color="#fff" />
            <Text style={styles.providersBtnText}>
              Dossiers{stats?.providersPending ? ` (${stats.providersPending})` : ""}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* Onglets fixes — ne s'étirent jamais verticalement */}
      <View style={styles.tabBarWrapper}>
        {(
          [
            ["OVERVIEW", "Vue d'ensemble", "analytics"],
            ["USERS", `Comptes (${users.length})`, "group"],
            ["AUDIT", "Journal d'audit", "history"],
          ] as const
        ).map(([id, label, icon]) => {
          const active = tab === id;
          return (
            <Pressable
              key={id}
              style={[styles.tabPill, active && styles.tabPillActive]}
              onPress={() => setTab(id)}
            >
              <MaterialIcons
                name={icon}
                size={16}
                color={active ? colors.primary : colors.onSurfaceVariant}
              />
              <Text style={[styles.tabPillText, active && styles.tabPillTextActive]} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
          keyboardShouldPersistTaps="handled"
        >
          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {tab === "OVERVIEW" && (
            <>
              <View style={styles.statsGrid}>
                <View style={styles.statCard}>
                  <MaterialIcons name="group" size={20} color={colors.primary} />
                  <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                    {stats?.users ?? 0}
                  </Text>
                  <Text style={styles.statLabel}>Utilisateurs inscrits</Text>
                  <Text style={styles.statDelta}>
                    {stats?.blockedUsers ? `${stats.blockedUsers} bloqué(s)` : "Tous actifs"}
                  </Text>
                </View>

                <View style={styles.statCard}>
                  <MaterialIcons name="two-wheeler" size={20} color={colors.primary} />
                  <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                    {stats?.rides ?? 0}
                  </Text>
                  <Text style={styles.statLabel}>Courses Zem & Voiture</Text>
                  <Text style={styles.statDelta}>{stats?.completedRides ?? 0} terminée(s)</Text>
                </View>

                <View style={styles.statCard}>
                  <MaterialIcons name="local-shipping" size={20} color={colors.primary} />
                  <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                    {stats?.deliveries ?? 0}
                  </Text>
                  <Text style={styles.statLabel}>Missions Coursiers</Text>
                  <Text style={styles.statDelta}>{stats?.completedDeliveries ?? 0} livrée(s)</Text>
                </View>

                <View style={styles.statCard}>
                  <MaterialIcons name="receipt-long" size={20} color={colors.primary} />
                  <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                    {fcfa(stats?.commissionsRevenue ?? 0)}
                  </Text>
                  <Text style={styles.statLabel}>Commissions AZƆ̀</Text>
                  <Text style={styles.statDelta}>{stats?.agencies ?? 0} agence(s) active(s)</Text>
                </View>
              </View>

              {/* Carte d'accès rapide à la console de validation KYC */}
              {onOpenProviders ? (
                <Pressable style={styles.kycActionCard} onPress={onOpenProviders}>
                  <View style={styles.kycActionIcon}>
                    <MaterialIcons name="verified-user" size={24} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.kycActionTitle}>Validation des dossiers prestataires</Text>
                    <Text style={styles.kycActionSub}>
                      {stats?.providersPending ?? 0} dossier(s) en attente · {stats?.providersApproved ?? 0}{" "}
                      prestataire(s) validé(s)
                    </Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={24} color={colors.primary} />
                </Pressable>
              ) : null}

              <Text style={styles.sectionTitle}>Raccourcis de gestion</Text>
              <View style={styles.managementGrid}>
                <Pressable style={styles.managementTile} onPress={() => setTab("USERS")}>
                  <View style={styles.managementIcon}>
                    <MaterialIcons name="group" size={22} color={colors.primary} />
                  </View>
                  <Text style={styles.managementLabel}>Utilisateurs</Text>
                </Pressable>

                {onOpenProviders ? (
                  <Pressable style={styles.managementTile} onPress={onOpenProviders}>
                    <View style={styles.managementIcon}>
                      <MaterialIcons name="badge" size={22} color={colors.primary} />
                    </View>
                    <Text style={styles.managementLabel}>Prestataires</Text>
                  </Pressable>
                ) : null}

                <Pressable
                  style={styles.managementTile}
                  onPress={() => {
                    setRoleFilter("AGENCY");
                    setTab("USERS");
                  }}
                >
                  <View style={styles.managementIcon}>
                    <MaterialIcons name="apartment" size={22} color={colors.primary} />
                  </View>
                  <Text style={styles.managementLabel}>Agences</Text>
                </Pressable>

                <Pressable style={styles.managementTile} onPress={() => setTab("AUDIT")}>
                  <View style={styles.managementIcon}>
                    <MaterialIcons name="history" size={22} color={colors.primary} />
                  </View>
                  <Text style={styles.managementLabel}>Journal d'audit</Text>
                </Pressable>
              </View>
            </>
          )}

          {tab === "USERS" && (
            <>
              <View style={styles.searchBox}>
                <MaterialIcons name="search" size={20} color={colors.outline} />
                <TextInput
                  style={styles.searchInput}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Rechercher par nom ou téléphone (01…)"
                  placeholderTextColor={colors.outline}
                />
                {search ? (
                  <Pressable onPress={() => setSearch("")}>
                    <MaterialIcons name="close" size={18} color={colors.outline} />
                  </Pressable>
                ) : null}
              </View>

              <View style={styles.roleFilterRow}>
                {(
                  [
                    ["", "Tous"],
                    ["CLIENT", "Clients"],
                    ["DRIVER", "Zem / Coursiers"],
                    ["AGENCY", "Agences"],
                    ["ADMIN", "Admins"],
                  ] as const
                ).map(([id, label]) => {
                  const active = roleFilter === id;
                  return (
                    <Pressable
                      key={id || "ALL"}
                      style={[styles.roleChip, active && styles.roleChipActive]}
                      onPress={() => setRoleFilter(id)}
                    >
                      <Text style={[styles.roleChipText, active && styles.roleChipTextActive]}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {users.map((u) => {
                const blocked = u.status === "BLOCKED";
                return (
                  <View key={u.id} style={styles.userCard}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.userName} numberOfLines={1}>
                        {u.fullName || formatBeninPhoneDisplay(u.phone)}
                      </Text>
                      <Text style={styles.userMeta} numberOfLines={1}>
                        {formatBeninPhoneDisplay(u.phone)} · {u.role}
                        {u.provider ? ` (${u.provider.type} · ${u.provider.status})` : ""}
                      </Text>
                      <Text style={styles.userMeta}>
                        Solde : {fcfa(u.wallet?.balance ?? 0)}
                        {u.agency ? ` · Flotte : ${u.agency.name}` : ""}
                      </Text>
                    </View>
                    {u.role !== "ADMIN" ? (
                      <Pressable
                        style={[styles.blockBtn, blocked && styles.unblockBtn]}
                        disabled={busyUserId === u.id}
                        onPress={() => toggleBlockUser(u)}
                      >
                        {busyUserId === u.id ? (
                          <ActivityIndicator size="small" color={blocked ? "#146C2E" : colors.error} />
                        ) : (
                          <Text style={[styles.blockBtnText, blocked && { color: "#146C2E" }]}>
                            {blocked ? "Débloquer" : "Bloquer"}
                          </Text>
                        )}
                      </Pressable>
                    ) : (
                      <View style={styles.adminTag}>
                        <Text style={styles.adminTagText}>ADMIN</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </>
          )}

          {tab === "AUDIT" && (
            <View style={styles.auditCard}>
              <Text style={styles.sectionTitle}>Dernières actions enregistrées</Text>
              {audit.length === 0 ? (
                <Text style={styles.muted}>Aucun événement enregistré pour l'instant.</Text>
              ) : (
                audit.map((ev) => (
                  <View key={ev.id} style={styles.auditRow}>
                    <View style={styles.auditDot} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.auditTitle}>
                        {ev.provider.name} ({ev.provider.type}) — {ev.type}
                      </Text>
                      {ev.comment ? <Text style={styles.auditComment}>{ev.comment}</Text> : null}
                      <Text style={styles.auditDate}>
                        {new Date(ev.createdAt).toLocaleString("fr-FR")} ·{" "}
                        {formatBeninPhoneDisplay(ev.provider.phone)}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    height: 58,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainer,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  headerSub: { ...typography.labelSm, color: colors.onSurfaceVariant },
  providersBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    height: 36,
    borderRadius: radius.full,
  },
  providersBtnText: { ...typography.labelSm, color: "#fff", fontWeight: "800" },

  tabBarWrapper: {
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  tabPill: {
    flex: 1,
    height: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerLow,
    paddingHorizontal: 8,
  },
  tabPillActive: {
    backgroundColor: colors.primaryFixed,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  tabPillText: { ...typography.labelSm, color: colors.onSurfaceVariant, fontWeight: "700" },
  tabPillTextActive: { color: colors.primary, fontWeight: "800" },

  scroll: { padding: spacing.md, paddingBottom: 100 },
  errorText: { ...typography.bodySm, color: colors.error, textAlign: "center", marginBottom: spacing.sm },
  muted: { ...typography.bodySm, color: colors.onSurfaceVariant, textAlign: "center" },

  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  statCard: {
    width: "48%",
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.sm + 2,
    gap: 2,
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
  },
  statValue: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800", marginTop: 2 },
  statLabel: { ...typography.labelSm, color: colors.onSurfaceVariant },
  statDelta: { ...typography.labelSm, color: colors.primary, fontWeight: "700" },

  kycActionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.primaryFixed,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  kycActionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  kycActionTitle: { ...typography.labelLg, color: colors.onSurface, fontWeight: "800" },
  kycActionSub: { ...typography.labelSm, color: colors.onPrimaryFixed, marginTop: 2 },

  sectionTitle: {
    ...typography.headlineSm,
    color: colors.onSurface,
    fontWeight: "700",
    marginBottom: spacing.sm,
  },
  managementGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  managementTile: {
    width: "48%",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
  },
  managementIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primaryFixed,
    alignItems: "center",
    justifyContent: "center",
  },
  managementLabel: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700", flex: 1 },

  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 46,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
    marginBottom: spacing.sm,
  },
  searchInput: { flex: 1, ...typography.bodyMd, color: colors.onSurface },
  roleFilterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: spacing.md,
  },
  roleChip: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: "center",
    justifyContent: "center",
  },
  roleChipActive: { backgroundColor: colors.primary },
  roleChipText: { ...typography.labelSm, color: colors.onSurfaceVariant, fontWeight: "700" },
  roleChipTextActive: { color: "#fff" },

  userCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.sm + 4,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
  },
  userName: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
  userMeta: { ...typography.labelSm, color: colors.onSurfaceVariant, marginTop: 2 },
  blockBtn: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
  },
  unblockBtn: { borderColor: "#146C2E", backgroundColor: "#D7F0DC" },
  blockBtnText: { ...typography.labelSm, color: colors.error, fontWeight: "800" },
  adminTag: {
    backgroundColor: colors.primaryFixed,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  adminTagText: { ...typography.labelSm, color: colors.primary, fontWeight: "800" },

  auditCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
  },
  auditRow: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.surfaceContainer,
  },
  auditDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginTop: 6,
  },
  auditTitle: { ...typography.labelMd, color: colors.onSurface, fontWeight: "700" },
  auditComment: { ...typography.bodySm, color: colors.onSurfaceVariant, marginTop: 1 },
  auditDate: { ...typography.labelSm, color: colors.outline, marginTop: 2 },
});
