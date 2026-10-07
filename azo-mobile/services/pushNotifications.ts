import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";

/** Vérifie si l'environnement supporte les push notifications distantes */
export function isPushNotificationSupported(): boolean {
  if (Platform.OS !== "android" && Platform.OS !== "ios") return false;

  const isExpoGo =
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
    Constants.appOwnership === "expo" ||
    (Constants.executionEnvironment as string) === "storeClient";

  // Expo Go Android ne supporte pas les push distants (SDK 51+)
  if (Platform.OS === "android" && isExpoGo) {
    return false;
  }

  return true;
}

/** Initialise le handler de notification en différé sans planter Expo Go */
export function setupNotificationHandler() {
  if (!isPushNotificationSupported()) return;

  try {
    const Notifications = require("expo-notifications");
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  } catch (error) {
    console.warn("Impossible d'initialiser NotificationHandler :", error);
  }
}

/** Demande la permission et enregistre le token push si supporté */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!isPushNotificationSupported()) {
    return null;
  }

  try {
    const Notifications = require("expo-notifications");

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Notifications AZƆ̀",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#0B7A53",
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== "granted") {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== "granted") return null;

    const projectId =
      process.env.EXPO_PUBLIC_EAS_PROJECT_ID ??
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    if (!projectId) {
      console.warn("Notifications push : projectId EAS absent de app.json.");
      return null;
    }

    const response = await Notifications.getExpoPushTokenAsync({ projectId });
    return response.data;
  } catch (error) {
    console.warn("Erreur registerForPushNotifications :", error);
    return null;
  }
}

/** Souscrit aux clics de notification en toute sécurité */
export function subscribeNotificationResponse(
  onNotification: (notification: any) => void
): () => void {
  if (!isPushNotificationSupported()) {
    return () => {};
  }

  try {
    const Notifications = require("expo-notifications");

    Notifications.getLastNotificationResponseAsync?.()
      .then((lastResponse: any) => {
        if (lastResponse?.notification) {
          onNotification(lastResponse.notification);
        }
      })
      .catch(() => undefined);

    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response: any) => {
        onNotification(response.notification);
      }
    );

    return () => subscription.remove();
  } catch (error) {
    console.warn("Impossible d'attacher le listener de notification :", error);
    return () => {};
  }
}