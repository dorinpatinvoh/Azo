# AZƆ̀ Backend (NestJS + PostgreSQL + Prisma)

API qui alimente l'application mobile : authentification OTP, courses, portefeuille,
livraison, location, marketplace, artisans, agences, administration, notifications.

## 1. Prérequis
- Node.js 18 ou 20
- PostgreSQL (local, ou gratuit en ligne sur https://neon.tech ou https://supabase.com)

## 2. Installation
```bash
cd azo-backend
npm install
cp .env.example .env        # puis édite .env (DATABASE_URL, JWT_SECRET)
npx prisma generate
npx prisma migrate dev --name init   # crée toutes les tables
npm run start:dev
```
L'API tourne sur http://localhost:3000

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
| Courses | `POST /rides/estimate`, `POST /rides`, `GET /rides/history`, `GET /rides/pending`, `POST /rides/:id/accept|start|complete|rate` |
| Temps réel | WebSocket : `ride:join`, `driver:location`, `ride:status` |
| Portefeuille | `GET /wallet`, `GET /wallet/transactions`, `POST /wallet/recharge` |
| Livraison | `POST /deliveries`, `POST /deliveries/:id/confirm-pickup|confirm-delivery` |
| Location | `GET /rentals/catalog`, `POST /rentals`, `GET /rentals/mine` |
| Marketplace | `POST /marketplace/orders`, `POST /marketplace/orders/:id/validate` |
| Artisans | `GET /artisans`, `POST /artisans/requests` |
| Agences | `POST /agencies`, `POST /agencies/drivers`, `GET /agencies/dashboard` |
| Admin | `GET /admin/stats`, `GET /admin/users` |
| Notifications | `GET /notifications`, `POST /notifications/read-all` |

## 5. Règles métier déjà codées
- Commission : 15 % pour un indépendant ; pour un chauffeur d'agence, le taux de la
  formule (PRO 3 %, ARGENT 2,5 %, OR 2 %, DIAMANT 1 %).
- Fin de course : le client est débité, le chauffeur crédité (prix − commission).
- Livraison : double code OTP (ramassage + remise).
- Marketplace : l'argent est bloqué en séquestre jusqu'à validation du client.

## 6. Rôles (guards)
`CLIENT`, `DRIVER`, `AGENCY`, `ADMIN`, `ARTISAN`. Pour te créer un admin en test :
```bash
npx prisma studio      # ouvre une interface web, change "role" de ton user en ADMIN
```

## 7. À faire ensuite (points à valider dans le guide)
- Brancher un vrai fournisseur SMS dans `auth.service.ts` (`requestOtp`).
- Brancher FedaPay/CinetPay dans `wallet` + un webhook de confirmation de paiement.
- Calcul de prix réel (distance/durée) et matching par proximité (PostGIS).
- Notifications push Firebase dans `notifications.module.ts`.
- Annulations, remboursements, litiges.
