import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, spacing } from "../theme/colors";
import { typography } from "../theme/typography";

export type ClientTab = "home" | "courses" | "wallet" | "profile";

const NAV_ITEMS: { id: ClientTab; label: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { id: "home", label: "Accueil", icon: "home" },
  { id: "courses", label: "Courses", icon: "receipt-long" },
  { id: "wallet", label: "Wallet", icon: "account-balance-wallet" },
  { id: "profile", label: "Profil", icon: "person" },
];

type Props = { active: ClientTab; onNavigate?: (tab: ClientTab) => void };

export default function ClientTabBar({ active, onNavigate }: Props) {
  return (
    <View style={styles.bar}>
      {NAV_ITEMS.map((item) => {
        const isActive = item.id === active;
        return (
          <Pressable
            key={item.id}
            style={styles.item}
            onPress={() => !isActive && onNavigate?.(item.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={item.label}
          >
            <View style={[styles.iconWrap, isActive && { backgroundColor: colors.primaryFixed }]}>
              <MaterialIcons name={item.icon} size={24} color={isActive ? colors.primary : colors.outline} />
            </View>
            <Text style={[styles.label, isActive && { color: colors.primary, fontWeight: "700" }]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", justifyContent: "space-around", paddingTop: 8, paddingBottom: spacing.md, borderTopWidth: 1, borderTopColor: colors.surfaceContainer, backgroundColor: colors.surfaceContainerLowest },
  item: { alignItems: "center", gap: 4, flex: 1 },
  iconWrap: { width: 44, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  label: { ...typography.labelSm, color: colors.outline, fontSize: 10 },
});
