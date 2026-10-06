import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

/** Demande la permission système puis retourne le jeton Expo de cet appareil. */
export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS !== "android" && Platform.OS !== "ios") return null;

  try {
    if (Platform.OS === "android") {
      // Le canal doit exister avant la demande de jeton sous Android.
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
      console.warn("Notifications push désactivées : projectId EAS absent de la configuration Expo.");
      return null;
    }

    const response = await Notifications.getExpoPushTokenAsync({ projectId });
    return response.data;
  } catch (error) {
    // Expo Go Android n'accepte plus les notifications push distantes depuis le SDK 53.
    // Un build de développement natif permet d'activer cette fonctionnalité.
    console.warn("Impossible d'enregistrer les notifications push :", error);
    return null;
  }
}
