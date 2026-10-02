import React, { useState, useEffect, useCallback } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  useFonts as usePJS,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from "@expo-google-fonts/plus-jakarta-sans";
import { useFonts as useInter, Inter_400Regular } from "@expo-google-fonts/inter";
import { View, ActivityIndicator, Pressable, Text, StyleSheet, Alert } from "react-native";
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
import { ProviderRef, ProviderType, setToken } from "./services/api";
import { colors, radius, spacing } from "./theme/colors";

type Route = ScreenId | "menu";

/**
 * Écran d'arrivée après connexion :
 * - ADMIN -> Console de validation des prestataires
 * - AGENCY -> Tableau de bord de la flotte d'agence
 * - DRIVER + providerType === COURIER -> Espace Coursier / Livreur
 * - DRIVER -> Zém Radar (Chauffeur Zem / Voiture)
 * - Dossier prestataire en cours -> Suivi du dossier
 * - Sinon -> Accueil client
 */
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

export default function App() {
  const [route, setRoute] = useState<Route>("splash");
  const [rideId, setRideId] = useState<string | undefined>();
  const [rideLabel, setRideLabel] = useState<string | undefined>();
  const [rideVehicle, setRideVehicle] = useState<string>("zem-express");
  const [isAuthRestoring, setIsAuthRestoring] = useState<boolean>(true);

  const [pjsLoaded] = usePJS({
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });
  const [interLoaded] = useInter({ Inter_400Regular });

  const goTo = useCallback((r: Route) => {
    setRoute(r);
  }, []);

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
        const savedRole = await SecureStore.getItemAsync("userRole");
        const savedToken = await SecureStore.getItemAsync("userToken");
        if (savedToken) setToken(savedToken);
        if (!isMounted) return;

        if (savedRole) {
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

  if (!pjsLoaded || !interLoaded || isAuthRestoring) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />

      {route === "splash" && <SplashScreen onStart={() => goTo("otp")} />}

      {route === "otp" && (
        <OtpLoginScreen
          onVerified={(role?: string | null, provider?: ProviderRef | null) => {
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

      {route !== "menu" && route !== "ride-request" && route !== "ride-tracking" && (
        <Pressable style={styles.devFab} onPress={() => goTo("menu")}>
          <Text style={styles.devFabText}>⋮⋮</Text>
        </Pressable>
      )}
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
  devFab: {
    position: "absolute",
    bottom: 150,
    right: spacing.md,
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.onSurface,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.75,
  },
  devFabText: { color: "#fff", fontWeight: "800" },
});
