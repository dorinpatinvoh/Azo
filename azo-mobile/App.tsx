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
import { View, ActivityIndicator, Pressable, Text, StyleSheet } from "react-native";
import * as SecureStore from "expo-secure-store";

import SplashScreen from "./screens/SplashScreen";
import OtpLoginScreen from "./screens/OtpLoginScreen";
import HomeScreen from "./screens/HomeScreen";
import RideBookingScreen from "./screens/RideBookingScreen"; // [RÉSERVATION] remplace RideRequestScreen
import LiveTrackingScreen from "./screens/LiveTrackingScreen"; // [RÉSERVATION] remplace RideTrackingScreen
import RideRatingScreen from "./screens/RideRatingScreen";
import DeliveryScreen from "./screens/DeliveryScreen";
import VehicleRentalScreen from "./screens/VehicleRentalScreen";
import WalletScreen from "./screens/WalletScreen";
import CoursesScreen from "./screens/CoursesScreen"; // [AJOUT]
import ProfileScreen from "./screens/ProfileScreen"; // [AJOUT]
import { setToken } from "./services/api"; // [AJOUT]
import { Alert } from "react-native"; // [AJOUT]
import DriverHomeScreen from "./screens/DriverHomeScreen";
import AgencyDashboardScreen from "./screens/AgencyDashboardScreen";
import AdminDashboardScreen from "./screens/AdminDashboardScreen";
import MarketplaceEscrowScreen from "./screens/MarketplaceEscrowScreen";
import ArtisansScreen from "./screens/ArtisansScreen";
import NotificationsScreen from "./screens/NotificationsScreen";
import DevMenuScreen, { ScreenId } from "./screens/DevMenuScreen";
import ProviderOnboardingScreen from "./screens/ProviderOnboardingScreen";
import ProviderStatusScreen from "./screens/ProviderStatusScreen";
import AdminProvidersScreen from "./screens/AdminProvidersScreen";
import { ProviderRef, ProviderType } from "./services/api";
import { colors, radius, spacing } from "./theme/colors";

type Route = ScreenId | "menu";

/**
 * Écran d'arrivée après connexion.
 * Un client dont le dossier prestataire n'est pas encore approuvé tombe sur le suivi
 * de son dossier : c'est la seule façon de savoir où en est sa demande.
 */
function routeFor(role: string, providerStatus?: string | null): Route {
  switch ((role || "").toUpperCase().trim()) {
    case "DRIVER":
    case "CONDUCTEUR":
    case "CHAUFFEUR":
      return "driver-home";
    case "AGENCY":
    case "AGENCE":
      return "agency-dashboard";
    case "ADMIN":
      // La console de validation est le vrai travail de l'admin : c'est l'écran d'accueil.
      return "admin-providers";
    case "ARTISAN":
      return "artisans";
    default:
      if (providerStatus && providerStatus !== "APPROVED") return "provider-status";
      return "home";
  }
}

export default function App() {
  const [route, setRoute] = useState<Route>("splash");
  const [rideId, setRideId] = useState<string | undefined>();
  const [rideLabel, setRideLabel] = useState<string | undefined>(); // [RÉSERVATION] libellé de la destination
  const [rideVehicle, setRideVehicle] = useState<string>("zem-express"); // [AJOUT]
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

  // [AJOUT] Chaque bouton de l'accueil mène à un écran précis
  const handleSelectService = useCallback(
    (service: string) => {
      switch (service) {
        case "transport": // Voiture
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
        case "location":
          goTo("rental");
          break;
        case "courses": // courses au marché
        case "marketplace":
          goTo("marketplace");
          break;
        default:
          Alert.alert("Bientôt disponible", "Ce service arrive prochainement.");
      }
    },
    [goTo]
  );

  // Déconnexion sécurisée nettoyant le SecureStore
  const handleLogout = useCallback(async () => {
    setToken(null); // [AJOUT] oublie le jeton en mémoire
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

  // Restauration de session au démarrage de l'application
  useEffect(() => {
    let isMounted = true;

    async function restoreSession() {
      try {
        const savedRole = await SecureStore.getItemAsync("userRole");
        const savedToken = await SecureStore.getItemAsync("userToken"); // [AJOUT]
        if (savedToken) setToken(savedToken); // [AJOUT] sinon les appels API ne sont pas authentifiés
        if (!isMounted) return;

        if (savedRole) {
          const role = savedRole.toUpperCase().trim();
          const savedProviderStatus = await SecureStore.getItemAsync("providerStatus");
          setRoute(routeFor(role, savedProviderStatus));
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
            goTo(routeFor(role ?? "", provider?.status ?? null));
          }}
          onBack={() => goTo("splash")}
        />
      )}

      {route === "home" && (
        <HomeScreen
          onSelectService={handleSelectService} // [AJOUT] remplace l'ancien if/else
          onNavigateTab={goTo} // [AJOUT] home / courses / wallet / profile
        />
      )}

      {/* [RÉSERVATION] Écran de réservation connecté au backend (GPS, adresses, carte, prix) */}
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

      {/* [RÉSERVATION] Suivi en direct de la course */}
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

      {/* [AJOUT] Onglet Courses */}
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

      {/* [AJOUT] Onglet Profil */}
      {route === "profile" && (
        <ProfileScreen
          onNavigateTab={goTo}
          onOpenNotifications={() => goTo("notifications")}
          onOpenProvider={() => goTo("provider-status")}
          onLogout={handleLogout}
        />
      )}

      {/* Inscription prestataire : wizard de dépôt de dossier (identité, véhicule, photos) */}
      {route === "provider-onboarding" && (
        <ProviderOnboardingScreen
          onSubmitted={() => goTo("provider-status")}
          onBack={() => goTo("home")}
        />
      )}

      {/* Suivi du dossier : statuts, pièces, journal, décision de l'admin */}
      {route === "provider-status" && (
        <ProviderStatusScreen
          onEdit={() => goTo("provider-onboarding")}
          onEnterWorkspace={(type: ProviderType) =>
            goTo(type === "AGENCY" ? "agency-dashboard" : "driver-home")
          }
          onBack={() => goTo("home")}
        />
      )}

      {/* Console administrateur : validation des dossiers prestataires */}
      {route === "admin-providers" && <AdminProvidersScreen onBack={handleLogout} />}

      {route === "driver-home" && <DriverHomeScreen onLogout={handleLogout} />}

      {route === "agency-dashboard" && <AgencyDashboardScreen onBack={handleLogout} />}

      {route === "admin-dashboard" && <AdminDashboardScreen onBack={handleLogout} />}

      {route === "marketplace" && (
        <MarketplaceEscrowScreen onBack={() => goTo("home")} onConfirm={() => goTo("home")} />
      )}

      {route === "artisans" && (
        <ArtisansScreen onBack={() => goTo("home")} onRequestArtisan={() => goTo("home")} />
      )}

      {route === "notifications" && <NotificationsScreen onBack={() => goTo("home")} />}

      {route === "menu" && <DevMenuScreen onSelect={(id) => goTo(id)} />}

      {/* Bouton flottant pour le développement (masqué sur la réservation/suivi : il gênait le bouton Confirmer) */}
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
    bottom: 150, // [AJOUT] était 90 : masquait l'onglet Profil
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
