// Photo de profil : gardée sur le téléphone ET sur le serveur (compte).
//  - Copie locale dans le dossier de l'application : affichage immédiat, même sans réseau.
//  - Copie sur le serveur : elle survit à une déconnexion, à la fermeture forcée de l'application ou à un changement de téléphone. Un
//    prestataire qui n'a jamais choisi de photo retrouve celle de son dossier (pièce « photo de profil »).
//  - Android peut fermer l'application pendant que la caméra ou la galerie est ouverte : la photo prise est alors « perdue » ; on la
//    récupère au retour (`getPendingResultAsync`) grâce à un repère mémorisé avant l'ouverture.
import * as SecureStore from "expo-secure-store";
import * as ImagePicker from "expo-image-picker";
import { File, Paths } from "expo-file-system";
import { useEffect, useState } from "react";
import { avatarApi } from "../services/api";

const AVATAR_KEY = "profileAvatarUri";
/** « 1 » tant qu'une photo est en cours de choix (caméra ou galerie ouverte) pour cette fonction. */
const PENDING_KEY = "avatarPickPending";
/** « 1 » : la photo locale n'est pas encore enregistrée sur le serveur (réseau coupé au moment du choix). */
const SYNC_KEY = "avatarNeedsUpload";
/** Au-delà, le serveur refuse la photo (2 Mo environ) : on garde alors la photo sur le téléphone seulement. */
const MAX_DATA_URI_LENGTH = 2_700_000;

let current: string | null = null;
let loaded = false;
let loading: Promise<string | null> | null = null;
const listeners = new Set<(uri: string | null) => void>();

function publish(uri: string | null) {
  current = uri;
  listeners.forEach((fn) => fn(uri));
}

