# Github Board

Webapp pour la **gestion personnalisée des Pull Requests GitHub** : organisez vos PRs dans des tableaux et des colonnes construits à partir de recherches GitHub, et ajoutez-y votre propre couche d'organisation (épinglage, priorités, tags, notes, snooze).

100 % statique (HTML/CSS/JS, aucune étape de build, aucun backend) : l'app tourne dans votre navigateur et parle directement à l'API REST GitHub.

## Fonctionnalités

- **Tableaux multiples** (onglets) et **colonnes personnalisées**, chacune définie par une requête de [recherche GitHub](https://docs.github.com/search-github/searching-on-github/searching-issues-and-pull-requests) (`review-requested:@me`, `org:mon-org label:urgent`, `author:@me is:merged`…)
- Colonnes : couleur, tri, nombre max, réordonnables par glisser-déposer, lien direct vers la recherche sur GitHub
- **État de chaque PR** : CI (checks + statuts), décision de review, conflits, diff `+/−`, relecteurs demandés
- **Organisation personnelle** (stockée localement) : épingler ★, priorité (haute/moyenne/basse), tags `#perso`, note privée, snooze jusqu'à une date, masquer
- Filtre instantané (titre, repo, auteur, labels, `#tag`, notes)
- Badge **« nouveau »** et **notifications navigateur** optionnelles par colonne
- Rafraîchissement automatique, compteur de quota API, thème clair/sombre, mode compact
- Export / import de la configuration en JSON
- Raccourcis : `/` filtrer, `r` rafraîchir

## Démarrage

### En ligne (GitHub Pages)

Le workflow `.github/workflows/pages.yml` publie l'app sur GitHub Pages à chaque push sur `main`.
Activez-le une fois dans **Settings → Pages → Source : GitHub Actions**.

### En local

```bash
git clone https://github.com/<vous>/Github-Board.git
cd Github-Board
python3 -m http.server 8080   # ou: npx serve .
```

Puis ouvrez <http://localhost:8080>. (Un serveur est nécessaire car l'app utilise des modules ES.)

### Token

Créez un [Personal Access Token](https://github.com/settings/tokens/new?scopes=repo&description=Github%20Board) :

- **Classic** : scope `repo` (ou `public_repo` si vous ne suivez que des repos publics)
- **Fine-grained** : accès en lecture à *Pull requests*, *Contents*, *Commit statuses* et *Checks* sur les repos concernés

Le token est conservé uniquement dans le `localStorage` de votre navigateur et n'est envoyé qu'à `api.github.com`.

## Structure

```
index.html        Page et dialogues
css/style.css     Styles (thèmes clair/sombre, responsive)
js/api.js         Client REST GitHub (recherche, détails PR, quota)
js/store.js       État persistant (tableaux, colonnes, métadonnées perso)
js/app.js         Rendu et interactions
```

## Limites connues

- L'API de recherche GitHub est limitée à 30 requêtes/minute : une requête par colonne et par rafraîchissement.
- Le chargement des détails (CI, reviews) coûte ~4 appels par PR ouverte ; désactivable dans les paramètres.
- Les données personnelles (notes, tags…) restent dans le navigateur : utilisez l'export JSON pour les transférer.

## Licence

MIT
