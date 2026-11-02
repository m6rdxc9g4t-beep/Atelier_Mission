# Design system d'Atelier Mission

CSS natif, sans dépendance. Point d'entrée : `@import "@atelier-mission/design-system";` puis
`@import "@atelier-mission/design-system/components";`.

| Fichier | Origine | Rôle |
|---|---|---|
| `tokens/colors.css` | copie verbatim d'Atelier Projets | 7 types + 8 statuts officiels de la suite |
| `themes/light.css`, `themes/dark.css` | copie verbatim | 6 variables de fondation, CSS pur exportable |
| `tokens/ui.css` | copie verbatim | jetons `--app-*`, `--accent*`, formes, typographie |
| `brand/atelier-brand.css` + Nunito | copie verbatim | marque commune, palette « néon monochrome » |
| `components/components.css`, `semantic.css` | copie verbatim | `ds-card`, `ds-btn`, `ds-badge`, `ds-table`, `ds-tabs`… |
| **`brand/mission-signature.css`** | Mission | signature **ambre `#F59F00`** pour `data-atelier-app="mission"` |
| **`components/mission.css`** | Mission | `data-stage`, `data-quote`, `data-invoice`, `data-reminder`, `data-channel`, `data-money` → `--kind-color` |

Les copies ne s'éditent pas ici : toute évolution se fait dans `Atelier_Projets/design-system/` puis se recopie.
Contrôle : `npm run check` (codes officiels, thèmes purs, aucune couleur littérale dans les fichiers dérivés, signature
de Mission chargée après la marque commune).
