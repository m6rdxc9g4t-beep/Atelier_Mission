# Intégrations d'Atelier Mission

Atelier Mission est le carrefour commercial de la Suite Atelier : il **lit** le temps d'Atelier Projets, **écrit** les
encaissements dans Atelier Trésorerie, **envoie** les relances par Brevo et **publie** ses événements pour Atelier Nexus.

| App | Sens | Adresse par défaut | Réseau | Garde |
|---|---|---|---|---|
| Atelier Projets | lecture | `http://127.0.0.1:3000` | bouclage | `assertLoopbackUrl` |
| Atelier Trésorerie | écriture | `http://127.0.0.1:5050` | bouclage | `assertLoopbackUrl` + `X-Requested-With` |
| Brevo | écriture | `https://api.brevo.com/v3` | **Internet** | mode **En ligne** + `BREVO_API_KEY` + expéditeur |
| Atelier Nexus | lecture/écriture de Mission | `http://127.0.0.1:3001/api/atelier/*` | bouclage | garde `local-only` |

Les adresses de Projets et Trésorerie se règlent dans *Paramètres › Connexions* ; une adresse hors bouclage est refusée (403 `FORBIDDEN_HOST`).

---

## 1. Atelier Projets → temps passé → facture

**Appels** (contrat `atelier-node/1` d'Atelier Projets, `docs/SUITE.md` §4.3 et §7 de Projets) :

| Appel | Utilisation |
|---|---|
| `GET /api/health` | indicateur « en marche » |
| `GET /api/atelier/projects` | liste des projets (id, nom) pour lier une opportunité et choisir le projet à facturer |
| `GET /api/atelier/tables/time-entries?project_id=<id>` | saisies du projet au format `atelier-table/1` : `id, element_id, element, type, projet, date, heures, commentaire` |

**Import** (`POST /api/time/import { projectId }`, service `applyTimeSnapshot`) — un instantané complet du projet :

| Cas | Saisie non facturée | Saisie déjà facturée |
|---|---|---|
| nouvelle | créée | — |
| identique | inchangée | inchangée |
| modifiée dans Projets | mise à jour | mise à jour **et signalée** (`changed_after_billing`) |
| disparue de Projets | supprimée | conservée **et signalée** (`removed_in_projets`) |

Si Projets renvoie `truncated: true`, les disparitions ne sont pas appliquées (instantané incomplet).
Heures décimales → minutes entières (`1,25 h` → `75 min`). Événement `mission.time.imported`.

**Facturation** (`POST /api/invoices/from-time/preview` puis `/from-time`) : saisies non facturées du projet (sélection
explicite ou période), unité **jour** (minutes ÷ heures par jour × 60, TJM) ou **heure**, regroupement par élément,
projet ou saisie. Chaque ligne créée est reliée à ses saisies (`time_entries.invoice_line_id`) : elles ne sont plus
proposées. Supprimer la ligne ou le brouillon, ou annuler la facture, les libère.

## 2. Encaissement → Atelier Trésorerie

Relevé sur le code et vérifié sur une instance réelle de Trésorerie :

- `GET /api/ping` → `{ app: "atelier-tresorerie" }` (santé légère) ;
- `GET /api/accounts`, `GET /api/categories` → **`{ items: [...] }`** ;
- `POST /api/transactions` — en-tête **`X-Requested-With`** obligatoire (sinon 403), corps :

```json
{ "account_id": 1, "date": "2026-11-03", "label": "Bellevue — facture Malt M-1",
  "amount": "1925.00", "category_id": 15, "notes": "… [mission:payment:12:encaissement]", "status": "valide" }
```

⚠️ `amount` est en **euros** (chaîne décimale). Un entier serait interprété comme des euros (`1925` → 1 925 €), pas des centimes.

**Opérations créées par encaissement** (`tresorerieOperations`, pur et testé) :

| Canal | Opération | Montant | Catégorie |
|---|---|---|---|
| Direct | « Client — facture F-… » | + montant reçu | catégorie des encaissements |
| Malt | « Client — facture Malt … » | + montant reçu (brut facturé) | catégorie des encaissements |
| Malt | « Frais de service Malt — … » | − frais TTC au prorata | catégorie des frais Malt |

**Sans doublon** : Trésorerie n'a pas d'`Idempotency-Key`. Chaque opération porte un marqueur
`[mission:payment:<id>:encaissement|frais-malt]` dans ses notes ; avant de créer, Mission cherche
`GET /api/transactions?q=<marqueur>`. Un nouvel essai retrouve l'opération au lieu de la recréer.

**États** d'un encaissement : `PENDING` (compte non choisi), `SYNCED` (ids des opérations mémorisés), `FAILED`
(Trésorerie arrêtée ou refus — message conservé, bouton *Envoyer*), `SKIPPED`. Supprimer un encaissement déjà
synchronisé affiche un avertissement : l'opération Trésorerie reste à supprimer à la main.

## 3. Relances → Brevo

`POST https://api.brevo.com/v3/smtp/email`, en-tête `api-key: xkeysib-…` :

```json
{ "sender": { "email": "factures@vous.fr", "name": "Camille Martin" },
  "to": [{ "email": "compta@client.fr", "name": "Client" }],
  "bcc": [{ "email": "vous@vous.fr" }], "replyTo": { "email": "vous@vous.fr" },
  "subject": "Relance : facture F-2026-0002 impayée (20 jours de retard)",
  "htmlContent": "…", "textContent": "…", "tags": ["atelier-mission", "relance-2"] }
```

- **Garde-fous**, dans l'ordre : mode En ligne (`OFFLINE`), clé configurée (`BREVO_NOT_CONFIGURED`), expéditeur
  (`BREVO_NO_SENDER`), facture encore ouverte, e-mail client connu.
- **Planification** à l'émission d'une facture directe : 3 niveaux, par défaut J+3, J+15, J+30 après l'échéance.
  Annulées au paiement complet ou à l'annulation, replanifiées si un encaissement est supprimé.
- **Une seule relance par facture et par passage** : si plusieurs niveaux sont dus (app fermée quelques jours), seul le
  plus élevé part, les autres passent « dépassées ».
- **Envoi automatique** (planificateur toutes les `REMINDER_TICK_MINUTES`) seulement si activé *et* en ligne ; sinon
  envoi manuel depuis l'écran Relances.
- Envoyé à Brevo : nom et e-mail du client, numéro / date / titre / reste à payer de la facture, votre nom, e-mail, IBAN.
  Rien d'autre (ni lignes, ni autres clients).

## 4. Atelier Nexus — nœud `atelier-node/1`

`GET /api/atelier/manifest` :

| Action | Type | Route | Idempotence |
|---|---|---|---|
| `opportunities.list` | read | `GET /api/atelier/opportunities` | none |
| `opportunities.create` | write | `POST /api/atelier/opportunities` | `Idempotency-Key` |
| `invoices.list` | read | `GET /api/atelier/invoices` | none |
| `time.import` | write | `POST /api/atelier/time/import` | natural |
| `invoices.create_from_time` | write | `POST /api/atelier/invoices/from-time` | `Idempotency-Key` |
| `reminders.run` | write | `POST /api/atelier/reminders/run` | natural (n'envoie rien hors ligne ou si l'envoi automatique est coupé) |
| `tables.get` | read | `GET /api/atelier/tables/{invoices,opportunities,unbilled-time}` | none |

**Événements** (`GET /api/atelier/events?since=&limit=&types=`, `seq` persistant, rétention 1 000 / 30 jours, `gap`) :

| Type | `subject.kind` | `data` |
|---|---|---|
| `mission.opportunity.created` | opportunity | `client_id`, `stage`, `source`, `amount_cents` |
| `mission.opportunity.stage_changed` | opportunity | `client_id`, `from`, `to`, `amount_cents` |
| `mission.quote.sent` / `.accepted` | quote | `client_id`, `opportunity_id`, `total_ht_cents` |
| `mission.invoice.issued` | invoice | `client_id`, `channel`, `total_ttc_cents`, `due_date` |
| `mission.invoice.paid` | invoice | `client_id`, `total_ttc_cents`, `channel` |
| `mission.invoice.cancelled` | invoice | `client_id`, `credit_note_id` |
| `mission.payment.recorded` | invoice | `client_id`, `payment_id`, `amount_cents`, `received_on` |
| `mission.reminder.sent` | invoice | `client_id`, `level`, `balance_cents` |
| `mission.time.imported` | projets_project | `created`, `updated`, `removed`, `flagged` |

Exemples de workflows Nexus : *facture payée → message de remerciement* ; *chaque lundi : importer le temps et préparer
les brouillons* ; *opportunité gagnée → créer le projet dans Projets*.

## 5. À faire en amont (autres dépôts)
- **Atelier Projets** : ajouter `--atelier-sig-mission: #f59f00` et la règle `[data-atelier-app="mission"]` à
  `design-system/brand/atelier-brand.css` (puis supprimer `brand/mission-signature.css` ici) ; ajouter Mission au
  sélecteur « Suite Atelier » (port 4176) et à `docs/SUITE.md` (ports §2, événements §7.3).
- **Atelier Trésorerie** : accepter un `Idempotency-Key` sur `POST /api/transactions` rendrait le marqueur inutile.
