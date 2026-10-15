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
  type LayoutChangeEvent,
  type ImageSourcePropType,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
 * l'application (commande rapide, chauffeurs vérifiés + code de sécurité, Speeder électrique).
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
  const { width, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Hauteur réelle de la zone d'affichage (sous la barre d'état et la barre de navigation comprises) : les images la remplissent entièrement
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const pageHeight = measuredHeight || windowHeight;
  const onRootLayout = (e: LayoutChangeEvent) => setMeasuredHeight(Math.round(e.nativeEvent.layout.height));

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
    // Les images occupent TOUT l'écran (derrière la barre d'état et la barre de navigation) ; le texte et les boutons se posent par-dessus
    <View style={styles.root} onLayout={onRootLayout}>
      <StatusBar style="light" />

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
        style={StyleSheet.absoluteFill}
        renderItem={({ item }) => (
          <View style={{ width, height: pageHeight }}>
            <Image source={item.image} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel={t(item.titleKey)} />
            {/* Voile sombre en haut (logo, « Passer ») et en bas (texte, boutons) pour que tout reste lisible */}
            <LinearGradient colors={["rgba(20,0,34,0.65)", "rgba(20,0,34,0)"]} style={[styles.shadeTop, { height: insets.top + 110 }]} pointerEvents="none" />
            <LinearGradient
              colors={["rgba(20,0,34,0)", "rgba(20,0,34,0.82)", "rgba(20,0,34,0.96)"]}
              locations={[0, 0.55, 1]}
              style={[styles.shadeBottom, { height: insets.bottom + 340 }]}
              pointerEvents="none"
            />
            <View style={[styles.texts, { bottom: insets.bottom + 150 }]}>
              <Text style={styles.title}>{t(item.titleKey)}</Text>
              <Text style={styles.subtitle}>{t(item.subtitleKey)}</Text>
            </View>
          </View>
        )}
      />

      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]} pointerEvents="box-none">
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

      <View style={[styles.dock, { paddingBottom: insets.bottom + spacing.md }]} pointerEvents="box-none">
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.onPrimaryFixed },
  shadeTop: { position: "absolute", top: 0, left: 0, right: 0 },
  shadeBottom: { position: "absolute", bottom: 0, left: 0, right: 0 },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  brand: { ...typography.displayLgMobile, color: colors.onPrimary, fontSize: 28, lineHeight: 34, letterSpacing: 1.5 },
  skip: {
    paddingHorizontal: spacing.md,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: "rgba(20,0,34,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  skipHidden: { opacity: 0 },
  skipText: { ...typography.labelMd, color: colors.onPrimary },

  texts: { position: "absolute", left: 0, right: 0, paddingHorizontal: spacing.xl, alignItems: "center", gap: spacing.xs },
  title: { ...typography.headlineLg, color: colors.onPrimary, textAlign: "center" },
  subtitle: { ...typography.bodyLg, color: `${colors.onPrimary}E6`, textAlign: "center" },

  dock: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.lg },
  dots: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 10 },
  dot: { height: 8, borderRadius: 4, backgroundColor: colors.onPrimary },
});
