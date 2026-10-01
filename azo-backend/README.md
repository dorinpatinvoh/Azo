# AZƆ̀ Backend (NestJS + PostgreSQL + Prisma)

API qui alimente l'application mobile : authentification OTP, courses, portefeuille,
livraison, location, marketplace, artisans, agences, administration, notifications.

## 1. Prérequis
- Node.js 18 ou 20
- PostgreSQL (local, ou gratuit en ligne sur https://neon.tech ou https://supabase.com)

## 2. Installation
```bash
cd azo-backend
npm install                          # génère aussi le client Prisma (postinstall)
cp .env.example .env                 # puis édite .env (DATABASE_URL, JWT_SECRET, ADMIN_PHONE)
npx prisma generate                  # à refaire après chaque git pull (binaire lié à l'OS)
npx prisma migrate dev               # crée/mets à jour les tables
npm run seed                         # crée le compte ADMIN + régularise les prestataires existants
npm run start:dev
```
L'API tourne sur http://localhost:3000

> **Après un `git pull`** : relance `npx prisma generate` dès que `prisma/schema.prisma`
> a changé (le client généré dans le dépôt est celui d'une machine Linux). `npm install`
> ne retélécharge rien si `package.json`/`package-lock.json` n'ont pas bougé.

### Commandes prestataires (pratiques en développement)
```bash
npm run providers:list                             # comptes + état des dossiers
npm run providers:approve -- +22997000042          # approuve un dossier chauffeur
npm run providers:approve -- +22997000042 AGENCY   # approuve un dossier agence
```
`providers:approve` fait ce que fera le bouton « Approuver » de la console admin
(étape 3c) ; il existe pour ne pas bloquer les tests sur téléphone. L'API voit le nouveau
rôle immédiatement, mais l'app mobile route sur le rôle lu à la connexion : déconnecte puis
reconnecte le numéro dans l'app.

## 3. Tester rapidement (sans l'app)
```bash
# 1. Demander un code (il s'affiche dans la console du serveur en développement)
curl -X POST localhost:3000/auth/request-otp -H "Content-Type: application/json" -d '{"phone":"97000042"}'

# 2. Vérifier le code -> renvoie un token JWT
curl -X POST localhost:3000/auth/verify-otp -H "Content-Type: application/json" -d '{"phone":"97000042","code":"1234"}'

# 3. Utiliser le token
curl localhost:3000/users/me -H "Authorization: Bearer TON_TOKEN"
curl localhost:3000/wallet   -H "Authorization: Bearer TON_TOKEN"
```

## 4. Endpoints principaux
| Module | Routes |
|---|---|
| Auth | `POST /auth/request-otp`, `POST /auth/verify-otp` |
| Utilisateur | `GET/PATCH /users/me` |
| Courses | `POST /rides/estimate`, `POST /rides`, `GET /rides/history`, `GET /rides/pending`, `GET /rides/:id`, `POST /rides/:id/accept|start|complete|rate|cancel` |
| Prestataires | `GET /providers/me`, `POST /providers/applications`, `POST /providers/applications/:id/documents`, `POST /providers/applications/:id/submit` |
| Temps réel | WebSocket : `ride:join`, `driver:location`, `ride:status` |
| Portefeuille | `GET /wallet`, `GET /wallet/transactions`, `POST /wallet/recharge` |
| Livraison | `POST /deliveries`, `POST /deliveries/:id/confirm-pickup|confirm-delivery` |
| Location | `GET /rentals/catalog`, `POST /rentals`, `GET /rentals/mine` |
| Marketplace | `POST /marketplace/orders`, `POST /marketplace/orders/:id/validate` |
| Artisans | `GET /artisans`, `POST /artisans/requests` |
| Agences | `POST /agencies/drivers`, `DELETE /agencies/drivers/:userId`, `GET /agencies/dashboard` |
| Admin | `GET /admin/stats`, `GET /admin/users` |
| Admin — prestataires | `GET /admin/providers`, `GET /admin/providers/stats`, `GET /admin/providers/:id`, `POST /admin/providers/:id/start-review`, `POST /admin/providers/:id/documents/:docId/decision`, `POST /admin/providers/:id/decision`, `POST /admin/providers/:id/reinstate` |
| Notifications | `GET /notifications`, `POST /notifications/read-all` |

## 5. Règles métier déjà codées
- Commission : 15 % pour un indépendant ; pour un chauffeur d'agence, le taux de la
  formule (PRO 3 %, ARGENT 2,5 %, OR 2 %, DIAMANT 1 %).
- Fin de course : le client est débité, le chauffeur crédité (prix − commission).
- Livraison : double code OTP (ramassage + remise).
- Marketplace : l'argent est bloqué en séquestre jusqu'à validation du client.
- **Prestataires** : l'inscription crée toujours un compte `CLIENT`. Le rôle métier
  (`DRIVER`, `AGENCY`) n'est accordé qu'à l'approbation d'un dossier par un admin.
  Détails dans `PROJECT_SUMMARY/PRESTATAIRES.md`.
- **Agences** : rattachement d'un chauffeur uniquement si son dossier est approuvé, dans
  la limite du plafond de la formule, avec notification et retrait possible.

## 6. Rôles (guards)
`CLIENT`, `DRIVER`, `AGENCY`, `ADMIN`, `ARTISAN`.

Le rôle `ADMIN` ne peut être obtenu **que** par le seed (aucune route de l'API ne
l'attribue) :
```bash
# dans azo-backend/.env
ADMIN_PHONE="+22997000000"
npm run seed
```
En cas de besoin ponctuel, `npx prisma studio` permet aussi de modifier un compte à la main.

## 7. À faire ensuite (points à valider dans le guide)
- Étape 3b : wizard de dépôt de dossier + écran « Dossier en cours » dans l'app mobile.
- Étape 3c : console de validation admin dans l'app (file d'attente, pièces, décisions).
- Étape 3d : upload réel des pièces (photos/PDF), espaces Artisan et Coursier,
  débit des frais d'activation des agences.
- Étape 3e : `JWT_SECRET` obligatoire (supprimer la valeur de secours), limite de
  tentatives OTP, socket.io authentifié, retirer `.env` et `node_modules/` du dépôt.
- Brancher un vrai fournisseur SMS dans `auth.service.ts` (`requestOtp`).
- Brancher FedaPay/CinetPay dans `wallet` + un webhook de confirmation de paiement.
- Calcul de prix réel (distance/durée) et matching par proximité (PostGIS).
- Notifications push Firebase dans `notifications.module.ts`.
