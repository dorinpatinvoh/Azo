# Analyse des concurrents — Yango et Gozem : ce qu'ils ont et qu'AZƆ̀ n'a pas

Date : 11 octobre 2026 · À discuter avec l'équipe produit et technique

## 0. Lire ceci d'abord : fiabilité de l'analyse

- **Méthode** : recherche sur internet (fiches des magasins d'applications, sites officiels, presse économique africaine) comparée au **code réel d'AZƆ̀** (recherches ciblées dans l'application et le backend).
- **Limite principale : je n'ai pas utilisé les applications Yango et Gozem.** Les pages Google Play sont apparues tronquées. Tout ce qui suit vient de descriptions publiées, pas d'un test sur téléphone. Une fonction **absente de mes sources n'est pas forcément absente de l'application** : à vérifier en installant les deux applications à Cotonou.
- **Les services varient selon le pays et la ville.** Chaque ligne indique ce que la source dit, et pour quel pays quand elle le précise.
- Les niveaux de confiance : ✅ **confirmé** par une source officielle ou plusieurs sources · 🟡 **partiel** ou source unique · ❓ **non confirmé** (cherché, non trouvé).

## 1. Qui sont-ils au Bénin ?

| | **Gozem** | **Yango** |
|---|---|---|
| Positionnement | « Super app » d'Afrique francophone : transport, livraison, paiement ✅ | Super app d'origine Yandex : transport, livraison, nourriture ✅ |
| Au Bénin | Présent depuis 2019 (Cotonou, Lomé) ✅ | Lancé à Cotonou le 6 août 2024, **suspendu en décembre 2024** par les autorités pour absence d'autorisation, **autorisé à reprendre le 18 mars 2025** ✅. Situation en octobre 2026 : ❓ non vérifiée |
| Moto-taxi (Zem) | **Oui, c'est le produit d'origine** (« zemidjans ») ✅ | Pas de service moto trouvé au Bénin ❓. Un service de moto-taxi existe chez Yango en Angola (partenaire Anda), puis Mozambique, Cameroun, Ghana 🟡 |
| Régulation | Les autorités lui ont demandé de **régulariser sa situation** sous deux mois en décembre 2024 ✅ | Idem, suspension puis reprise ✅ |

**Constat stratégique** : le Zem à Cotonou est le terrain de Gozem, pas de Yango. Yango est plus un concurrent sur la voiture. Les deux ont été rappelés à l'ordre par les autorités béninoises : **la conformité réglementaire est un sujet pour AZƆ̀ aussi.**

## 2. Les fonctionnalités qu'ils ont et qu'AZƆ̀ n'a pas

Légende de la colonne AZƆ̀ : ❌ absent · ⚠️ existe en apparence mais non fonctionnel · 🟡 partiel.

### 2.1 Paiement (l'écart le plus important)

| Fonction | Gozem | Yango | AZƆ̀ aujourd'hui |
|---|---|---|---|
| **Paiement en espèces** | Oui ✅ | Probable, non confirmé par mes sources 🟡 | ❌ **Impossible.** Le client doit avoir un solde AZƆ̀ Pay suffisant **avant le départ** (contrôlé au démarrage) : un client sans solde ne peut pas rouler |
| **Mobile Money réel** (MTN, Moov, Celtiis) | Moov Flooz et Togocel T-money cités ; Moov Money au Bénin dès 2020 ✅ | « Yango Pay », portefeuille intégré sans frais de rechargement ✅ ; mobile money non confirmé 🟡 | ⚠️ **Simulé.** `POST /wallet/recharge` crédite sans paiement réel ; le bouton « Recharger » de l'application envoie un montant fixe de 5 000 F |
| **Carte bancaire** | Oui ✅ | Oui (code de vérification de 4 chiffres pour les paiements par carte) ✅ | ⚠️ Une carte « Visa UBA » s'affiche dans l'écran portefeuille, mais c'est une **donnée fictive** codée en dur |
| **Portefeuille avec transferts et paiements** | **Gozem Money** : transferts, factures, achats ; lancé à Lomé avec NSIA Banque Togo (les sources donnent septembre 2024 et octobre 2025). Pas de lancement au Bénin confirmé ✅ | Yango Pay 🟡 | 🟡 Portefeuille interne seulement (pas de transfert entre utilisateurs, pas de paiement de facture) |
| **Agents de dépôt / retrait** | « Devenez agent Gozem Money » ✅ | ❓ | ❌ |

### 2.2 Sécurité des passagers

| Fonction | Gozem | Yango | AZƆ̀ aujourd'hui |
|---|---|---|---|
| **Bouton SOS** vers les autorités locales | ❓ | Oui ✅ | ⚠️ Un bouton « Urgence » existe **mais dans un écran ancien non utilisé et sans aucune action** |
| **Partage du trajet** avec des contacts | ❓ | Oui ✅ | ❌ |
| **Photo + note du chauffeur avant la course** | ❓ | Oui (profil, note, photo récente) ✅ | 🟡 Nom masqué et téléphone masqué ; pas de photo, pas de note affichée |
| **Surveillance de la vitesse et de la conduite** (alertes au chauffeur, sanction en cas de récidive) | ❓ | Oui ✅ | ❌ |
| **Surveillance des écarts d'itinéraire** par l'assistance | ❓ | Oui au Ghana ✅ (en test ailleurs) | ❌ |
| **Bouton conflit** (enregistrement audio réservé à l'assistance) | ❓ | Oui où la loi le permet ✅ | ❌ |
| **Zones à risque** que le chauffeur peut refuser sans pénalité | ❓ | Oui dans certains pays ✅ | ❌ |
| **Contrôle d'identité périodique des chauffeurs** (selfies) | « Chauffeurs formés et certifiés » ✅ | Oui, selfies réguliers + contrôle des documents ✅ | 🟡 Dossier KYC à l'inscription (CNI, selfie, permis, assurance) ; pas de recontrôle périodique |
| **Assurance des courses** | Oui : trajets assurés, assistance accident (Atlantique Assurances au Bénin en 2019) ✅ | ❓ | ❌ |
| **Code de vérification à 4 chiffres** | ❓ | Oui (déployé en Namibie en janvier 2026) ✅ | ✅ **AZƆ̀ l'a déjà** : le « Code Bouclier » au départ, et un code d'arrivée |

### 2.3 Commande d'une course

| Fonction | Gozem | Yango | AZƆ̀ aujourd'hui |
|---|---|---|---|
| **Plusieurs arrêts** sur un même trajet | ❓ | Oui ✅ | ❌ |
| **Commander jusqu'à 3 véhicules à la fois** | ❓ | Oui ✅ | ❌ |
| **Suggestions de destination** d'après l'historique | ❓ | Oui ✅ | ❌ (seulement une liste fixe de lieux de Cotonou) |
| **Adresses enregistrées** (domicile, travail) | ❓ | ❓ | ❌ |
| **Course programmée / à l'avance** | ❓ non confirmé | ❓ non confirmé | ❌ |
| **Tricycle** (transport couvert) | Oui, lancé à Lomé et Cotonou en 2019 ✅ | ❓ | ❌ (Zem et trois gammes de voitures seulement) |
| **Voiture climatisée « Clim+ »** | Oui ✅ | Classes Economy / Comfort / « The Fastest » ✅ | ✅ Koala et Léopard sont climatisés |
| **Prix annoncé à l'avance** | Oui ✅ | Oui ✅ | ✅ |
| **Suivi GPS en direct** | Oui ✅ | Oui ✅ | ✅ |

### 2.4 Services au-delà du transport

| Service | Gozem | Yango | AZƆ̀ aujourd'hui |
|---|---|---|---|
| **Livraison de repas** | Oui ✅ | Oui (Yango Deli) 🟡 | ❌ |
| **Courses / épicerie** | Oui ✅ | ❓ | 🟡 « Marketplace » : le client paie en séquestre, mais **la validation ne libère les fonds à personne** (écriture inachevée) |
| **Bouteille de gaz** | Oui ✅ | ❓ | ❌ |
| **Colis / coursier** | Oui (Bénin et Togo depuis août 2020) ✅ | Oui, livraison à moto ou en voiture ✅ | ✅ Livraison avec double code (retrait et remise) |
| **Gros colis** | ❓ | **Cargo Express** (Abidjan, mars 2024), prix annoncé à l'avance, suivi sur carte ✅ | ❌ |
| **Billetterie** (tickets, passes, QR code) | Oui ✅ | ❓ | ❌ |
| **Recharge de crédit téléphonique** | Oui ✅ | ❓ | ❌ |
| **Location de véhicules** | ❓ | ❓ | ⚠️ Catalogue de **2 voitures codé en dur**, sans disponibilité ni paiement |

### 2.5 Fidélisation et croissance

| Fonction | Gozem | Yango | AZƆ̀ aujourd'hui |
|---|---|---|---|
| **Points de fidélité** | **GoWin** : points échangeables contre des récompenses ✅ | ❓ | ⚠️ Le portefeuille affiche un « cashback » mais il est **fictif** (voir §4) |
| **Parrainage / code promo personnel** | Programme de parrainage cité 🟡 | **Code promo personnel**, remise pour le parrain et le filleul sur la première course ✅ | ❌ |
| **Plusieurs langues** | Français ✅ | **Environ 30 langues** ✅ | ❌ Français seulement |
| **Aide et support dans l'application** | ❓ | Équipe d'assistance dédiée aux incidents ✅ | ❌ **Aucun écran d'aide, de FAQ ni de contact** dans les écrans Accueil et Profil (je n'ai pas fouillé les autres écrans) |
| **Reçus / factures** | ❓ | ❓ | ❌ (l'historique existe, pas de reçu à télécharger) |
| **Application légère** pour petits téléphones | ❓ | **Yango Lite** (fiche existante, contenu non lu) 🟡 | ❌ (APK de 87 Mo) |

### 2.6 Côté chauffeurs et partenaires (là où Gozem est très en avance)

| Fonction | Gozem (« Champions ») | Yango (application « Yango Pro ») | AZƆ̀ aujourd'hui |
|---|---|---|---|
| **Application séparée pour chauffeurs** | ❓ | Oui, Yango Pro ✅ | ❌ (même application, espace dédié) |
| **Financement du véhicule sans apport** (remboursé sur les gains) | Oui ✅ (partenariat avec Coris Bank International **Togo** pour les motos, annoncé en 2020) | ❌ ; Yango Motors vend des voitures avec financement en Côte d'Ivoire 🟡 | ❌ |
| **Financement d'un smartphone** | Oui ✅ | ❓ | ❌ |
| **Avance d'argent** (panne, accident, besoin ponctuel) | Oui ✅ | ❓ | ❌ |
| **Abonnement entretien et assurance** | Oui ✅ | ❓ | ❌ |
| **Suivi antivol du véhicule** | Oui, intégré ✅ | ❓ | ❌ |
| **Prise en charge rapide après accident** | Oui ✅ | ❓ | ❌ |
| **Coaching personnalisé** | Oui ✅ | ❓ | ❌ |
| **Statuts / niveaux de chauffeur** | « Champion Gold » ✅ | ❓ | ❌ |
| **Suivi des courses et des revenus** | Oui ✅ | Oui 🟡 | 🟡 Gains du jour et objectif ; pas de détail hebdomadaire ou mensuel |
| **Notation du client par le chauffeur** | ❓ | Retours du chauffeur sur le client ✅ | ❌ (seul le client note) |
| **Voir l'historique du client avant d'accepter** | ❓ | Oui (nombre de courses) ✅ | ❌ |

### 2.7 Marchands et entreprises

| Fonction | Gozem | Yango | AZƆ̀ aujourd'hui |
|---|---|---|---|
| **Application pour marchands** (« Gozem Marchand ») | Oui ✅ | ❓ | ❌ |
| **Vente en ligne avec logistique de livraison** | Oui ✅ | ❓ | ❌ |
| **Publicité dans l'application** | Oui ✅ | ❓ | ❌ |
| **Offres entreprises** : trajets des collaborateurs, livraison, gestion de flotte | Oui ✅ | Livraison pour entreprises ✅ | 🟡 « Agences » avec flotte, paliers de commission ; pas de compte entreprise pour les trajets |

## 3. Ce qu'AZƆ̀ a et que les concurrents n'affichent pas (ses points forts)

À mettre en avant, car ce sont des différences réelles :

- **Zem électrique distingué du Zem à essence**, avec son propre tarif (aucune des sources ne mentionne cette distinction chez les concurrents).
- **Arrêt anticipé à deux avec paiement à la distance réellement parcourue** (base + kilomètres) : je n'ai trouvé aucune fonction équivalente décrite chez eux. À confirmer en testant leurs applications.
- **Double code sécurisé** : code au départ et code d'arrivée, validés des deux côtés ; code de retrait et de remise pour les colis.
- **Dossier prestataire avec validation par un administrateur**, pièce par pièce, journalisé, avec chiffrement du NPI.
- **Agences et flottes** avec niveaux d'activation, commission dégressive et plafond de comptes.
- **Un seul tarif transparent**, lisible dans un fichier (`tarification.json`), modifiable sans toucher au code.

## 4. Problèmes de l'application actuelle repérés pendant la comparaison

Ce ne sont pas des fonctions de concurrents, mais ils faussent la comparaison et l'image du produit :

1. **Fausse donnée affichée en cas d'erreur** : si le chargement du portefeuille échoue, l'écran affiche **un solde de 48 500 F et un cashback de 1 250 F inventés** (`WalletScreen.tsx`). Un client pourrait croire à un solde qu'il n'a pas.
2. **Pourboire non branché** : l'écran de notation propose « Ajouter un pourboire (100 % reversé) », mais **seule la note est envoyée au serveur**, le montant du pourboire n'est jamais transmis.
3. **Écran « Urgence » sans action** (§2.2).
4. **Moyens de paiement fictifs** dans le portefeuille (cartes et numéros codés en dur).
5. **Marketplace** : le séquestre débite le client mais ne paie jamais le coursier ni le vendeur.

## 5. Ordre de priorité proposé

Classement par rapport entre l'importance pour gagner des clients à Cotonou et l'effort. **C'est une proposition à discuter, pas une décision.**

| Priorité | Chantier | Pourquoi |
|---|---|---|
| **1 — Bloquant pour le lancement** | **Paiement en espèces** + **vrai Mobile Money** (FedaPay / CinetPay déjà prévus dans la configuration) | Aujourd'hui, un client sans solde ne peut pas rouler, et la recharge est simulée. C'est la première barrière à l'usage réel |
| **1** | **Régulation** : obtenir l'autorisation de transport (les deux concurrents ont été rappelés à l'ordre) | Risque de suspension du service |
| **2 — Confiance** | **Bouton SOS réel** + **partage du trajet** + **photo et note du chauffeur** | Fonctions de sécurité déjà proposées par Yango ; renforce le Code Bouclier |
| **2** | **Écran d'aide / support** (contact, FAQ) et **corriger les fausses données** du §4 | Sans support, aucun recours en cas de problème |
| **3 — Croissance** | **Codes promo et parrainage**, points de fidélité | Acquisition peu coûteuse : Yango y mise |
| **3** | **Plusieurs arrêts**, **adresses enregistrées**, **suggestions de destination** | Confort de commande |
| **4 — Élargissement** | **Tricycle**, livraison de repas, gaz, billetterie, recharge de crédit | Gozem a déjà ces services, mais ils demandent des partenariats |
| **4** | **Côté chauffeurs** : financement, avances, assurance, coaching | Très fidélisant, mais demande des partenaires financiers (Gozem s'appuie sur des banques) |
| **5** | Application légère, plusieurs langues, offre entreprises | Utile plus tard |

## 6. Ce qu'il reste à vérifier (et comment)

1. **Installer Gozem et Yango à Cotonou** et dérouler une commande complète : confirmer paiement en espèces, partage de trajet, programmation à l'avance, support, SOS.
2. **Vérifier si Yango a toujours une activité au Bénin** en octobre 2026 (mes sources s'arrêtent à la reprise de mars 2025).
3. **Vérifier si Gozem Money est disponible au Bénin** : seul le Togo est confirmé.
4. **Confirmer les tarifs** des concurrents sur quelques trajets identiques à Cotonou (non couverts par cette recherche).

## 7. Sources

- Gozem, présentation officielle des services : https://gozem.co et https://website.gozem.co/bj
- Fiche Google Play de Gozem (résumé via recherche) : https://play.google.com/store/apps/details?id=com.gozem&hl=en_US
- Gozem et Moov Money au Bénin (2020) : https://techcabal.com/2020/05/09/in-benin-ride-hailing-startup-gozem-partners-etisalat-to-give-its-users-moov-money/
- Gozem, assurance avec Atlantique Assurances (2019) : https://www.financialafrik.com/2019/07/02/gozem-sallie-a-atlantique-assurances-pour-assurer-ses-chauffeurs-et-passagers-au-benin/
- Gozem, tricycles à Lomé et Cotonou (2019) : https://www.financialafrik.com/2019/07/16/gozem-lance-son-service-de-reservation-de-tricycles-passagers-a-lome-et-a-cotonou/
- Gozem Money (lancement Togo, NSIA) : https://techcabal.com/2025/10/14/togos-gozem-expands-into-mobile-money-with-new-fintech-platform/ et https://www.wearetech.africa/fr/fils/solutions/togo-gozem-une-super-application-de-transport-a-la-demande
- Yango, fiche App Store : https://apps.apple.com/us/app/yango-taxi-food-delivery/id1437157286
- Yango, outils de sécurité en Afrique : https://africanmediaagency.com/yango-introduces-state-of-the-art-safety-technologies-in-africa/
- Yango, code de vérification à 4 chiffres (Namibie, janvier 2026) : https://www.we.com.na/life-style-we/yango-rolls-out-verification-pin2026-01-29
- Yango au Bénin (lancement, suspension, reprise) : https://www.wearetech.africa/fr/fils/breves/breves-une/la-start-up-de-mobilite-yango-lance-ses-services-au-benin, https://www.afrik.com/benin-yango-suspendu-gozem-dans-le-viseur-des-autorites, https://www.afrik.com/yango-redemarre-ses-activites-au-benin-apres-une-periode-de-suspension
- Yango Cargo Express (gros colis, mars 2024) : https://africanmediaagency.com/?p=111014
- Yango Pay (portefeuille) : https://digitalmag.ci/yango-pay-solution-de-paiement-securisee-proposee-par-yango-dans-les-vtc/ (page non lisible directement, information issue du résumé de la recherche)
- Yango Motors (vente de véhicules, Côte d'Ivoire) : https://africanmediaagency.com/yango-group-launches-yango-motors-in-cote-divoire-debuting-at-abidjan-auto-show-2025/
