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

## 🔑 3. Les 5 Comptes Pré-configurés pour tout tester immédiatement

Sur l'écran de connexion, toucher l'un des boutons (**Client**, **Zem / Chauffeur**, **Coursier / Livreur**, **Agence**) pré-remplit automatiquement le numéro de démonstration correspondant :

| Espace à tester | Numéro à 10 chiffres | Profil pré-chargé |
|---|---|---|
| **1. Espace Client** | **`01 97 00 00 42`** | **Kossi Boris Adjovi** — Portefeuille AZƆ̀ Pay crédité de **48 500 FCFA**, historique de courses et livraisons à Cotonou. |
| **2. Espace Zem / Chauffeur** | **`01 97 00 00 01`** | **Romaric Soglo** — Zem indépendant validé (*Haojue DK 150 · BJ-4821-AA*), solde **34 200 FCFA**, courses en attente dans le radar. |
| **3. Espace Coursier / Livreur** | **`01 97 00 00 04`** | **Fifamè Arnaud Zinsou** — Coursier personnel & express validé (*Bajaj Boxer · BJ-6712-AC*), missions de livraison en attente. |
| **4. Espace Agence (Flotte)** | **`01 97 00 00 10`** | **Atlantique Mobilité & Flotte Cotonou SARL** — Formule **AGENCE OR** (100 comptes, commission 2 %), 3 chauffeurs/coursiers actifs. |
| **5. Espace Administrateur** | **`01 97 00 00 00`** | **Direction Générale AZƆ̀ Bénin** — Validation des dossiers prestataires (KYC) et pilotage global. |

*(Pour vous déconnecter et changer de profil : allez dans **Profil → Se déconnecter**, ou appuyez sur l'icône de déconnexion en haut à droite des espaces professionnels).*

---

## 🧪 4. Parcours de test étape par étape

### Parcours A — Tester l'Espace Client (`01 97 00 00 42`)
1. Connectez-vous avec **`01 97 00 00 42`** (bouton **Client**).
2. **Commander un Zem ou une Voiture** :
   - Sur l'accueil, appuyez sur **Zem** ou **Voiture**.
   - Choisissez une destination à Cotonou (ex. *Aéroport*, *Ganhi*, *Haie Vive*), vérifiez le tarif estimé et confirmez la course.
   - Suivez la course en direct sur la carte (vous pouvez aussi l'annuler avant prise en charge).
3. **Commander un Coursier / Livraison (Double sécurité OTP)** :
   - Sur l'accueil, appuyez sur **Livraison** ou **Coursier**.
   - Choisissez le type de mission : *Document*, *Petit Colis*, *Colis Moyen* ou **Coursier Personnel (Courses, pharmacie, achats)**.
   - Appuyez sur **Commander un coursier** : l'application génère **2 codes de sécurité à 4 chiffres** (un *Code ramassage* pour l'expéditeur et un *Code remise finale* pour le destinataire).
4. **Portefeuille AZƆ̀ Pay** :
   - Ouvrez l'onglet **Wallet** en bas : consultez le solde (**48 500 FCFA**), le cashback, les moyens de paiement (*MTN MoMo, Celtiis Cash, Moov Money, Visa UBA*) et testez le bouton **Recharger**.

---

### Parcours B — Tester l'Espace Zem / Conducteur (`01 97 00 00 01`)
1. Connectez-vous avec **`01 97 00 00 01`** (bouton **Zem / Chauffeur**).
2. Vous arrivez sur le **Zém Radar** :
   - Activez l'interrupteur **« Prêt à rouler »** (en haut à droite de la carte de statut).
   - Vous voyez immédiatement les courses en attente des clients à Cotonou avec la distance et le gain net (commission AZƆ̀ déduite).
   - Appuyez sur **Accepter la course** → **Client à bord (Démarrer)** → **Terminer la course** : votre portefeuille AZƆ̀ Pay est crédité instantanément !

---

### Parcours C — Tester l'Espace Coursier / Livreur (`01 97 00 00 04`)
1. Connectez-vous avec **`01 97 00 00 04`** (bouton **Coursier / Livreur**).
2. Vous arrivez sur l'**Espace Coursier & Livreur** :
   - Consultez les missions disponibles (*Coursier Personnel — Supermarché Erevan → Haie Vive*, *Document — Ganhi → Cadjèhoun*).
   - Appuyez sur **Accepter cette mission**.
   - **Étape 1 (Ramassage)** : une bannière affiche pendant **5 secondes** le code client à 4 chiffres (touchez-la ou saisissez les 4 chiffres) puis validez le ramassage.
   - **Étape 2 (Remise finale)** : saisissez le second code à 4 chiffres du destinataire puis appuyez sur **Livrer & encaisser** → votre solde AZƆ̀ Pay augmente du montant net !

---

### Parcours D — Tester l'Espace Agence de Flotte (`01 97 00 00 10`)
1. Connectez-vous avec **`01 97 00 00 10`** (bouton **Agence**).
2. Vous arrivez sur le tableau de bord de **Atlantique Mobilité & Flotte Cotonou SARL** :
   - Visualisez la formule active (**Agence Or — Commission 2 %**), la jauge de capacité (**3 / 100 comptes**), le chiffre d'affaires de la flotte et la note moyenne (**4,9 ★**).
   - Consultez la **Grille officielle AZƆ̀** (*Agence Pro 100 000 F / Agence Argent 215 500 F / Agence Or 450 500 F / Agence Diamant 600 500 F*).
   - Testez le bouton **« + Ajouter »** pour rattacher un conducteur validé par son numéro à 10 chiffres (`01 97 00 00 01`).

---

### Parcours E — Tester l'Inscription d'un Nouveau Prestataire + Validation par l'Admin
1. **Créer une nouvelle demande prestataire** :
   - Sur l'écran de connexion, choisissez **Zem / Chauffeur**, **Coursier / Livreur** ou **Agence**, et tapez un **nouveau numéro à 10 chiffres** (ex. `01 96 00 11 22`).
   - Une fois connecté, allez dans **Profil → Devenir Zem / Coursier / Agence** (ou appuyez sur **Compléter mon dossier**).
   - Remplissez les 5 étapes (Activité, Identité, Véhicule ou Formule d'Agence, Photos obligatoires **CNI + Selfie** avec l'appareil photo ou la galerie, puis Confirmation) et appuyez sur **Soumettre mon dossier**.
2. **Valider le dossier côté Administrateur (`01 97 00 00 00`)** :
   - Déconnectez-vous et connectez-vous avec le numéro Administrateur **`01 97 00 00 00`** *(astuce : vous pouvez aussi toucher l'icône de réglage en haut à droite de l'écran de connexion → « Se connecter en Administrateur »)*.
   - Dans la **Console de validation des prestataires**, filtrez par statut (*À traiter*) ou par activité (*Zem / Chauffeur*, *Coursier / Livreur*, *Agence*).
   - Ouvrez un dossier (ex. *Gildas Agbossou*, *Prisca Hounkpatin*, *Bénin Express Logistique SARL* ou le dossier que vous venez de déposer) :
     - Cliquez sur les miniatures photos pour les inspecter en plein écran.
     - Appuyez sur **Valider** sur chaque pièce, puis sur **Approuver et activer le compte**.
   - Appuyez enfin sur le bouton **« Pilotage »** en haut à droite pour voir les statistiques globales AZƆ̀, rechercher/bloquer un utilisateur et consulter le journal d'audit.
