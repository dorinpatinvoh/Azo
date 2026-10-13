import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import { useI18n, type MessageKey } from "../i18n";

export type ClientTab = "home" | "courses" | "messages" | "wallet" | "profile";

type IconName = keyof typeof Ionicons.glyphMap;

// Icône « contour » pour les onglets inactifs, « pleine » pour l'onglet actif.
const NAV_ITEMS: { id: ClientTab; labelKey: MessageKey; icon: IconName; iconActive: IconName }[] = [
  { id: "home", labelKey: "tabs.home", icon: "home-outline", iconActive: "home" },
  { id: "courses", labelKey: "tabs.courses", icon: "receipt-outline", iconActive: "receipt" },
  { id: "messages", labelKey: "tabs.messages", icon: "chatbubble-ellipses-outline", iconActive: "chatbubble-ellipses" },
  { id: "wallet", labelKey: "tabs.wallet", icon: "wallet-outline", iconActive: "wallet" },
  { id: "profile", labelKey: "tabs.profile", icon: "person-outline", iconActive: "person" },
];

type Props = { active: ClientTab; onNavigate?: (tab: ClientTab) => void };

/**
 * Barre de navigation « flottante » : une pilule sombre aux couleurs de la charte (violet profond),
 * l'onglet actif s'élargit en pilule blanche avec son libellé à côté de l'icône.
 * Placée dans le flux de l'écran (pas en position absolue) : elle ne masque jamais le contenu.
 */
export default function ClientTabBar({ active, onNavigate }: Props) {
  const { t } = useI18n();
  return (
    <View style={styles.wrap}>
      <View style={styles.bar} accessibilityRole="tablist">
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === active;
          return (
            <Pressable
              key={item.id}
              style={isActive ? styles.itemActive : styles.item}
              onPress={() => !isActive && onNavigate?.(item.id)}
              hitSlop={{ top: 6, bottom: 6 }}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={t(item.labelKey)}
            >
              <Ionicons
                name={isActive ? item.iconActive : item.icon}
                size={19}
                color={isActive ? colors.primary : colors.onPrimary}
              />
              <Text style={isActive ? styles.labelActive : styles.label} numberOfLines={1}>
                {t(item.labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Marge autour de la pilule : elle « flotte » au-dessus du fond de l'écran.
  wrap: { paddingHorizontal: spacing.md, paddingTop: 4, paddingBottom: 6, backgroundColor: colors.background },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    height: 52,
    paddingHorizontal: 4,
    borderRadius: radius.full,
    backgroundColor: colors.onPrimaryFixed,
    elevation: 8,
    shadowColor: colors.onPrimaryFixed,
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  // Onglet inactif : icône au-dessus du libellé, blanc sur le fond sombre.
  item: { flex: 1, alignItems: "center", justifyContent: "center", gap: 1 },
  label: { ...typography.labelSm, fontSize: 9, color: colors.onPrimary, opacity: 0.9 },
  // Onglet actif : pilule blanche, icône et libellé côte à côte aux couleurs de la marque.
  itemActive: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 40,
    paddingHorizontal: spacing.sm + 4,
    borderRadius: radius.full,
    backgroundColor: colors.onPrimary,
  },
  labelActive: { ...typography.labelMd, fontSize: 12, color: colors.primary, fontWeight: "700" },
});
