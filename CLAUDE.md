# CLAUDE.md — Atelier Mission

Contexte lu à chaque session dans ce dépôt. Spécifications fonctionnelles : `README.md` ; contrats : `docs/INTEGRATIONS.md`.

## 1. Trois espaces hermétiques
1. **`/design-system`** — CSS natif uniquement.
   - `themes/*.css`, `tokens/colors.css`, `tokens/ui.css`, `components/components.css`, `components/semantic.css`,
     `brand/atelier-brand.css` et `brand/atelier-theme.js` (+ police Inter) sont des **copies verbatim** d'Atelier Projets
     (charte v2 « Linear ») : ne jamais les éditer ici. La signature de Mission (ambre `#b55d00`, `data-atelier-app="mission"`)
     est dans la marque commune ; `atelier-theme.js` est injecté dans le `<head>` par `frontend/vite.config.ts`.
   - Propre à Mission : `components/mission.css` (`data-stage`, `data-quote`, `data-invoice`, `data-reminder`,
     `data-channel`, `data-money` → `--kind-color`, toujours dérivées des 8 statuts officiels ; factures et relances
     colorées seulement quand elles sont anormales).
   - Aucune couleur littérale hors `brand/` : `npm run check --workspace=@atelier-mission/design-system`.
2. **`/backend`** — Fastify 5 + TypeScript + Drizzle ORM + SQLite (better-sqlite3, transactions synchrones).
   - `domain/` : fonctions pures, testées. `services/` : règles + SQL, reçoivent un `Ctx`. `routes/` : minces
     (validation TypeBox stricte, aucun champ inconnu accepté). `integrations/` : seuls points de contact réseau.
   - Schéma : `src/db/schema.ts`, puis `npm run db:generate` (nouvelle migration). Ne jamais modifier une migration existante.
3. **`/frontend`** — React + Vite + Tailwind 4 + Zustand + Lucide. Aucun calcul métier (agrégats, totaux, TVA,
   retards : backend). Couleurs uniquement via les utilitaires reliés au design system (`--color-*: initial`).

## 2. Règles d'argent (non négociables)
- Montants en **centimes entiers** (`*Cents`), quantités en **millièmes** (`*Milli`), taux en **points de base** (`*Bps`),
  durées en **minutes**. Un seul arrondi, au centime, en fin de calcul. TVA calculée **par taux** sur la base HT.
- **Numérotation** : devis `D-AAAA-NNNN` à la création ; facture directe `F-AAAA-NNNN` **à l'émission**, dans la
  transaction, par `counters` ; avoir `A-AAAA-NNNN`. Chronologique : une date d'émission antérieure à la dernière facture est refusée.
- **Une facture émise est immuable** (lignes, client, montants) : seules les notes, la référence Malt et l'activation des
  relances changent. Correction = annulation par avoir. Coordonnées vendeur et client **figées** (`*_snapshot`) à l'émission.
- **Canal Malt** : pas de numéro légal propre (`externalRef` = n° Malt), pas de relance, frais `maltFeeBps` figés.
- **Temps** : une saisie (`time_entries`) liée à une ligne (`invoice_line_id`) n'est jamais refacturée ; modifier une
  ligne de brouillon en gardant son `id` garde le lien ; supprimer la ligne / le brouillon / annuler la facture le libère.

## 3. Intégrations
- **Atelier Projets** (lecture) : `GET /api/atelier/projects`, `GET /api/atelier/tables/time-entries?project_id=` (contrat `atelier-table/1`).
- **Atelier Trésorerie** (écriture) : `POST /api/transactions` avec `X-Requested-With`, champ **`amount` en euros décimaux**
  (`"1925.00"` — un entier serait lu comme des euros) ; listes enveloppées `{ items }`. Pas d'Idempotency-Key : marqueur
  `[mission:payment:<id>:<rôle>]` dans `notes`, recherché avant chaque création.
- Projets et Trésorerie : **adresses de bouclage uniquement** (`assertLoopbackUrl`), quel que soit le mode.
- **Brevo** : `POST https://api.brevo.com/v3/smtp/email`, en-tête `api-key`. Seul flux sortant ; **mode En ligne
  obligatoire** (hors ligne par défaut, `PUT /api/settings/online-mode` seulement, jamais via `PATCH /settings` ni le nœud).
  Clé lue dans `BREVO_API_KEY` uniquement : jamais stockée, jamais renvoyée.
- Toute chaîne venue des données (client, intitulé…) insérée dans du HTML (impression, e-mails) passe par `escapeHtml`.

## 4. Factur-X
- `domain/facturx.ts` (XML CII EN 16931, pur) + `print/facturx-pdf.ts` (PDF/A-3b) ; uniquement factures **directes émises**
  et avoirs (Malt → 409 `FACTURX_MALT`, brouillon → 409 `FACTURX_DRAFT`). Données figées à l'émission, sortie déterministe.
- Toute modification du XML ou du PDF : `npm run facturx:validate --workspace=@atelier-mission/backend` doit rester à
  0 erreur (Mustang : XSD, schématron EN 16931, veraPDF). Ordre des éléments CII imposé par le XSD.
- Franchise : catégorie `E` + `VATEX-FR-FRANCHISE` ; une ligne taxée est refusée à l'émission. `/AFRelationship /Data`.

## 5. Nœud Atelier (`atelier-node/1`)
- `/api/atelier/manifest`, `/events?since=&limit=&types=`, `/tables/{invoices|opportunities|unbilled-time}`, actions
  `opportunities.create` et `invoices.create_from_time` (en-tête `Idempotency-Key`), `time.import`, `reminders.run`.
- Événements émis par les **services**, dans la transaction de l'écriture (`emitEvent`) ; `data` = identifiants (chaînes),
  statuts, montants agrégés — jamais de ligne de données ni de secret. Nouveau type = `EVENT_TYPES` + test.

## 6. Méthode
- Étapes validées : `npm test`, `npm run check`, `npm run build` avant chaque commit.
- Textes d'interface et messages d'erreur **en français** ; erreurs API `{ statusCode, code, detail }`.
- Commits : Conventional Commits en français (`feat(factures): …`, `fix(tresorerie): …`).
