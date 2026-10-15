# Github Board

Webapp pour la **gestion personnalisée des Pull Requests GitHub** : organisez vos PRs dans des tableaux et des colonnes construits à partir de recherches GitHub, et ajoutez-y votre propre couche d'organisation (épinglage, priorités, tags, notes, snooze).

Frontend **React + TypeScript** (Vite, TanStack Query) et backend **Node.js + TypeScript** (Express). Le backend détient le token GitHub, interroge l'API REST GitHub et persiste les données personnelles de chaque utilisateur.

## Fonctionnalités

- **Dépôts suivis** : la liste des dépôts est définie dans [`shared/config.ts`](shared/config.ts) (`REPOS`) — actuellement `DiliTrust/service-clm`, `DiliTrust/DT_Public_API` et `DiliTrust/webapp-clm`. Un tableau **« Dépôts »** affiche les PRs à relire sur ces dépôts puis une colonne par dépôt, et un bandeau signale tout dépôt que le token ne peut pas lire
- **Tableaux multiples** (onglets) et **colonnes personnalisées**, chacune définie par une requête de [recherche GitHub](https://docs.github.com/search-github/searching-on-github/searching-issues-and-pull-requests) (`review-requested:@me`, `org:mon-org label:urgent`, `author:@me is:merged`…)
- Colonnes : couleur, tri, nombre max, réordonnables par glisser-déposer, lien direct vers la recherche sur GitHub
- **État de chaque PR** : CI (checks + statuts), décision de review, conflits, diff `+/−`, relecteurs demandés
- **Organisation personnelle** (sauvegardée par le serveur, par utilisateur GitHub) : épingler ★, priorité (haute/moyenne/basse), tags `#perso`, note privée, snooze jusqu'à une date, masquer
- Filtre instantané (titre, repo, auteur, labels, `#tag`, notes)
- Badge **« nouveau »** et **notifications navigateur** optionnelles par colonne
- Rafraîchissement automatique, compteur de quota API, thème clair/sombre, mode compact
- Export / import de la configuration en JSON (compatible avec les exports de l'ancienne version statique)
- Raccourcis : `/` filtrer, `r` rafraîchir

## Démarrage

Prérequis : **Node.js ≥ 22.18** (le backend est exécuté directement en TypeScript par Node) et **Yarn**.

```bash
git clone https://github.com/<vous>/Github-Board.git
cd Github-Board
yarn install
cp .env.example .env   # optionnel : GITHUB_TOKEN, PORT…
```

### Développement

```bash
yarn dev
```

Lance le backend (<http://127.0.0.1:3001>, rechargé à chaque modification) et le frontend Vite (<http://localhost:5173>, qui relaie `/api` vers le backend). Ouvrez <http://localhost:5173>.

### Production

```bash
yarn build   # compile le frontend dans client/dist
yarn start   # le backend sert l'API et le frontend compilé sur http://127.0.0.1:3001
```

### Configuration (`.env`)

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `GITHUB_TOKEN` | — | Token utilisé par le serveur. S'il est défini, aucune connexion n'est demandée (réservé à un usage local : toute personne joignant le serveur l'utilise). |
| `HOST` / `PORT` | `127.0.0.1` / `3001` | Adresse d'écoute du backend. |
| `DATA_FILE` | `server/data/state.json` | Fichier JSON des données personnelles (tableaux, notes…), par utilisateur GitHub. |

### Token

Créez un [Personal Access Token](https://github.com/settings/tokens/new?scopes=repo&description=Github%20Board) :

- **Classic** : scope `repo` (ou `public_repo` si vous ne suivez que des repos publics)
- **Fine-grained** : accès en lecture à *Pull requests*, *Contents*, *Commit statuses* et *Checks* sur les repos concernés

Les dépôts suivis étant **privés** et appartenant à l'organisation DiliTrust, le token doit y avoir accès ; si l'organisation impose le SSO SAML, autorisez le token pour DiliTrust (**Configure SSO → Authorize** dans la liste des tokens). Sinon, un bandeau d'alerte liste les dépôts inaccessibles (la recherche GitHub les ignorerait silencieusement).

Le token ne transite jamais par le navigateur une fois connecté : soit il est lu dans `GITHUB_TOKEN`, soit il est saisi à la connexion puis conservé **en mémoire** par le serveur, associé à un cookie de session `HttpOnly`. Un redémarrage du serveur demande donc de se reconnecter (sauf avec `GITHUB_TOKEN`).

## Structure

```
shared/              Code commun frontend/backend
  config.ts          Dépôts suivis (REPOS) — à modifier pour ajouter/retirer un dépôt
  types.ts           Types (tableaux, colonnes, PRs, session…)
  state.ts           Logique pure : état par défaut, migration, filtre, tri
  schema.ts          Validation (zod) de l'état sauvegardé
server/
  src/index.ts       Point d'entrée (variables d'environnement)
  src/app.ts         API REST Express (/api) + service du frontend compilé
  src/github.ts      Client REST GitHub (recherche, détails PR, accès aux dépôts, quota)
  src/store.ts       Persistance JSON par utilisateur
  test/              Tests du backend
client/
  index.html, vite.config.ts
  src/App.tsx        Session et chargement de l'état
  src/components/    Tableau, colonnes, cartes PR, dialogues, connexion
  src/state/         État personnel (contexte React, sauvegarde automatique)
  src/lib/           Client de l'API backend, formatage
  test/              Tests du frontend (Testing Library)
```

### API du backend

| Méthode et route | Rôle |
| --- | --- |
| `POST /api/session` · `GET` · `DELETE` | Connexion avec un token, session courante, déconnexion |
| `GET /api/state` · `PUT` | Lecture / sauvegarde de l'état personnel |
| `GET /api/search?q=&sort=&limit=` | Recherche de PRs |
| `GET /api/pulls/:owner/:repo/:number/details?updatedAt=` | CI, reviews, diff d'une PR (mis en cache) |
| `GET /api/repos/access` | Accès du token aux dépôts suivis |
| `GET /api/rate` | Quota GitHub restant |

### Modifier les dépôts suivis

Éditez le tableau `REPOS` de `shared/config.ts`. Le tableau « Dépôts » est généré à partir de cette liste pour un nouvel utilisateur (ou via **Réinitialiser**) ; une configuration existante conserve ses colonnes, ajustez-les si besoin. Le contrôle d'accès utilise toujours la liste à jour.

## Tests et vérifications

```bash
yarn test        # Vitest : shared + server (Node) et client (jsdom)
yarn typecheck   # TypeScript, backend et frontend
```

Le workflow `.github/workflows/ci.yml` exécute typecheck, tests et build à chaque push et pull request.

## Limites connues

- L'API de recherche GitHub est limitée à 30 requêtes/minute : une requête par colonne et par rafraîchissement.
- Le chargement des détails (CI, reviews) coûte ~4 appels par PR ouverte ; désactivable dans les paramètres.
- Les sessions sont gardées en mémoire : redémarrer le serveur déconnecte les utilisateurs (sauf avec `GITHUB_TOKEN`).
- L'app nécessite désormais un serveur Node : elle ne peut plus être publiée sur GitHub Pages.
- Si l'état est modifié depuis deux onglets en même temps, la dernière sauvegarde l'emporte.

## Licence

MIT
