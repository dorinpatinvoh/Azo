import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Image,
  StyleSheet,
  Animated,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import PrimaryButton from "../components/PrimaryButton";

type Props = {
  onStart: () => void;
};

// Liste des visuels pour l'effet vidéo / diaporama
const SERVICES = [
  {
    id: "zem",
    title: "Zémidjan & Moto-Taxi",
    subtitle: "Déplacements rapides en ville",
    type: "remote",
    source: "https://www.afrik.com/wp-content/uploads/2021/06/zem.jpg",
  },
  {
    id: "car",
    title: "Transport en Berline",
    subtitle: "Confort et sécurité pour vos trajets",
    type: "remote",
    source: "https://www.amlbenin.com/public/img/big/busextrieur2jpg_66c6207bbb3aa.jpg",
  },
  {
    id: "services",
    title: "Tous nos services AZƆ̀",
    subtitle: "Une seule plateforme, plusieurs solutions",
    type: "local",
    // Chemin relatif depuis screens/ vers assets/
    source: require("../assets/azo-services.jpg"),
  },
];

export default function SplashScreen({ onStart }: Props) {
  const { width } = useWindowDimensions();
  const heroHeight = Math.min(360, width * 0.85);
  const [currentIndex, setCurrentIndex] = useState(0);

  const fadeAnim = useRef(new Animated.Value(1)).current;

  // Animation automatique en boucle (Effet vidéo fluide)
  useEffect(() => {
    const interval = setInterval(() => {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }).start(() => {
        setCurrentIndex((prev) => (prev + 1) % SERVICES.length);
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }).start();
      });
    }, 3500);

    return () => clearInterval(interval);
  }, [fadeAnim]);

  const activeService = SERVICES[currentIndex];

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.container}>
        {/* En-tête : Marque AZƆ̀ + Badge BJ */}
        <View style={styles.headerRow}>
          <Text style={styles.brand}>AZƆ̀</Text>
          <View style={styles.langBadge}>
            <Text style={styles.langText}>BJ</Text>
          </View>
        </View>

        {/* Bloc Visuel Animé */}
        <View style={styles.mainContent}>
          <View style={[styles.heroCard, { height: heroHeight }]}>
            <Animated.View style={[styles.animatedContainer, { opacity: fadeAnim }]}>
              <Image
                source={
                  activeService.type === "local"
                    ? activeService.source
                    : { uri: activeService.source as string }
                }
                style={styles.image}
                resizeMode={activeService.type === "local" ? "contain" : "cover"}
              />
            </Animated.View>

            {/* Légende du service actif */}
            <View style={styles.serviceOverlay}>
              <Text style={styles.serviceTitle}>{activeService.title}</Text>
              <Text style={styles.serviceSubtitle}>{activeService.subtitle}</Text>
            </View>

            {/* Indicateurs de défilement */}
            <View style={styles.indicatorsRow}>
              {SERVICES.map((_, idx) => (
                <View
                  key={idx}
                  style={[
                    styles.indicatorDot,
                    currentIndex === idx && styles.indicatorDotActive,
                  ]}
                />
              ))}
            </View>
          </View>

          {/* Devise officielle */}
          <Text style={styles.tagline}>
            Vos déplacements & livraisons, en toute sérénité.
          </Text>
        </View>

        {/* Bouton d'action principal */}
        <View style={styles.dock}>
          <PrimaryButton label="Commencer" onPress={onStart} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    padding: spacing.lg,
    justifyContent: "space-between",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.xs,
  },
  brand: {
    ...typography.headlineLg,
    color: colors.primary,
    fontWeight: "900",
    fontSize: 28,
    letterSpacing: 1.5,
  },
  langBadge: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: "center",
    justifyContent: "center",
  },
  langText: {
    ...typography.labelSm,
    color: colors.primary,
    fontWeight: "700",
  },
  mainContent: {
    alignItems: "center",
    gap: spacing.md,
  },
  heroCard: {
    width: "100%",
    borderRadius: radius.xl,
    overflow: "hidden",
    backgroundColor: colors.surfaceContainerLow,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 5,
    position: "relative",
  },
  animatedContainer: {
    width: "100%",
    height: "100%",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  serviceOverlay: {
    position: "absolute",
    bottom: 24,
    left: 14,
    right: 14,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.lg,
  },
  serviceTitle: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  serviceSubtitle: {
    color: "rgba(255, 255, 255, 0.8)",
    fontSize: 11,
    marginTop: 2,
  },
  indicatorsRow: {
    position: "absolute",
    bottom: 10,
    alignSelf: "center",
    flexDirection: "row",
    gap: 6,
  },
  indicatorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255, 255, 255, 0.4)",
  },
  indicatorDotActive: {
    width: 18,
    backgroundColor: "#FFFFFF",
  },
  tagline: {
    ...typography.titleMedium,
    color: colors.onSurfaceVariant,
    textAlign: "center",
    fontWeight: "500",
    letterSpacing: 0.3,
  },
  dock: {
    width: "100%",
    paddingBottom: spacing.xs,
  },
});
