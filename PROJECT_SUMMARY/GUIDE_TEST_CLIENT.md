# Guide de Test Officiel — Application Mobile AZƆ̀ Bénin (Version Démonstration APK)

Bienvenue dans la version de démonstration de la Super-App **AZƆ̀**.
Ce guide vous permet de tester en conditions réelles les **5 espaces** de la plateforme : **Client**, **Zem / Chauffeur**, **Coursier / Livreur**, **Agence de flotte**, et **Administration (Validation KYC & Pilotage)**.

---

## 📲 1. Installation de l'application (Fichier APK Android)

1. Téléchargez le fichier **`AZO.apk`** envoyé (ou cliquez sur le lien de téléchargement).
2. Ouvrez le fichier sur votre téléphone Android.
3. Si Android affiche *« Autoriser l'installation d'applications issues de cette source »*, activez l'autorisation puis appuyez sur **Installer**.
4. Ouvrez l'application **AZƆ̀**.

> **Note technique (Premier lancement) :** Si le serveur n'a pas été utilisé depuis 15 minutes, le tout premier chargement peut prendre **20 à 30 secondes** (réveil du serveur cloud). Les actions suivantes sont instantanées.

---

## 💬 2. Comment fonctionne le code SMS (OTP) en mode Simulation ?

L'application fonctionne actuellement en **mode simulation** (sans facturation d'envoi SMS opérateur) :
- Lorsque vous appuyez sur **« Recevoir mon code »**, une **bannière de notification SMS AZƆ̀ Bénin** s'affiche tout en haut de l'écran pendant **5 secondes** avec votre code à 4 chiffres, puis disparaît.
- **Astuce :** Vous pouvez toucher directement cette bannière pendant les 5 secondes pour remplir le code automatiquement, ou appuyer sur **« Renvoyer le code (5s) »** pour la revoir. *(En secours, le code de test `0000` est également actif).*

---

## 🔑 3. Comptes et connexion

L'écran de connexion ne pré-remplit plus aucun numéro : **chaque utilisateur saisit son propre numéro de mobile béninois à 10 chiffres** (`01 XX XX XX XX`). Le compte est créé automatiquement à la première connexion réussie, puis retrouvé aux connexions suivantes.

| Espace | Comment y accéder |
|---|---|
| **1. Espace Client** | S'inscrire avec son propre numéro, puis commander des courses, des livraisons et recharger son portefeuille AZƆ̀ Pay. |
| **2. Espace Zem / Chauffeur** | Depuis **Profil → Devenir Zem / Coursier / Agence**, déposer un dossier véhicule ; l'espace métier s'ouvre après validation Administrateur. |
| **3. Espace Coursier / Livreur** | Même parcours d'inscription avec un profil Coursier / Livreur, puis validation Administrateur. |
| **4. Espace Agence (Flotte)** | Même parcours d'inscription avec un profil Agence (raison sociale, formule, pièces), puis validation Administrateur. |
| **5. Espace Administrateur** | Numéro Administrateur pré-configuré **`01 97 00 00 00`** (Direction Générale AZƆ̀ Bénin) — validation des dossiers KYC et pilotage global. |

