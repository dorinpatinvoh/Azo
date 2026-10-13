import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";
import { typography } from "../theme/typography";

type Props = { uri: string | null; initials: string; size: number; fontSize?: number };

/** Photo de profil ronde, ou les initiales de la personne tant qu'elle n'a pas de photo. */
export default function Avatar({ uri, initials, size, fontSize }: Props) {
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (uri) return <Image source={{ uri }} style={[styles.image, box]} />;
  return (
    <View style={[styles.fallback, box]}>
      <Text style={[styles.initials, fontSize ? { fontSize } : null]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: colors.primaryFixed },
  fallback: { backgroundColor: colors.primaryFixed, alignItems: "center", justifyContent: "center" },
  initials: { ...typography.headlineLg, color: colors.primary },
});
