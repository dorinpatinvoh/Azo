// Applique la règle de police (voir fontNormalize.ts) à TOUS les styles de l'application, une seule fois.
//
// `StyleSheet.create` est enveloppé : chaque style de texte passe par `normalizeTextStyle` au
// moment où l'écran est chargé. Aucun écran n'est modifié, donc pas de conflit avec le travail
// de l'équipe, et un nouvel écran est corrigé automatiquement.
//
// À importer EN PREMIER dans index.ts : les écrans appellent `StyleSheet.create` dès leur
// chargement, il faut que l'enveloppe soit en place avant.
//
// Limite : les styles écrits directement dans le JSX (`style={{ … }}`) ne passent pas par
// `StyleSheet.create` ; ils doivent utiliser `typography` / `FONT` eux-mêmes.
import { StyleSheet } from "react-native";
import { normalizeTextStyle } from "./fontNormalize";

try {
  const create = StyleSheet.create;
  (StyleSheet as { create: unknown }).create = (styles: Record<string, unknown>) => {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(styles)) normalized[key] = normalizeTextStyle(styles[key]);
    return create.call(StyleSheet, normalized as never);
  };
} catch (error) {
  // Si l'objet est figé sur une future version de React Native, on garde les styles d'origine
  // (rendu d'avant) plutôt que de faire échouer le démarrage de l'application.
  console.warn("Normalisation des polices non appliquée :", error);
}