*(Pour vous déconnecter et changer de profil : allez dans **Profil → Se déconnecter**, ou appuyez sur l'icône de déconnexion en haut à droite des espaces professionnels.)*

---

## 🧪 4. Parcours de test étape par étape

### Parcours A — Tester l'Espace Client
1. Connectez-vous avec **votre propre numéro** (n'importe quel numéro béninois à 10 chiffres commençant par `01`).
2. **Commander un Zem** :
   - Sur l'accueil, appuyez sur **Zem**. Un premier écran demande le type de moto-taxi :
     **Zem à essence** ou **Zem électrique**, au même tarif : **150 F de base**, puis
     **90 F/km de 0 à 10 km**, **85 F/km de 11 à 25 km**, **80 F/km au-delà** — avec **−25 %
     sur la base** dès que le trajet dépasse 10 km.
   - Vous arrivez ensuite sur la réservation : choisissez une destination à Cotonou
     (ex. *Aéroport*, *Ganhi*, *Haie Vive*), vérifiez le tarif estimé et confirmez la course.
     Un bandeau rappelle le Zem choisi, avec un bouton **Changer** pour revenir au choix.
   - Suivez la course en direct sur la carte (vous pouvez aussi l'annuler avant prise en charge).
3. **Commander une Voiture** :
   - Sur l'accueil, appuyez sur **Voiture** : les trois gammes disponibles sont **Gazelle**,
     **Koala (climatisé)** et **Léopard (premium)**. Les noms de gammes ne s'appliquent
     **jamais** à un Zem.
4. **Commander un Coursier / Livraison (Double sécurité OTP)** :
   - Sur l'accueil, appuyez sur **Livraison** ou **Coursier**.
   - Choisissez le type de mission : *Document*, *Petit Colis*, *Colis Moyen* ou **Coursier Personnel (Courses, pharmacie, achats)**.
   - Appuyez sur **Commander un coursier** : l'application génère **2 codes de sécurité à 4 chiffres** (un *Code ramassage* pour l'expéditeur et un *Code remise finale* pour le destinataire).
5. **Portefeuille AZƆ̀ Pay** :
   - Ouvrez l'onglet **Wallet** en bas : consultez votre solde, le cashback, les moyens de paiement (*MTN MoMo, Celtiis Cash, Moov Money, Visa UBA*) et testez le bouton **Recharger** (crédit immédiat du solde).

---

### Parcours B — Tester l'Espace Zem / Conducteur
1. Créez d'abord un compte Zem validé (voir **Parcours E**), puis connectez-vous avec ce numéro.
   ⚠️ **Important** : le dossier demande de choisir le véhicule — **Zem à essence** ou
   **Zem électrique**. Il faut un chauffeur dont le dossier **correspond exactement** au type
   de Zem commandé par le client, sinon la demande n'apparaît pas sur son radar.
2. Vous arrivez sur le **Zém Radar** :
   - Activez l'interrupteur **« Prêt à rouler »** (en haut à droite de la carte de statut).
   - Un bandeau indique votre véhicule : « **Radar Zem à essence — tu ne vois que ces demandes** ».
   - Les demandes compatibles s'affichent avec la distance et le gain net ; si aucun client n'a
     commandé ce type de Zem, l'écran l'explique explicitement.
   - Appuyez sur **Accepter la course** → saisir le **Code Bouclier AZƆ̀** à 4 chiffres affiché
     chez le client → **Terminer la course** : votre portefeuille AZƆ̀ Pay est crédité instantanément !
3. **Mode démonstration à un seul chauffeur** : pour qu'un Zem essence voie aussi les demandes
   de Zem électrique, passez `"radar": { "strictVehicleMatch": false }` dans
   `azo-backend/src/pricing/tarification.json` (puis `npm run sync:tarification` côté mobile).

---

### Parcours C — Tester l'Espace Coursier / Livreur
1. Créez un compte Coursier / Livreur validé (voir **Parcours E**), puis connectez-vous avec ce numéro.
2. Vous arrivez sur l'**Espace Coursier & Livreur** :
   - Consultez les missions disponibles déposées par les clients.
   - Appuyez sur **Accepter cette mission**.
   - **Étape 1 (Ramassage)** : une bannière affiche pendant **5 secondes** le code client à 4 chiffres (touchez-la ou saisissez les 4 chiffres) puis validez le ramassage.
   - **Étape 2 (Remise finale)** : saisissez le second code à 4 chiffres du destinataire puis appuyez sur **Livrer & encaisser** → votre solde AZƆ̀ Pay augmente du montant net !

---

### Parcours D — Tester l'Espace Agence de Flotte
1. Créez un compte Agence validé (voir **Parcours E**), puis connectez-vous avec ce numéro.
2. Vous arrivez sur le tableau de bord de votre flotte :
   - Visualisez la formule active (**Agence Pro / Argent / Or / Diamant**), la jauge de capacité, le chiffre d'affaires de la flotte et la note moyenne.
   - Consultez la **Grille officielle AZƆ̀** (*Agence Pro 100 000 F / Agence Argent 215 500 F / Agence Or 450 500 F / Agence Diamant 600 500 F*).
   - Testez le bouton **« + Ajouter »** pour rattacher un conducteur validé par son numéro à 10 chiffres.

---

### Parcours E — Tester l'Inscription d'un Nouveau Prestataire + Validation par l'Admin
1. **Créer une nouvelle demande prestataire** :
   - Sur l'écran de connexion, tapez **votre propre numéro à 10 chiffres (ex. `01 XX XX XX XX`)** et connectez-vous.
   - Une fois connecté, allez dans **Profil → Devenir Zem / Coursier / Agence** (ou appuyez sur **Compléter mon dossier**).
   - Remplissez les 5 étapes (Activité, Identité, Véhicule ou Formule d'Agence, Photos obligatoires **CNI + Selfie** avec l'appareil photo ou la galerie, puis Confirmation) et appuyez sur **Soumettre mon dossier**.
2. **Valider le dossier côté Administrateur (`01 97 00 00 00`)** :
   - Déconnectez-vous et connectez-vous avec le numéro Administrateur **`01 97 00 00 00`** *(astuce : vous pouvez aussi toucher l'icône de réglage en haut à droite de l'écran de connexion → « Se connecter en Administrateur »)*.
   - Dans la **Console de validation des prestataires**, filtrez par statut (*À traiter*) ou par activité (*Zem / Chauffeur*, *Coursier / Livreur*, *Agence*).
   - Ouvrez le dossier que vous venez de déposer :
     - Cliquez sur les miniatures photos pour les inspecter en plein écran.
     - Appuyez sur **Valider** sur chaque pièce, puis sur **Approuver et activer le compte**.
   - Appuyez enfin sur le bouton **« Pilotage »** en haut à droite pour voir les statistiques globales AZƆ̀, rechercher/bloquer un utilisateur et consulter le journal d'audit.
