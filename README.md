# AZƆ̀

AZƆ̀ est une plateforme de mobilité et de services composée d'une API NestJS et d'une application mobile Expo / React Native. Ce guide permet aux nouveaux collaborateurs d'installer le projet, de lancer l'API et l'application, puis de proposer leurs changements sans exposer de secrets.

## Structure du dépôt

| Chemin | Rôle |
|---|---|
| `azo-backend/` | API NestJS, schéma et migrations Prisma, tests Jest |
| `azo-mobile/` | Application Expo / React Native |
| `PROJECT_SUMMARY/` | Documentation produit et règles métier |
| `render.yaml` | Configuration du service backend et de PostgreSQL sur Render |

L'API couvre notamment l'authentification OTP, les courses et leur suivi en direct, le portefeuille, les livraisons, les locations, la marketplace, les artisans, les agences, les notifications, l'inscription des prestataires et l'administration.

## Prérequis

- Git
- Node.js 20.x (version déclarée par le backend dans `azo-backend/package.json`)
- npm
- Une base PostgreSQL pour le développement backend
- Expo Go sur un téléphone Android ou iOS pour tester sur appareil physique, ou un émulateur Android

Utilisez de préférence une base de développement personnelle. Ne lancez pas de seed ou d'opération destructive contre une base partagée ou de production.

## 1. Cloner le dépôt et créer une branche

La branche d'intégration partagée est `main`. Ne poussez pas directement les changements de fonctionnalité sur cette branche.

```powershell
git clone https://github.com/dorinpatinvoh/Azo.git
Set-Location Azo
git switch main
git pull --ff-only origin main
git switch -c feature/description-courte
```

Choisissez un nom descriptif, par exemple `feature/historique-courses` ou `fix/validation-otp`.

## 2. Configurer et lancer le backend

Depuis la racine du dépôt, dans PowerShell :

```powershell
Set-Location .\azo-backend
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Éditez localement `azo-backend/.env`. Renseignez au minimum :

- `DATABASE_URL` : URL de connexion PostgreSQL
- `JWT_SECRET` : secret de développement long et unique
- `PORT` : généralement `3000`
- `ADMIN_PHONE` : uniquement si vous initialisez un administrateur

Ne partagez jamais les URL de base de données, mots de passe, secrets JWT ou codes OTP dans une issue, un chat, un commit ou une capture d'écran. Le fichier `.env` est une configuration locale et ne doit pas être commité. Si un secret a été commité auparavant, supprimer le fichier d'un commit ultérieur ne l'efface pas de l'historique Git : renouvelez-le auprès du service concerné.

Générez le client Prisma et préparez la base :

```powershell
npx prisma generate
npx prisma migrate dev
```

`migrate dev` s'utilise avec une base locale ou jetable. Pour une base partagée ou déployée, appliquez les migrations déjà revues avec :

```powershell
npx prisma migrate deploy
```

Le seed est facultatif :

```powershell
npm run seed
```

Ne lancez pas le seed sur une base partagée sans avoir vérifié ses effets. Il peut initialiser l'administrateur à partir de `ADMIN_PHONE`.

Démarrez l'API :

```powershell
npm run start:dev
```

L'API écoute sur le port `3000`. Dans un autre terminal, vérifiez son état :

```powershell
Invoke-RestMethod http://localhost:3000/health
```

Une réponse saine contient `status: ok`. Pour compiler et tester le backend :

```powershell
npm run build
npm test -- --runInBand
```

En développement, l'OTP est simulé : le code est affiché dans le terminal du backend. N'utilisez pas la simulation ni le contournement OTP de développement en production.

### Utiliser la base de développement Render

Si un collaborateur a reçu l'autorisation d'utiliser la base partagée Render, il peut copier son **External Database URL** depuis le tableau de bord Render dans son `DATABASE_URL` local. Gardez cette URL secrète. L'URL interne Render ne fonctionne que pour les services connectés au réseau Render, pas depuis le PC du développeur.

Pour cette base partagée, utilisez `migrate deploy`, jamais `migrate dev`. Pour les expérimentations et données de seed, préférez une base personnelle. Les variables de déploiement `DATABASE_URL` et `JWT_SECRET` doivent rester dans les paramètres d'environnement Render, pas dans le dépôt.

## 3. Configurer et lancer l'application mobile

Ouvrez un second terminal PowerShell :

```powershell
Set-Location .\azo-mobile
npm ci
```

Créez `azo-mobile/.env.development.local` (ce fichier local est ignoré par Git) et indiquez l'URL du backend :

```env
EXPO_PUBLIC_API_URL=http://localhost:3000
```

Utilisez l'adresse correspondant à l'appareil qui exécute l'application :

| Appareil | URL de l'API |
|---|---|
| Expo Web sur le même PC | `http://localhost:3000` |
| Émulateur Android | `http://10.0.2.2:3000` |
| Téléphone physique avec Expo Go | `http://<IP-Wi-Fi-du-PC>:3000` |

