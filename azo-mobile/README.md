# AZƆ̀ Mobile — Écrans 1 à 3

Écrans codés fidèlement à la charte de la maquette Stitch : **Splash/Onboarding**,
**Connexion OTP (Bénin)**, **Accueil client**.

## Installation

```bash
npx create-expo-app azo-mobile --template expo-template-blank-typescript
cd azo-mobile

npx expo install expo-linear-gradient expo-status-bar react-native-safe-area-context react-native-svg
npm install @expo/vector-icons
npx expo install @expo-google-fonts/plus-jakarta-sans @expo-google-fonts/inter expo-font
```

Puis copie les dossiers `theme/`, `components/`, `screens/` et remplace le `App.tsx`
généré par celui fourni ici.

## Lancer le projet

```bash
npx expo start
```

Scanne le QR code avec l'app **Expo Go** (Android/iOS) pour tester sur ton
téléphone en conditions réelles.

## Ce qui est déjà adapté "smartphone"

- `useWindowDimensions` pour ajuster la grille de services (3 colonnes sur petit
  écran, 4 sur écran large) et la hauteur de la vitrine du Splash.
- `SafeAreaView` (react-native-safe-area-context) partout, pour respecter les
  encoches et barres système iOS/Android.
- `KeyboardAvoidingView` sur l'écran OTP pour que le clavier ne cache jamais le
  bouton d'action.
- Boutons et zones tactiles ≥ 44px de hauteur (norme d'accessibilité tactile).

## Prochaines étapes

- Brancher `handleSendCode` / `handleVerify` (écran OTP) sur ton backend NestJS
  (`POST /auth/request-otp`, `POST /auth/verify-otp`).
- Remplacer la navigation par état local dans `App.tsx` par
  `@react-navigation/native-stack` dès l'ajout de nouveaux écrans.
- Écrans suivants à coder : Carte/Demande de course, Suivi de course, Portefeuille.
