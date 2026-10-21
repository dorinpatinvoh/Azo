import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";

type Props = { onLogout: () => void };

/** L'administration d'AZƆ̀ se fait sur la console web, plus dans l'application : un compte administrateur qui s'y connecte est orienté vers elle. */
export default function AdminOnWebScreen({ onLogout }: Props) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.box}>
        <View style={styles.icon}>
          <MaterialIcons name="desktop-windows" size={34} color={colors.primary} />
        </View>
        <Text style={styles.title}>L'administration est sur la console web</Text>
        <Text style={styles.body}>
          Les dossiers, les finances, les clients, les commerciaux et le support se gèrent depuis un ordinateur, sur la console web AZƆ̀. Cette application est réservée aux clients, aux Speeders, aux coursiers, aux agences et aux commerciaux.
        </Text>
        <Pressable style={styles.btn} onPress={onLogout} accessibilityRole="button">
          <Text style={styles.btnText}>Se déconnecter</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  box: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg, gap: spacing.md },
  icon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center" },
  title: { ...typography.headlineMd, color: colors.onSurface, fontWeight: "800", textAlign: "center" },
  body: { ...typography.bodyMd, color: colors.onSurfaceVariant, textAlign: "center", lineHeight: 22 },
  btn: { marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.full, paddingVertical: 14, paddingHorizontal: 28 },
  btnText: { ...typography.labelLg, color: "#fff", fontWeight: "800" },
});