Pour un téléphone physique, le téléphone et le PC doivent être connectés au même Wi-Fi. Trouvez l'adresse IPv4 du PC avec `ipconfig`, puis vérifiez d'abord `http://<IP-Wi-Fi-du-PC>:3000/health` dans le navigateur du téléphone. Si nécessaire, autorisez Node.js dans le pare-feu Windows pour le réseau privé.

Lancez Expo en mode LAN et videz son cache après une modification des variables d'environnement :

```powershell
npx expo start --clear --lan
```

Scannez le QR code avec Expo Go. Gardez les deux terminaux (backend et Expo) ouverts. Par défaut, l'application utilise l'URL du backend déployé ; la variable locale ci-dessus permet de tester avec le backend local.

Vérification des types mobiles :

```powershell
npx tsc --noEmit
```

## 4. Schéma et migrations de base de données

- Schéma Prisma : `azo-backend/prisma/schema.prisma`
- Migrations : `azo-backend/prisma/migrations/`
- Après une modification du schéma, créez une migration sur une base locale avec `npx prisma migrate dev --name nom_descriptif`.
- Relisez et commitez la migration avec le changement de schéma.
- Régénérez le client Prisma avec `npx prisma generate` si nécessaire.
- Déployez les migrations existantes avec `npx prisma migrate deploy` ; ne modifiez pas le schéma de production directement.

Ne commitez pas le client Prisma généré sous `azo-backend/node_modules`. Le dépôt contient actuellement des fichiers de dépendances générés suivis par Git ; évitez de les ajouter au commit et coordonnez leur retrait dans un changement de maintenance séparé.

## 5. Workflow d'équipe : branche de fonctionnalité vers `main`

1. Partez de la dernière version de `main` et créez une branche de fonctionnalité.
2. Réalisez un changement cohérent et lancez les builds, vérifications de types et tests pertinents.
3. Inspectez précisément les fichiers qui vont être commités :

   ```powershell
   git status --short
   git diff --check
   git diff
   ```

4. Ajoutez uniquement les fichiers source, migrations et documentation concernés. Évitez `git add .` si des fichiers d'environnement locaux ou du code généré sont présents.
5. Commitez et poussez votre branche :

   ```powershell
   git add chemin/du/fichier-modifie
   git commit -m "type(zone): description du changement"
   git push -u origin feature/description-courte
   ```

6. Ouvrez une pull request de la branche de fonctionnalité vers `main`. Demandez une revue, attendez les vérifications requises et fusionnez après approbation.
7. Après la fusion, mettez à jour `main`. Vous pouvez ensuite supprimer la branche qui vient d'être fusionnée. Ne supprimez jamais en masse les branches des autres collaborateurs.

Gardez `main` déployable. Ne force-pushez pas sur `main` et ne réécrivez pas l'historique d'une branche partagée.

## 6. Sécurité et fichiers locaux

- Gardez `.env`, `.env.development.local`, identifiants, OTP, clés de signature et certificats privés hors des commits.
- Utilisez des fichiers d'environnement locaux en développement et les paramètres Render pour le déploiement.
- La configuration Android actuelle référence `google-services.json`. Coordonnez sa provenance et sa politique de partage avec les responsables du projet ; ne commitez pas une configuration privée sans autorisation.
- Des fichiers `.env` et des dépendances backend générées ont été suivis par Git dans le passé. Leur retrait de la version actuelle ne purge pas l'historique. Renouvelez tout secret réel qui aurait été commité et planifiez séparément le nettoyage de l'historique et des dépendances avec les responsables.
- Avant chaque commit, relisez la liste complète des fichiers et le diff ; n'utilisez pas `git add .` sans vérification.

## Documentation complémentaire

- Détails API/backend : [`azo-backend/README.md`](./azo-backend/README.md)
- Rapport des travaux backend d'octobre 2026 : [`PROJECT_SUMMARY/RAPPORT_BACKEND_2026-10-08.md`](./PROJECT_SUMMARY/RAPPORT_BACKEND_2026-10-08.md)
- Guides produit : [`PROJECT_SUMMARY/`](./PROJECT_SUMMARY/)
