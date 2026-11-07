# Design system d'Atelier Mission

CSS natif, sans dépendance. Point d'entrée : `@import "@atelier-mission/design-system";` puis
`@import "@atelier-mission/design-system/components";`.

| Fichier | Origine | Rôle |
|---|---|---|
| `tokens/colors.css` | copie verbatim d'Atelier Projets | 7 types + 8 statuts officiels de la suite |
| `themes/light.css`, `themes/dark.css` | copie verbatim | 6 variables de fondation, CSS pur exportable |
| `tokens/ui.css` | copie verbatim | jetons `--app-*`, `--accent*`, formes, typographie |
| `brand/atelier-brand.css` + Inter | copie verbatim | marque commune, palette v2 « Linear » (structure crème en clair / bleu nuit en sombre, `.atelier-kpi` pour les cartes de chiffres, signature de chaque app dont Mission `#b55d00`) |
| `brand/atelier-theme.js` | copie verbatim | préférence de thème commune à la suite (injectée dans le `<head>` par `frontend/vite.config.ts`) |
| `components/components.css`, `semantic.css` | copie verbatim | `ds-card`, `ds-btn`, `ds-badge`, `ds-table`, `ds-tabs`… |
| **`components/mission.css`** | Mission | `data-stage`, `data-quote`, `data-invoice`, `data-reminder`, `data-channel`, `data-money` → `--kind-color` (factures et relances colorées seulement quand anormales) |

Les copies ne s'éditent pas ici : toute évolution se fait dans `Atelier_Projets/design-system/` puis se recopie.
Contrôle : `npm run check` (codes officiels, thèmes purs, aucune couleur littérale dans les fichiers dérivés, signatures
des apps du sélecteur « Suite Atelier » présentes dans la marque commune).
