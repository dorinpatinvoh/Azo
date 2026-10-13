// Photo de profil : gardée SUR LE TÉLÉPHONE (aucun envoi au serveur, qui n'a pas encore de champ photo).
// L'image choisie est copiée dans le dossier de l'application (le cache de la galerie peut être vidé),
// et son adresse est mémorisée dans SecureStore.
import * as SecureStore from "expo-secure-store";
import * as ImagePicker from "expo-image-picker";
import { File, Paths } from "expo-file-system";
import { useEffect, useState } from "react";

const AVATAR_KEY = "profileAvatarUri";

let current: string | null = null;
let loaded = false;
const listeners = new Set<(uri: string | null) => void>();

function publish(uri: string | null) {
  current = uri;
  listeners.forEach((fn) => fn(uri));
}

export async function loadAvatar(): Promise<string | null> {
  if (!loaded) {
    loaded = true;
    try {
      const stored = await SecureStore.getItemAsync(AVATAR_KEY);
      // L'image doit encore exister (nettoyage du téléphone, données effacées…)
      current = stored && new File(stored).exists ? stored : null;
    } catch {
      current = null;
    }
  }
  return current;
}

function removeFile(uri: string | null) {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // fichier déjà absent : rien à faire
  }
}

/** Copie la photo choisie dans le dossier de l'application et la mémorise. */
export async function saveAvatar(sourceUri: string): Promise<void> {
  const target = new File(Paths.document, `avatar-${Date.now()}.jpg`);
  new File(sourceUri).copy(target);
  const previous = current;
  await SecureStore.setItemAsync(AVATAR_KEY, target.uri);
  publish(target.uri);
  removeFile(previous);
}

export async function clearAvatar(): Promise<void> {
  const previous = current;
  publish(null);
  removeFile(previous);
  await SecureStore.deleteItemAsync(AVATAR_KEY).catch(() => undefined);
}

export type AvatarPick = "ok" | "cancelled" | "denied";

/** Ouvre l'appareil photo ou la galerie (recadrage carré) et enregistre la photo. */
export async function pickAvatar(mode: "camera" | "library"): Promise<AvatarPick> {
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.6,
  };
  const permission =
    mode === "camera"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return "denied";
  const result =
    mode === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets[0]) return "cancelled";
  await saveAvatar(result.assets[0].uri);
  return "ok";
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
