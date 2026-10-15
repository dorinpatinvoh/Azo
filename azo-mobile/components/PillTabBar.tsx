import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, Keyboard, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";

type IconName = keyof typeof Ionicons.glyphMap;

export type PillTabItem<T extends string> = { id: T; label: string; icon: IconName; iconActive: IconName };

type Props<T extends string> = { items: PillTabItem<T>[]; active: T; onNavigate: (id: T) => void };

/**
 * Barre de navigation du bas des espaces professionnels (Speeder, coursier…) : même pilule sombre que celle du client,
 * avec des onglets au choix. Placée dans le flux de l'écran, au-dessus de la barre système (zone sûre gérée par l'écran).
 */
export default function PillTabBar<T extends string>({ items, active, onNavigate }: Props<T>) {
  // Clavier ouvert (saisie d'un code…) : la barre se masque au lieu de remonter au-dessus du clavier
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => setKeyboardOpen(true));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  if (keyboardOpen) return null;
  return (
    <View style={styles.wrap}>
      <View style={styles.bar} accessibilityRole="tablist">
        {items.map((item) => {
          const isActive = item.id === active;
          return (
            <Pressable
              key={item.id}
              style={isActive ? styles.itemActive : styles.item}
              onPress={() => !isActive && onNavigate(item.id)}
              hitSlop={{ top: 6, bottom: 6 }}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={item.label}
            >
              <Ionicons name={isActive ? item.iconActive : item.icon} size={19} color={isActive ? colors.primary : colors.onPrimary} />
              <Text style={isActive ? styles.labelActive : styles.label} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} allowFontScaling={false}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  // Largeurs proportionnelles (l'onglet actif pèse 2,2 fois un onglet inactif) : la barre ne déborde jamais, même avec 5 onglets ou une grande police
  item: { flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center", gap: 1 },
  label: { ...typography.labelSm, fontSize: 9, color: colors.onPrimary, opacity: 0.9 },
  itemActive: {
    flex: 2.2,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    height: 40,
    paddingHorizontal: 6,
    borderRadius: radius.full,
    backgroundColor: colors.onPrimary,
  },
  labelActive: { ...typography.labelMd, fontSize: 12, color: colors.primary, fontWeight: "700" },
});
