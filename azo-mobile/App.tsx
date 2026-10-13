import React, { useState, useEffect, useCallback, useRef } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  useFonts as usePJS,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from "@expo-google-fonts/plus-jakarta-sans";
import { useFonts as useInter, Inter_400Regular } from "@expo-google-fonts/inter";
import { View, ActivityIndicator, Pressable, Text, StyleSheet, Alert, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

import SplashScreen, { ONBOARDING_SEEN_KEY } from "./screens/SplashScreen";
import AssistOfferScreen from "./screens/AssistOfferScreen";
import LanguageScreen from "./screens/LanguageScreen";
import PersonalInfoScreen from "./screens/PersonalInfoScreen";
import HelpScreen from "./screens/HelpScreen";
import SupportScreen from "./screens/SupportScreen";
import AdminSupportScreen from "./screens/AdminSupportScreen";
import MessagesScreen from "./screens/MessagesScreen";
import { clearAvatar } from "./utils/avatar";
import { useOfferWatcher } from "./hooks/useOfferWatcher";
import OfferPopup from "./components/OfferPopup";
import { I18nProvider, isVoiceOfferAnswered, loadI18n, markVoiceOfferAnswered, tr, useI18n } from "./i18n";
import OtpLoginScreen, { REGISTRATION_PENDING_KEY } from "./screens/OtpLoginScreen";
import HomeScreen from "./screens/HomeScreen";
import RideBookingScreen from "./screens/RideBookingScreen";
import LiveTrackingScreen from "./screens/LiveTrackingScreen";
import RideRatingScreen from "./screens/RideRatingScreen";
import DeliveryScreen from "./screens/DeliveryScreen";
import VehicleRentalScreen from "./screens/VehicleRentalScreen";
import WalletScreen from "./screens/WalletScreen";
import CoursesScreen from "./screens/CoursesScreen";
import ProfileScreen from "./screens/ProfileScreen";
import DriverHomeScreen from "./screens/DriverHomeScreen";
import CourierHomeScreen from "./screens/CourierHomeScreen";
import AgencyDashboardScreen from "./screens/AgencyDashboardScreen";
import AdminDashboardScreen from "./screens/AdminDashboardScreen";
import MarketplaceEscrowScreen from "./screens/MarketplaceEscrowScreen";
import NotificationsScreen from "./screens/NotificationsScreen";
import DevMenuScreen, { ScreenId } from "./screens/DevMenuScreen";
import ProviderOnboardingScreen from "./screens/ProviderOnboardingScreen";
import ProviderStatusScreen from "./screens/ProviderStatusScreen";
import AdminProvidersScreen from "./screens/AdminProvidersScreen";
import {
  getToken,
  notificationsApi,
  ProviderRef,
  ProviderType,
  setApiUrl,
  setToken,
  userApi,
} from "./services/api";
import {
  registerForPushNotifications,
  setupNotificationHandler,
  subscribeNotificationReceived,
  subscribeNotificationResponse,
} from "./services/pushNotifications";
import { colors, radius, spacing } from "./theme/colors";
import { FONT } from "./theme/fontNormalize";

// Initialisation sûre (ne s'exécute pas sur Expo Go Android)
setupNotificationHandler();

type Route = ScreenId | "menu";

function routeFor(
  role: string,
  providerStatus?: string | null,
  providerType?: string | null
): Route {
  const normRole = (role || "").toUpperCase().trim();
  const normType = (providerType || "").toUpperCase().trim();
  switch (normRole) {
    case "ADMIN":
      return "admin-providers";
    case "AGENCY":
    case "AGENCE":
      return "agency-dashboard";
    case "COURIER":
    case "COURSIER":
      return "courier-home";
    case "DRIVER":
    case "CONDUCTEUR":
    case "CHAUFFEUR":
      return normType === "COURIER" ? "courier-home" : "driver-home";
    default:
      if (providerStatus && providerStatus !== "APPROVED") return "provider-status";
      return "home";
  }
}

type ErrorBoundaryState = { hasError: boolean; errorText: string };

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode; onReset: () => void },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, errorText: "" };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      errorText: error instanceof Error ? error.message : "Erreur inattendue",
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.loadingContainer}>
          <Text style={{ fontSize: 18, fontFamily: FONT.bold, color: colors.onSurface, marginBottom: 8 }}>
            Oups, un affichage a été interrompu
          </Text>
          <Text style={{ fontFamily: FONT.regular, fontSize: 13, color: colors.onSurfaceVariant, textAlign: "center", paddingHorizontal: 24, marginBottom: 16 }}>
            {this.state.errorText}
          </Text>
          <Pressable
            onPress={() => {
              this.setState({ hasError: false, errorText: "" });
              this.props.onReset();
            }}
            style={{
              backgroundColor: colors.primary,
              paddingHorizontal: 20,
              paddingVertical: 12,
              borderRadius: radius.full,
            }}
          >
            <Text style={{ color: "#fff", fontFamily: FONT.bold }}>Revenir à l'accueil</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

