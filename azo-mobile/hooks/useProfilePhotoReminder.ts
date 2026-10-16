import { useCallback, useEffect, useState } from "react";
import { BrandAlert } from "../components/BrandAlert";
import { loadAvatar, useAvatar } from "../utils/avatar";

// Un seul rappel automatique par ouverture de l'application (ensuite, seul le passage « en ligne » le redemande)
let remindedThisSession = false;

/**
 * Photo de profil OBLIGATOIRE pour les Speeders, coursiers et livreurs : le client doit savoir qui vient le chercher.
 *  - un rappel s'affiche à l'ouverture de l'espace tant qu'il n'y a pas de photo ;
 *  - `ensurePhoto()` refuse de passer « en ligne » sans photo et ouvre le choix de la photo.
 */
export function useProfilePhotoReminder(openAvatarSheet: () => void) {
  const avatar = useAvatar();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    loadAvatar().finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const ask = useCallback(() => {
    BrandAlert.alert(
      "Ajoute ta photo de profil",
      "La photo est obligatoire : ton client doit voir qui vient le chercher. Ajoute-la pour pouvoir passer en ligne et recevoir des demandes.",
      [{ text: "Plus tard", style: "cancel" }, { text: "Ajouter ma photo", onPress: openAvatarSheet }]
    );
  }, [openAvatarSheet]);

  useEffect(() => {
    if (ready && !avatar && !remindedThisSession) {
      remindedThisSession = true;
      ask();
    }
  }, [ready, avatar, ask]);

  /** Vrai si la photo est là ; sinon rappelle l'obligation et renvoie faux (on ne passe pas en ligne). */
  const ensurePhoto = useCallback(() => {
    if (avatar) return true;
    ask();
    return false;
  }, [avatar, ask]);

  return { hasPhoto: !!avatar, ensurePhoto };
}
