# UI — écrans, composants et charte

## Charte
Atelier Mission suit la charte **« néon monochrome »** de la Suite Atelier : toute l'interface dérive de sa couleur
signature, **l'ambre `#F59F00`** (`data-atelier-app="mission"`), en clair comme en sombre — fond teinté et fine grille,
cartes cerclées de la signature avec halo, bouton principal plein en clair et en contour néon en sombre.

L'ambre est la seule teinte libre entre l'orange de Nexus (`#E8590C`) et le jaune de Viz (`#F2C811`) ; elle évoque
l'argent sans être le vert « payé » (réservé au statut) ni le bleu de Trésorerie.

**Les couleurs qui portent un sens ne prennent jamais la signature** : elles réutilisent les 8 statuts officiels de la
suite (`design-system/components/mission.css`).

| Attribut | Valeurs → statut officiel |
|---|---|
| `data-stage` | NEW → open · QUALIFIED → progress · PROPOSAL → review · NEGOTIATION → hold · WON → closed · LOST → rejected |
| `data-quote` | DRAFT → open · SENT → review · ACCEPTED → closed · DECLINED → rejected · EXPIRED → hold |
| `data-invoice` | DRAFT → open · ISSUED → progress · PARTIALLY_PAID → resolved · PAID → closed · **OVERDUE → blocked** · CANCELLED → rejected |
| `data-reminder` | PLANNED → open · DUE → hold · SENT → closed · FAILED → rejected |
| `data-money` | in → closed · out → rejected · late → blocked |
| `data-channel` | MALT → signature · DIRECT → progress |

Typographie : pile système ; la police Nunito embarquée ne sert qu'à la marque `atelier_Mission`. Chiffres tabulaires
(`.ms-num`) pour tous les montants.

## Écrans

| Écran | Route | Composition |
|---|---|---|
| Tableau de bord | `#/` | 4 indicateurs · bandeaux d'action (temps non facturé, encaissements à synchroniser) · graphique 12 mois (encaissé / facturé HT) · pipeline par étape · liste « À faire » |
| Pipeline | `#/pipeline` | colonnes par étape (somme et nombre), cartes glissables, menu « Déplacer vers », fiche opportunité en fenêtre |
| Clients | `#/clients`, `#/clients/:id` | tableau (canal, opportunités, facturé, à encaisser) ; fiche : coordonnées, activité, opportunités, devis, factures |
| Devis | `#/devis`, `#/devis/:id` | filtres par statut ; éditeur de lignes, totaux, actions de statut, impression |
| Factures | `#/factures`, `#/factures/:id` | filtres statut + canal + recherche ; fiche : lignes, totaux, mentions, colonne latérale (versement Malt, temps lié, encaissements → Trésorerie, relances, historique) |
| Temps | `#/temps` | projets de Projets (temps à facturer), saisies filtrables, sélection, fenêtre « Facturer » avec aperçu |
| Relances | `#/relances` | onglets À envoyer / À venir / Historique, aperçu e-mail (iframe sans script), report, annulation |
| Paramètres | `#/parametres?onglet=` | Entreprise · Facturation & Malt · Relances · Connexions |

Captures : [`captures/`](captures/) (générées avec Playwright sur les données de démonstration).

![Facture imprimable](captures/facture-imprimable.png)

## Composants (frontend/src/components)
- `ui.tsx` — `Button` (`ds-btn`, variantes primary / ghost / danger), `Card`, `Kpi`, badges métier (`StageBadge`,
  `QuoteBadge`, `InvoiceBadge`, `ChannelBadge`, `ToneBadge`), `Money`, `Field` / `Input` / `Select` / `TextArea`,
  `Modal` (`<dialog>` natif), `Notice`, `EmptyState`, `Toasts`.
- `LinesEditor.tsx` — lignes de devis / facture : saisie à la française (« 2,5 », « 550 »), réordonnancement, lien
  vers les saisies de temps, totaux indicatifs (le backend fait foi).
- `OpportunityForm.tsx` — fiche opportunité (client existant ou nouveau, TJM × jours, projet Projets, lien Malt).
- `shell.tsx` — barre latérale, marque, sélecteur « Suite Atelier » (santé des apps), interrupteur Hors ligne / En ligne, thème Clair / Sombre / Système.

## Accessibilité
- Contrastes : textes de couleur via `--kind-ink` / `--accent-ink` (signature assombrie en clair, éclaircie en sombre).
- Statut jamais porté par la couleur seule : chaque badge a son libellé.
- Focus visible (`--focus-ring`), fenêtres modales natives, `aria-pressed` sur les filtres, `aria-current` sur la navigation.
- Glisser-déposer doublé d'un `<select>` « Déplacer vers » sur chaque carte.