function AppInner() {
  const { setVoiceAssist, lang } = useI18n();
  const [route, setRoute] = useState<Route>("splash");
  const [rideId, setRideId] = useState<string | undefined>();
  const [rideLabel, setRideLabel] = useState<string | undefined>();
  const [rideVehicle, setRideVehicle] = useState<string>("zem-express");
  const [isAuthRestoring, setIsAuthRestoring] = useState<boolean>(true);
  const [forceReady, setForceReady] = useState<boolean>(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  // Langue de l'application → serveur (notifications et libellés traduits). Sans effet si la route est absente.
  useEffect(() => {
    if (!sessionToken) return;
    userApi.setLanguage(lang).catch(() => undefined);
  }, [lang, sessionToken]);

  // Popup « un Zem a accepté ta course » : par-dessus n'importe quel écran du client
  // Écran d'où le portefeuille a été ouvert (l'agence y revient, pas à l'accueil client)
  const [walletBack, setWalletBack] = useState<Route>("home");
  // Écran d'où l'assistance a été ouverte (aide client, espace Zem, agence ou administrateur)
  const [supportBack, setSupportBack] = useState<Route>("help");
  const openSupport = (from: Route) => {
    setSupportBack(from);
    goTo("support");
  };
  const clientRoutes: Route[] = ["home", "courses", "wallet", "profile", "profile-info", "help", "messages", "notifications", "ride-request", "ride-tracking", "delivery", "rental"];
  const offerWatcher = useOfferWatcher(!!sessionToken && clientRoutes.includes(route), route === "ride-tracking");
  // Session ouverte mais inscription (nom, prénom, sexe, NPI) pas terminée : on rouvre le formulaire.
  const [resumeRegistration, setResumeRegistration] = useState(false);
  const pushTokenRef = useRef<string | null>(null);
  const pendingRideNotificationRef = useRef<string | null>(null);
  const handledNotificationRef = useRef<string | null>(null);

  const [pjsLoaded, pjsError] = usePJS({
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });
  const [interLoaded, interError] = useInter({ Inter_400Regular });

  useEffect(() => {
    const t = setTimeout(() => setForceReady(true), 2500);
    return () => clearTimeout(t);
  }, []);

  const goTo = useCallback((r: Route) => {
    setRoute(r);
  }, []);

  // « Commencer » ou « Passer » : on retient que l'onboarding a été vu, puis connexion.
  const finishOnboarding = useCallback(() => {
    SecureStore.setItemAsync(ONBOARDING_SEEN_KEY, "1").catch(() => {
      // Stockage indisponible : l'onboarding se réaffichera à la prochaine ouverture, sans gravité.
    });
    // La question « aide vocale ? » n'est posée qu'une fois ; ensuite on va droit à la connexion.
    goTo(isVoiceOfferAnswered() ? "otp" : "assist-offer");
  }, [goTo]);

  const handleRideNotification = useCallback(
    (notification: any) => {
      const notificationId = notification?.request?.identifier;
      if (handledNotificationRef.current === notificationId) return;
      handledNotificationRef.current = notificationId;

      const notifiedRideId = notification?.request?.content?.data?.rideId;
      if (typeof notifiedRideId !== "string") return;
      if (!sessionToken) {
        pendingRideNotificationRef.current = notifiedRideId;
        return;
      }
      setRideId(notifiedRideId);
      setRideLabel(undefined);
      offerWatcher.watch(notifiedRideId);
      goTo("ride-tracking");
    },
    [goTo, sessionToken, offerWatcher.watch]
  );

  useEffect(() => {
    if (!sessionToken) return;
    let active = true;
    (async () => {
      const token = await registerForPushNotifications();
      if (!active || !token || (Platform.OS !== "android" && Platform.OS !== "ios")) return;
      const platform = Platform.OS;
      pushTokenRef.current = token;
      await notificationsApi.registerPushToken(token, platform);
    })().catch((error) => {
      console.warn("Le jeton push n'a pas pu être enregistré sur AZƆ̀ :", error);
    });
    return () => { active = false; };
  }, [sessionToken]);

  useEffect(() => {
    return subscribeNotificationReceived((notification: any) => {
      const data = notification?.request?.content?.data;
      if (data?.event === "ride-offered" && typeof data.rideId === "string") offerWatcher.watch(data.rideId);
    });
  }, [offerWatcher.watch]);

  useEffect(() => {
    const unsubscribe = subscribeNotificationResponse(handleRideNotification);
    return () => unsubscribe();
  }, [handleRideNotification]);

  useEffect(() => {
    const pendingRideId = pendingRideNotificationRef.current;
    if (!sessionToken || !pendingRideId) return;
    pendingRideNotificationRef.current = null;
    setRideId(pendingRideId);
    setRideLabel(undefined);
    goTo("ride-tracking");
  }, [sessionToken, goTo]);

  const handleSelectService = useCallback(
    (service: string) => {
      switch (service) {
        case "transport":
          setRideVehicle("car-confort");
          goTo("ride-request");
          break;
        case "zem":
          setRideVehicle("zem-express");
          goTo("ride-request");
          break;
        case "livraison":
        case "coursier":
          goTo("delivery");
          break;
        case "agence":
          goTo("provider-status");
          break;
        case "location":
          goTo("rental");
          break;
        case "courses":
        case "marketplace":
          goTo("marketplace");
          break;
        default:
          Alert.alert(tr("app.soon.title"), tr("app.soon.text"));
      }
    },
    [goTo]
  );

  const handleLogout = useCallback(async () => {
    const pushToken = pushTokenRef.current;
    pushTokenRef.current = null;
    pendingRideNotificationRef.current = null;
    setSessionToken(null);
    if (pushToken && (Platform.OS === "android" || Platform.OS === "ios")) {
      const platform = Platform.OS;
      await notificationsApi.unregisterPushToken(pushToken, platform).catch(() => undefined);
    }
    setToken(null);
    try {
      await SecureStore.deleteItemAsync("userRole");
      await SecureStore.deleteItemAsync("userToken");
      await SecureStore.deleteItemAsync("providerStatus");
      await SecureStore.deleteItemAsync("providerType");
      await SecureStore.deleteItemAsync(REGISTRATION_PENDING_KEY);
      await clearAvatar();
      setResumeRegistration(false);
    } catch (error) {
      console.warn("Erreur lors de la suppression des jetons SecureStore :", error);
    } finally {
      goTo("otp");
    }
  }, [goTo]);

  useEffect(() => {
    let isMounted = true;

    async function restoreSession() {
      try {
        await loadI18n();
        const customUrl = await SecureStore.getItemAsync("customApiUrl");
        if (customUrl) setApiUrl(customUrl);
        const savedRole = await SecureStore.getItemAsync("userRole");
        const savedToken = await SecureStore.getItemAsync("userToken");
        if (savedToken) setToken(savedToken);
        if (!isMounted) return;

        if (savedRole) {
          if (savedToken) setSessionToken(savedToken);
          if (savedToken && (await SecureStore.getItemAsync(REGISTRATION_PENDING_KEY))) {
            setResumeRegistration(true);
            setRoute("otp");
            return;
          }
          const role = savedRole.toUpperCase().trim();
          const savedProviderStatus = await SecureStore.getItemAsync("providerStatus");
          const savedProviderType = await SecureStore.getItemAsync("providerType");
          setRoute(routeFor(role, savedProviderStatus, savedProviderType));
        } else {
          // Pas de session : l'onboarding n'est montré qu'à la toute première ouverture de
          // l'application. Ensuite (déconnexion, session expirée) on va directement à la connexion.
          const onboardingSeen = await SecureStore.getItemAsync(ONBOARDING_SEEN_KEY);
          setRoute(onboardingSeen ? "otp" : "splash");
        }
      } catch (error) {
        console.warn("Erreur lors de la récupération de la session :", error);
        if (isMounted) {
          setRoute("splash");
        }
      } finally {
        if (isMounted) {
          setIsAuthRestoring(false);
        }
      }
    }

    restoreSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const fontsReady = (pjsLoaded || !!pjsError) && (interLoaded || !!interError);

  if ((!fontsReady || isAuthRestoring) && !forceReady) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <RootErrorBoundary onReset={() => goTo("splash")}>
        <StatusBar style="dark" />

        {route === "splash" && <SplashScreen onStart={finishOnboarding} />}

        {route === "assist-offer" && (
          <AssistOfferScreen
            onYes={() => {
              setVoiceAssist(true);
              goTo("language");
            }}
            onNo={() => {
              setVoiceAssist(false);
              markVoiceOfferAnswered();
              goTo("otp");
            }}
          />
        )}

        {route === "language" && (
          <LanguageScreen
            onContinue={() => {
              markVoiceOfferAnswered();
              goTo("otp");
            }}
            onBack={() => goTo("assist-offer")}
          />
        )}

        {route === "otp" && (
          <OtpLoginScreen
            resumeRegistration={resumeRegistration}
            onVerified={(role?: string | null, provider?: ProviderRef | null) => {
              setResumeRegistration(false);
              setSessionToken(getToken());
              goTo(routeFor(role ?? "", provider?.status ?? null, provider?.type ?? null));
            }}
            onBack={() => goTo("splash")}
          />
        )}

        {route === "home" && (
          <HomeScreen
            onSelectService={handleSelectService}
            onNavigateTab={goTo}
          />
        )}

        {route === "ride-request" && (
          <RideBookingScreen
            service={rideVehicle === "car-confort" ? "transport" : "zem"}
            onBack={() => goTo("home")}
            onRecharge={() => goTo("wallet")}
            onConfirmed={(id, label) => {
              offerWatcher.watch(id);
              setRideId(id);
              setRideLabel(label);
              goTo("ride-tracking");
            }}
          />
        )}

        {route === "ride-tracking" && rideId && (
          <LiveTrackingScreen
            rideId={rideId}
            destinationLabel={rideLabel}
            onClose={() => goTo("home")}
            onFinish={() => goTo("ride-rating")}
          />
        )}
        {route === "ride-tracking" && !rideId && (
          <View style={styles.loadingContainer}>
            <Text style={{ fontFamily: FONT.regular }}>Aucune course à suivre.</Text>
            <Pressable onPress={() => goTo("home")} style={{ marginTop: spacing.md }}>
              <Text style={{ color: colors.primary, fontFamily: FONT.bold }}>Retour à l'accueil</Text>
            </Pressable>
          </View>
        )}

        {route === "ride-rating" && (
          <RideRatingScreen rideId={rideId} onDone={() => goTo("home")} />
        )}

        {route === "delivery" && (
          <DeliveryScreen onBack={() => goTo("home")} onConfirm={() => goTo("home")} />
        )}

        {route === "rental" && (
          <VehicleRentalScreen onBack={() => goTo("home")} onReserve={() => goTo("home")} />
        )}

        {route === "wallet" && (
          <WalletScreen
            onBack={() => {
              const back = walletBack;
              setWalletBack("home");
              goTo(back);
            }}
          />
        )}

        {route === "courses" && (
          <CoursesScreen
            onNavigateTab={goTo}
            onRequestRide={() => goTo("ride-request")}
            onTrackRide={(id) => {
              setRideId(id);
              setRideLabel(undefined);
              goTo("ride-tracking");
            }}
          />
        )}

        {route === "profile" && (
          <ProfileScreen
            onNavigateTab={goTo}
            onOpenNotifications={() => goTo("notifications")}
            onOpenProvider={() => goTo("provider-status")}
            onOpenInfo={() => goTo("profile-info")}
            onOpenHelp={() => goTo("help")}
            onLogout={handleLogout}
          />
        )}

        {route === "profile-info" && <PersonalInfoScreen onBack={() => goTo("profile")} />}

        {route === "help" && <HelpScreen onBack={() => goTo("profile")} onOpenSupport={() => openSupport("help")} />}
        {route === "support" && <SupportScreen onBack={() => goTo(supportBack)} />}
        {route === "admin-support" && <AdminSupportScreen onBack={() => goTo("admin-providers")} />}

        {route === "messages" && (
          <MessagesScreen onNavigateTab={goTo} />
        )}

        {route === "provider-onboarding" && (
          <ProviderOnboardingScreen
            onSubmitted={() => goTo("provider-status")}
            onBack={() => goTo("home")}
          />
        )}

        {route === "provider-status" && (
          <ProviderStatusScreen
            onEdit={() => goTo("provider-onboarding")}
            onEnterWorkspace={(type: ProviderType) =>
              goTo(
                type === "AGENCY"
                  ? "agency-dashboard"
                  : type === "COURIER"
                  ? "courier-home"
                  : "driver-home"
              )
            }
            onBack={() => goTo("home")}
          />
        )}

        {route === "admin-providers" && (
          <AdminProvidersScreen
            onBack={handleLogout}
            onOpenDashboard={() => goTo("admin-dashboard")}
            onOpenSupport={() => goTo("admin-support")}
          />
        )}

        {route === "driver-home" && (
          <DriverHomeScreen
            onLogout={handleLogout}
            onOpenDossier={() => goTo("provider-status")}
            onOpenSupport={() => openSupport("driver-home")}
          />
        )}

        {route === "courier-home" && (
          <CourierHomeScreen
            onLogout={handleLogout}
            onOpenDossier={() => goTo("provider-status")}
          />
        )}

        {route === "agency-dashboard" && (
          <AgencyDashboardScreen
            onBack={handleLogout}
            onOpenDossier={() => goTo("provider-status")}
            onOpenWallet={() => {
              setWalletBack("agency-dashboard");
              goTo("wallet");
            }}
            onOpenSupport={() => openSupport("agency-dashboard")}
          />
        )}

        {route === "admin-dashboard" && (
          <AdminDashboardScreen
            onBack={() => goTo("admin-providers")}
            onOpenProviders={() => goTo("admin-providers")}
          />
        )}

        {route === "marketplace" && (
          <MarketplaceEscrowScreen onBack={() => goTo("home")} onConfirm={() => goTo("home")} />
        )}

        {route === "notifications" && <NotificationsScreen onBack={() => goTo("home")} />}

        {route === "menu" && <DevMenuScreen onSelect={(id) => goTo(id)} />}

        {offerWatcher.offer && (
          <OfferPopup
            ride={offerWatcher.offer}
            onClose={offerWatcher.dismiss}
            onChanged={(next) => {
              offerWatcher.dismiss();
              // Zem choisi : on suit la course ; refusé : la recherche continue, on reste où on est
              if (next.status !== "PENDING" && next.status !== "OFFERED" && next.status !== "CANCELLED") {
                setRideId(next.id);
                setRideLabel(undefined);
                goTo("ride-tracking");
              }
            }}
          />
        )}
      </RootErrorBoundary>
    </SafeAreaProvider>
  );
}

export default function App() {
  const [i18nReady, setI18nReady] = useState(false);
  useEffect(() => {
    // Lecture de la langue et de l'aide vocale enregistrées sur le téléphone (rapide).
    loadI18n().finally(() => setI18nReady(true));
  }, []);

  if (!i18nReady) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }
  return (
    <I18nProvider>
      <AppInner />
    </I18nProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
});