/** Lit une image locale et la renvoie en data URI (aucun accès direct aux octets : on passe par fetch + FileReader, présents dans React Native). */
export async function fileToDataUri(uri: string): Promise<string | null> {
  try {
    const blob = await (await fetch(uri)).blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Envoie la photo locale au serveur ; en cas d'échec, le repère SYNC_KEY reste posé et l'envoi sera retenté au prochain chargement. */
async function uploadLocalAvatar(uri: string): Promise<void> {
  try {
    const dataUri = await fileToDataUri(uri);
    if (!dataUri || dataUri.length > MAX_DATA_URI_LENGTH) {
      // photo illisible ou trop lourde : inutile de réessayer, elle reste sur ce téléphone
      await SecureStore.deleteItemAsync(SYNC_KEY).catch(() => undefined);
      return;
    }
    const normalized = dataUri.replace(/^data:[^;]*;base64,/, "data:image/jpeg;base64,");
    await avatarApi.set(normalized);
    await SecureStore.deleteItemAsync(SYNC_KEY).catch(() => undefined);
  } catch {
    // pas de réseau, serveur en veille… : on réessaiera
  }
}

/** Photo perdue parce qu'Android a fermé l'application pendant la prise de photo : on la récupère et on l'enregistre. */
async function recoverPendingPick(): Promise<void> {
  let pending: string | null = null;
  try {
    pending = await SecureStore.getItemAsync(PENDING_KEY);
  } catch {
    return;
  }
  if (pending !== "1") return;
  try {
    const result = await ImagePicker.getPendingResultAsync();
    if (result && !("code" in result) && !result.canceled && result.assets?.[0]?.uri) {
      await saveAvatar(result.assets[0].uri);
    }
  } catch {
    // rien à récupérer
  } finally {
    await SecureStore.deleteItemAsync(PENDING_KEY).catch(() => undefined);
  }
}

async function doLoad(): Promise<string | null> {
  await recoverPendingPick();
  let local: string | null = null;
  try {
    const stored = await SecureStore.getItemAsync(AVATAR_KEY);
    // L'image doit encore exister (nettoyage du téléphone, données effacées…)
    local = stored && new File(stored).exists ? stored : null;
  } catch {
    local = null;
  }
  if (local) {
    publish(local);
    // photo choisie sans réseau : on l'envoie maintenant
    SecureStore.getItemAsync(SYNC_KEY)
      .then((flag) => (flag === "1" ? uploadLocalAvatar(local as string) : undefined))
      .catch(() => undefined);
    return local;
  }
  // Pas de photo sur ce téléphone (nouvelle installation, déconnexion, autre téléphone) : on la reprend sur le serveur
  try {
    const remote = await avatarApi.get();
    if (remote?.dataUri) {
      publish(remote.dataUri);
      return remote.dataUri;
    }
  } catch {
    // hors connexion ou pas connecté : on affiche les initiales, et on réessaiera à la prochaine ouverture
    loaded = false;
  }
  return current;
}

export async function loadAvatar(): Promise<string | null> {
  if (loaded) return current;
  if (!loading) {
    loaded = true;
    loading = doLoad().finally(() => {
      loading = null;
    });
  }
  return loading;
}

function removeFile(uri: string | null) {
  if (!uri || uri.startsWith("data:")) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // fichier déjà absent : rien à faire
  }
}

/** Copie la photo choisie dans le dossier de l'application, la mémorise et l'enregistre sur le serveur. */
export async function saveAvatar(sourceUri: string): Promise<void> {
  const target = new File(Paths.document, `avatar-${Date.now()}.jpg`);
  new File(sourceUri).copy(target);
  const previous = current;
  await SecureStore.setItemAsync(AVATAR_KEY, target.uri);
  await SecureStore.setItemAsync(SYNC_KEY, "1");
  loaded = true;
  publish(target.uri);
  removeFile(previous);
  void uploadLocalAvatar(target.uri);
}

/**
 * Efface la photo de CE téléphone (déconnexion) : la photo du compte reste sur le serveur et revient à la prochaine connexion.
 */
export async function clearAvatar(): Promise<void> {
  const previous = current;
  loaded = false;
  loading = null;
  publish(null);
  removeFile(previous);
  await SecureStore.deleteItemAsync(AVATAR_KEY).catch(() => undefined);
  await SecureStore.deleteItemAsync(SYNC_KEY).catch(() => undefined);
}

/** « Retirer la photo » : efface la photo de ce téléphone ET du compte. */
export async function removeAvatar(): Promise<void> {
  await clearAvatar();
  loaded = true; // le serveur n'a plus de photo non plus : pas de nouveau chargement
  await avatarApi.remove().catch(() => undefined);
}

export type AvatarPick = "ok" | "cancelled" | "denied";

/** Ouvre l'appareil photo ou la galerie (recadrage carré) et enregistre la photo. */
export async function pickAvatar(mode: "camera" | "library"): Promise<AvatarPick> {
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    // 0,4 : photo assez légère pour être enregistrée sur le serveur (2 Mo au plus) même avec un appareil photo récent
    quality: 0.4,
  };
  const permission =
    mode === "camera"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return "denied";
  // Repère posé AVANT d'ouvrir la caméra : si Android ferme l'application pendant la prise de photo, on retrouvera la photo au retour
  await SecureStore.setItemAsync(PENDING_KEY, "1").catch(() => undefined);
  try {
    const result =
      mode === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets[0]) return "cancelled";
    await saveAvatar(result.assets[0].uri);
    return "ok";
  } finally {
    await SecureStore.deleteItemAsync(PENDING_KEY).catch(() => undefined);
  }
}

/** Adresse de la photo (null = pas de photo) ; tous les écrans qui l'affichent se mettent à jour ensemble. */
export function useAvatar(): string | null {
  const [uri, setUri] = useState<string | null>(current);
  useEffect(() => {
    let active = true;
    loadAvatar().then((value) => active && setUri(value));
    listeners.add(setUri);
    return () => {
      active = false;
      listeners.delete(setUri);
    };
  }, []);
  return uri;
}
