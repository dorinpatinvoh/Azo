import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";

const ZONES = [
  { name: "Dantokpa", level: "+200 FCFA", hot: true },
  { name: "Cadjehoun", level: "Élevé", hot: true },
  { name: "Ganhi", level: "Normal", hot: false },
];

type Props = { onBack: () => void };

export default function DriverHomeScreen({ onBack }: Props) {
  const [online, setOnline] = useState(true);
  const watchIdRef = useRef<number | null>(null);
  const socketRef = useRef<any>(null);

  useEffect(() => {
    let mounted = true;
    if (!online) {
      // stop tracking
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      if (socketRef.current) socketRef.current.disconnect();
      return;
    }

    (async () => {
      const { connectSocket, getSocket } = await import("../src/services/socket");
      const base = "http://localhost:3000"; // TODO: config
      const sock = connectSocket(base);
      socketRef.current = sock;

      // join a generic driver channel if needed
      // start watching location
      if (navigator && navigator.geolocation) {
        const id = navigator.geolocation.watchPosition(
          (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            sock.emit("driver:location", { rideId: "", lat, lng });
          },
          (err) => console.warn("geo err", err),
          { enableHighAccuracy: true, distanceFilter: 5 }
        );
        watchIdRef.current = id as unknown as number;
      }
    })();

    return () => {
      mounted = false;
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [online]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.iconButton}>
          <MaterialIcons name="arrow-back-ios-new" size={18} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Zém Radar</Text>
        <View style={styles.onlineToggle}>
          <Text style={[styles.onlineLabel, { color: online ? colors.primary : colors.outline }]}>
            {online ? "En ligne" : "Hors ligne"}
          </Text>
          <Switch
            value={online}
            onValueChange={setOnline}
            trackColor={{ true: colors.primaryContainer, false: colors.surfaceContainer }}
            thumbColor="#fff"
          />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <View style={styles.motorcycleIcon}>
              <MaterialIcons name="two-wheeler" size={26} color={colors.onPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.statusTitle}>Prêt à rouler</Text>
              <Text style={styles.statusSubtitle}>En ligne • Secteur Haie Vive</Text>
            </View>
          </View>
        </View>

        <View style={styles.earningsCard}>
          <Text style={styles.earningsLabel}>Gains du jour · Cotonou</Text>
          <Text style={styles.earningsValue}>18 450 FCFA</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: "84%" }]} />
          </View>
          <Text style={styles.progressLabel}>Objectif : 18 450 / 22 000 FCFA · 84%</Text>
        </View>

        <View style={styles.statsGrid}>
          <StatTile icon="local-taxi" value="12" label="Courses" />
          <StatTile icon="thumb-up" value="98%" label="Acceptation" />
          <StatTile icon="star" value="4.95" label="Évaluation" />
        </View>

        <Pressable style={styles.withdrawBtn}>
          <MaterialIcons name="bolt" size={18} color={colors.onPrimary} />
          <Text style={styles.withdrawText}>Retrait Express MoMo (+229 97 •• 42)</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>Radar affluence urbaine</Text>
        <View style={{ gap: spacing.sm }}>
          {ZONES.map((z) => (
            <View key={z.name} style={styles.zoneRow}>
              <View style={styles.zoneLeft}>
                {z.hot && <MaterialIcons name="local-fire-department" size={16} color={colors.secondary} />}
                <Text style={styles.zoneName}>{z.name}</Text>
              </View>
              <Text style={[styles.zoneLevel, z.hot && { color: colors.secondary, fontWeight: "700" }]}>
                {z.level}
              </Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Activité récente</Text>
        <View style={styles.tripRow}>
          <MaterialIcons name="two-wheeler" size={18} color={colors.onSurfaceVariant} />
          <Text style={styles.tripText}>Haie Vive → Dantokpa · 10:42</Text>
          <Text style={styles.tripAmount}>+650 F</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatTile({ icon, value, label }: { icon: keyof typeof MaterialIcons.glyphMap; value: string; label: string }) {
  return (
    <View style={styles.statTile}>
      <MaterialIcons name={icon} size={18} color={colors.primary} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { height: 56, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  iconButton: { width: 40, height: 40, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...typography.headlineSm, color: colors.onSurface },
  onlineToggle: { flexDirection: "row", alignItems: "center", gap: 6 },
  onlineLabel: { ...typography.labelSm, fontWeight: "700" },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  statusCard: { backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  motorcycleIcon: { width: 48, height: 48, borderRadius: radius.full, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  statusTitle: { ...typography.labelLg, color: colors.onSurface, fontWeight: "700" },
  statusSubtitle: { ...typography.bodySm, color: colors.onSurfaceVariant },
  earningsCard: { backgroundColor: colors.primaryFixed, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  earningsLabel: { ...typography.labelMd, color: colors.onPrimaryFixed },
  earningsValue: { ...typography.displayLgMobile, color: colors.onPrimaryFixed, marginTop: 2, marginBottom: spacing.sm },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.5)", overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: colors.primary },
  progressLabel: { ...typography.labelSm, color: colors.onPrimaryFixed, marginTop: 6 },
  statsGrid: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  statTile: { flex: 1, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.lg, padding: spacing.sm, alignItems: "center", gap: 2, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  statValue: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "800" },
  statLabel: { ...typography.labelSm, color: colors.onSurfaceVariant },
  withdrawBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.secondary, borderRadius: radius.md, paddingVertical: 12, marginBottom: spacing.md },
  withdrawText: { ...typography.labelMd, color: colors.onSecondary, fontWeight: "700" },
  sectionTitle: { ...typography.headlineSm, color: colors.onSurface, fontWeight: "700", marginBottom: spacing.sm, marginTop: spacing.sm },
  zoneRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: colors.surfaceContainerLow, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  zoneLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  zoneName: { ...typography.labelMd, color: colors.onSurface, fontWeight: "600" },
  zoneLevel: { ...typography.labelMd, color: colors.onSurfaceVariant },
  tripRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceContainerLowest, borderRadius: radius.md, padding: spacing.md },
  tripText: { ...typography.labelMd, color: colors.onSurface, flex: 1 },
  tripAmount: { ...typography.labelMd, color: colors.primary, fontWeight: "800" },
});
