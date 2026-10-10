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

import SplashScreen from "./screens/SplashScreen";
import OtpLoginScreen from "./screens/OtpLoginScreen";
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
} from "./services/api";
import {
  registerForPushNotifications,
  setupNotificationHandler,
  subscribeNotificationResponse,
} from "./services/pushNotifications";
import { colors, radius, spacing } from "./theme/colors";

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
          <Text style={{ fontSize: 18, fontWeight: "700", color: colors.onSurface, marginBottom: 8 }}>
            Oups, un affichage a été interrompu
          </Text>
          <Text style={{ fontSize: 13, color: colors.onSurfaceVariant, textAlign: "center", paddingHorizontal: 24, marginBottom: 16 }}>
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
            <Text style={{ color: "#fff", fontWeight: "700" }}>Revenir à l'accueil</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [route, setRoute] = useState<Route>("splash");
  const [rideId, setRideId] = useState<string | undefined>();
  const [rideLabel, setRideLabel] = useState<string | undefined>();
  const [rideVehicle, setRideVehicle] = useState<string>("zem-express");
  const [isAuthRestoring, setIsAuthRestoring] = useState<boolean>(true);
  const [forceReady, setForceReady] = useState<boolean>(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
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
      goTo("ride-tracking");
    },
    [goTo, sessionToken]
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
          Alert.alert("Bientôt disponible", "Ce service arrive prochainement.");
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
        const customUrl = await SecureStore.getItemAsync("customApiUrl");
        if (customUrl) setApiUrl(customUrl);
        const savedRole = await SecureStore.getItemAsync("userRole");
        const savedToken = await SecureStore.getItemAsync("userToken");
        if (savedToken) setToken(savedToken);
        if (!isMounted) return;

        if (savedRole) {
          if (savedToken) setSessionToken(savedToken);
          const role = savedRole.toUpperCase().trim();
          const savedProviderStatus = await SecureStore.getItemAsync("providerStatus");
          const savedProviderType = await SecureStore.getItemAsync("providerType");
          setRoute(routeFor(role, savedProviderStatus, savedProviderType));
        } else {
          setRoute("splash");
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

        {route === "splash" && <SplashScreen onStart={() => goTo("otp")} />}

        {route === "otp" && (
          <OtpLoginScreen
            onVerified={(role?: string | null, provider?: ProviderRef | null) => {
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
            <Text>Aucune course à suivre.</Text>
            <Pressable onPress={() => goTo("home")} style={{ marginTop: spacing.md }}>
              <Text style={{ color: colors.primary, fontWeight: "700" }}>Retour à l'accueil</Text>
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

        {route === "wallet" && <WalletScreen onBack={() => goTo("home")} />}

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
            onLogout={handleLogout}
          />
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
          />
        )}

        {route === "driver-home" && (
          <DriverHomeScreen
            onLogout={handleLogout}
            onOpenDossier={() => goTo("provider-status")}
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
      </RootErrorBoundary>
    </SafeAreaProvider>
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