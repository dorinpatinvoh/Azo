import React, { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  Image,
  FlatList,
  Pressable,
  StyleSheet,
  Animated,
  useWindowDimensions,
  type ImageSourcePropType,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, spacing } from "../theme/colors";
import { typography } from "../theme/typography";
import PrimaryButton from "../components/PrimaryButton";
import { useI18n, type MessageKey } from "../i18n";

type Props = {
  /** Appelé par « Commencer » et par « Passer » : l'onboarding est alors considéré comme vu. */
  onStart: () => void;
};

/**
 * Mémorise sur le téléphone que l'onboarding a été vu : il ne s'affiche qu'à la première
 * ouverture (voir App.tsx). Valeur lue par `App.tsx`, écrite quand l'utilisateur le termine.
 */
export const ONBOARDING_SEEN_KEY = "onboardingSeen";

type Slide = {
  id: string;
  /** Clé de traduction de la phrase d'accroche (courte) */
  titleKey: MessageKey;
  /** Clé de traduction de la ligne qui précise la promesse */
  subtitleKey: MessageKey;
  image: ImageSourcePropType;
};

/**
 * Les trois pages. Pour changer une image : remplacer le `require(...)` ; pour changer un
 * texte : modifier la clé `onboarding.slideN.*` dans i18n/fr.ts (et dans les autres langues). Chaque promesse correspond à une fonction réelle de
 * l'application (commande rapide, chauffeurs vérifiés + code de sécurité, Zem électrique).
 */
const SLIDES: Slide[] = [
  {
    id: "zem",
    titleKey: "onboarding.slide1.title",
    subtitleKey: "onboarding.slide1.subtitle",
    image: require("../assets/zem-essence.jpg"),
  },
  {
    id: "confiance",
    titleKey: "onboarding.slide2.title",
    subtitleKey: "onboarding.slide2.subtitle",
    image: require("../assets/zem-essence1.jpg"),
  },
  {
    id: "electrique",
    titleKey: "onboarding.slide3.title",
    subtitleKey: "onboarding.slide3.subtitle",
    image: require("../assets/moto-electrique.png"),
  },
];

const LAST = SLIDES.length - 1;

export default function SplashScreen({ onStart }: Props) {
  const { t } = useI18n();
  const { width, height } = useWindowDimensions();
  // Cadre photo en portrait 3:4, borné par la hauteur de l'écran (petits téléphones).
  const cardHeight = Math.min(Math.round(width * 0.78 * (4 / 3)), Math.round(height * 0.46));
  const cardWidth = Math.round(cardHeight * (3 / 4));

  const listRef = useRef<FlatList<Slide>>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const [index, setIndex] = useState(0);
  const isLast = index === LAST;

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => scrollX.setValue(e.nativeEvent.contentOffset.x),
    [scrollX]
  );
  // La page affichée est connue à la fin du glissement, pas pendant.
  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) =>
      setIndex(Math.round(e.nativeEvent.contentOffset.x / width)),
    [width]
  );

  const goNext = () => {
    if (isLast) onStart();
    else listRef.current?.scrollToIndex({ index: index + 1, animated: true });
  };

  return (
    // Fond sombre de la charte : violet profond qui s'éclaircit vers le bas.
    <LinearGradient
      colors={[colors.onPrimaryFixed, colors.onPrimaryFixed, colors.primary]}
      locations={[0, 0.55, 1]}
      style={styles.root}
    >
      {/* Fond sombre : l'heure et la batterie doivent être en clair */}
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Text style={styles.brand}>AZƆ̀</Text>
          {/* Toujours présent (invisible à la dernière page) : la mise en page ne saute pas */}
          <Pressable
            onPress={onStart}
            disabled={isLast}
            style={[styles.skip, isLast && styles.skipHidden]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("onboarding.skipLabel")}
          >
            <Text style={styles.skipText}>{t("common.skip")}</Text>
          </Pressable>
        </View>

        <FlatList
          ref={listRef}
          data={SLIDES}
          keyExtractor={(slide) => slide.id}
          horizontal
          pagingEnabled
          bounces={false}
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={onScroll}
          onMomentumScrollEnd={onMomentumEnd}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          renderItem={({ item }) => (
            <View style={[styles.page, { width }]}>
              <View style={[styles.photoCard, { width: cardWidth, height: cardHeight }]}>
                <Image
                  source={item.image}
                  style={styles.photo}
                  resizeMode="cover"
                  accessibilityLabel={t(item.titleKey)}
                />
              </View>
              <View style={styles.texts}>
                <Text style={styles.title}>{t(item.titleKey)}</Text>
                <Text style={styles.subtitle}>{t(item.subtitleKey)}</Text>
              </View>
            </View>
          )}
        />

        <View style={styles.dock}>
          <View style={styles.dots} accessibilityLabel={t("onboarding.page", { current: index + 1, total: SLIDES.length })}>
            {SLIDES.map((slide, i) => {
              const range = [(i - 1) * width, i * width, (i + 1) * width];
              const dotWidth = scrollX.interpolate({ inputRange: range, outputRange: [8, 26, 8], extrapolate: "clamp" });
              const dotOpacity = scrollX.interpolate({ inputRange: range, outputRange: [0.35, 1, 0.35], extrapolate: "clamp" });
              return <Animated.View key={slide.id} style={[styles.dot, { width: dotWidth, opacity: dotOpacity }]} />;
            })}
          </View>
          <PrimaryButton label={isLast ? t("common.start") : t("common.next")} onPress={goNext} />
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  brand: { ...typography.displayLgMobile, color: colors.onPrimary, fontSize: 28, lineHeight: 34, letterSpacing: 1.5 },
  skip: {
    paddingHorizontal: spacing.md,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: `${colors.onPrimary}26`,
    alignItems: "center",
    justifyContent: "center",
  },
  skipHidden: { opacity: 0 },
  skipText: { ...typography.labelMd, color: colors.onPrimary },

  page: { alignItems: "center", paddingTop: spacing.md, gap: spacing.lg },
  photoCard: {
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: colors.primaryContainer,
    borderWidth: 1.5,
    borderColor: `${colors.onPrimary}33`,
    elevation: 10,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
  },
  photo: { width: "100%", height: "100%" },
  texts: { paddingHorizontal: spacing.xl, alignItems: "center", gap: spacing.xs },
  title: { ...typography.headlineLg, color: colors.onPrimary, textAlign: "center" },
  subtitle: { ...typography.bodyLg, color: `${colors.onPrimary}D9`, textAlign: "center" },

  dock: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.lg },
  dots: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 10 },
  dot: { height: 8, borderRadius: 4, backgroundColor: colors.onPrimary },
});
