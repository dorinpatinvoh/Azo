# AZƆ̀ — Console administrateur web

Site statique (React + Vite) qui reprend **tout ce que l'administrateur fait dans l'application mobile**, et plus confortablement sur ordinateur. Il appelle l'API du serveur (`azo-backend`) ; il n'a pas de serveur à lui.

| Page | Ce qu'on y fait |
|---|---|
| Tableau de bord | Gains, courses et livraisons, dossiers à traiter et en retard, dernières actions |
| Dossiers | Liste filtrée, fiche complète, **lecture des pièces** (photos, PDF), valider / refuser chaque pièce, commencer l'examen, valider, refuser, demander une information, suspendre, rétablir, historique |
| Utilisateurs | Recherche, bloquer / débloquer, notes à zéro, consulter le NPI (accès journalisé) |
| Finances | Gains par source et par mois, **commission de chaque course** (prestataire, client, trajet, distance), demandes de retrait (créer, marquer versé, annuler) |
| Commerciaux | Créer un commercial (code `COM-AZO001` + lien personnel), ses recrues, actifs / inactifs / recharges, rattacher / retirer une recrue, désactiver |
| Support | Demandes des utilisateurs : lire, répondre, fermer |
| Corrections d'identité | Accepter ou refuser les demandes après la fenêtre de 24 h |
| Location de voitures | Catalogue : ajouter, modifier les prix, retirer |
| Journal d'audit | Les 60 dernières actions sur les dossiers |

## Connexion

Numéro de téléphone + **mot de passe** (jeton de 12 heures, 5 erreurs = numéro bloqué 15 minutes). Pas de SMS.

Créer ou mettre à jour un administrateur et son mot de passe (depuis `azo-backend`, avec l'adresse de la base de production dans `DATABASE_URL`) :

```powershell
$env:ADMIN_PASSWORD = "UnMotDePasseSolide2026"      # 10 caractères minimum, une lettre et un chiffre
node scripts/create-admin.js 0149454528 --allow-remote
```

Le mot de passe est haché (scrypt) : il n'est ni affiché ni enregistré en clair.

## Mise en ligne sur Cloudflare Pages

1. Cloudflare → **Workers & Pages** → **Create** → **Pages** → connecter le dépôt GitHub.
2. Réglages de construction :
   - **Root directory** : `admin-web`
   - **Build command** : `npm run build`
   - **Build output directory** : `dist`
   - Variables : `VITE_API_URL` = `https://azo-backend.onrender.com` (adresse du serveur) et `NODE_VERSION` = `20`
3. Domaine personnalisé (ex. `admin.angidsnpro.com`).
4. **Cloudflare Access** (Zero Trust → Access → Applications) : n'autoriser que les adresses e-mail de l'équipe pour ouvrir le site. C'est une deuxième porte avant même la page de connexion.
5. Sur **Render** (service `azo-backend` → Environment) : `CORS_ORIGINS` = `https://admin.angidsnpro.com` pour que seul ce site puisse appeler le serveur depuis un navigateur.

## Développement

```bash
npm install
cp .env.example .env     # VITE_API_URL
npm run dev
npm run build            # vérifie les types puis construit dans dist/
```
