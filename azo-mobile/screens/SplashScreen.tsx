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
  /** Mention de la photo (licence libre CC BY-SA 4.0 : l'auteur doit être cité). Absente pour nos propres visuels. */
  credit?: string;
};

/**
 * Les quatre pages. Pour changer une image : remplacer le `require(...)` (photos recadrées en 1080×1240 dans
 * assets/onboarding/) ; pour changer un texte : modifier la clé `onboarding.slideN.*` dans i18n/fr.ts (et dans les autres langues).
 * Chaque promesse correspond à une fonction réelle de l'application : commande rapide, livraison, Speeders vérifiés + code de
 * sécurité, Speeder électrique. Les photos viennent de Wikimedia Commons (CC BY-SA 4.0) : voir CREDITS_PHOTOS.md.
 */
const SLIDES: Slide[] = [
  {
    id: "commande",
    titleKey: "onboarding.slide1.title",
    subtitleKey: "onboarding.slide1.subtitle",
    image: require("../assets/onboarding/commande.jpg"),
    credit: "© Jean-Baptiste Amagbegnon · CC BY-SA 4.0 · Wikimedia Commons",
  },
  {
    id: "livraison",
    titleKey: "onboarding.slide2.title",
    subtitleKey: "onboarding.slide2.subtitle",
    image: require("../assets/onboarding/livraison.jpg"),
    credit: "© DEGAN Gabin · CC BY-SA 4.0 · Wikimedia Commons",
  },
  {
    id: "confiance",
    titleKey: "onboarding.slide3.title",
    subtitleKey: "onboarding.slide3.subtitle",
    image: require("../assets/onboarding/confiance.jpg"),
    credit: "© Oloudare king · CC BY-SA 4.0 · Wikimedia Commons",
  },
  {
    id: "electrique",
    titleKey: "onboarding.slide4.title",
    subtitleKey: "onboarding.slide4.subtitle",
    image: require("../assets/onboarding/electrique.jpg"),
  },
];

const LAST = SLIDES.length - 1;
/** Les photos font 1080×1240 ; sur un écran plus étroit, on garde la partie gauche (le sujet) en priorité. */
const PHOTO_RATIO = 1080 / 1240;
/** Distance entre le bas de l'écran (hors barre système) et le haut du bloc de texte : bouton + points + marges du dock. */
const TEXT_FROM_BOTTOM = 106 + 14 + 120;
const FOCUS_X = 0.3;

export default function SplashScreen({ onStart }: Props) {
  const { t } = useI18n();
  const { width, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Hauteur réelle de la zone d'affichage (sous la barre d'état et la barre de navigation comprises) : les images la remplissent entièrement
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const pageHeight = measuredHeight || windowHeight;
  // La photo occupe le haut de l'écran et s'estompe dans le fond violet ; le texte et les boutons se posent en dessous
  const photoHeight = Math.min(pageHeight * 0.56, width * 1.18);
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
            {/* Photo plein écran (largeur et hauteur de l'écran) : agrandie pour tout couvrir, recadrée au centre sans déborder */}
            <Image source={item.image} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel={t(item.titleKey)} />
            {/* Voile en haut (logo, « Passer ») et fondu de la photo vers le fond violet, pour que tout reste lisible */}
            <LinearGradient colors={["rgba(20,0,34,0.65)", "rgba(20,0,34,0)"]} style={[styles.shadeTop, { height: insets.top + 110 }]} pointerEvents="none" />
            <LinearGradient
              colors={["rgba(47,0,76,0)", "rgba(47,0,76,0.7)", "rgba(47,0,76,0.9)"]}
              locations={[0, 0.45, 1]}
              style={[styles.fade, { top: pageHeight - insets.bottom - TEXT_FROM_BOTTOM - 150, bottom: 0 }]}
              pointerEvents="none"
            />
            {/* Texte posé juste au-dessus des quatre points */}
            <View style={[styles.texts, { bottom: insets.bottom + TEXT_FROM_BOTTOM - 120 }]}>
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
  fade: { position: "absolute", left: 0, right: 0 },
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

  texts: { position: "absolute", left: 0, right: 0, paddingHorizontal: spacing.xl, alignItems: "center", gap: spacing.sm },
  title: { ...typography.headlineMd, color: colors.onPrimary, textAlign: "center" },
  subtitle: { ...typography.bodyMd, color: `${colors.onPrimary}E6`, textAlign: "center" },

  dock: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.lg },
  dots: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 10 },
  dot: { height: 8, borderRadius: 4, backgroundColor: colors.onPrimary },
});
