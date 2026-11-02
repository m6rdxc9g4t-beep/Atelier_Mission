// Nœud Atelier (contrat atelier-node/1, Suite Atelier §7) : manifeste, événements, tables atelier-table/1 et
// quelques actions utiles à Atelier Nexus. Sorties en snake_case, erreurs { detail, code }.
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Type } from 'typebox'
import { BACKEND_ROOT } from '../config.ts'
import { STAGE_LABELS } from '../domain/pipeline.ts'
import { INVOICE_STATUS_LABELS } from '../domain/invoicing.ts'
import { toSnake } from '../domain/snake-case.ts'
import { notFound } from '../http/errors.ts'
import { EVENT_TYPES, listEvents } from '../services/events.ts'
import { withIdempotency } from '../services/idempotency.ts'
import { listInvoices } from '../services/invoices.ts'
import { createOpportunity, listOpportunities } from '../services/opportunities.ts'
import { createInvoiceFromTime, importTimeFromProjets, listTimeEntries } from '../services/time.ts'
import { runDueReminders } from '../services/reminders.ts'
import { Id, IsoDate, Strict } from './schemas.ts'

const { version } = JSON.parse(readFileSync(path.join(BACKEND_ROOT, 'package.json'), 'utf8')) as { version: string }

type ColumnType = 'string' | 'number' | 'date' | 'datetime' | 'boolean'
const col = (key: string, label: string, type: ColumnType) => ({ key, label, type })

const TABLES = {
  invoices: {
    label: 'Factures',
    columns: [
      col('id', 'ID', 'number'),
      col('numero', 'Numéro', 'string'),
      col('client', 'Client', 'string'),
      col('canal', 'Canal', 'string'),
      col('statut', 'Statut', 'string'),
      col('statut_code', 'Code statut', 'string'),
      col('emise_le', 'Émise le', 'date'),
      col('echeance', 'Échéance', 'date'),
      col('total_ht', 'Total HT (€)', 'number'),
      col('total_ttc', 'Total TTC (€)', 'number'),
      col('encaisse', 'Encaissé (€)', 'number'),
      col('reste_a_payer', 'Reste à payer (€)', 'number'),
    ],
  },
  opportunities: {
    label: 'Opportunités',
    columns: [
      col('id', 'ID', 'number'),
      col('titre', 'Titre', 'string'),
      col('client', 'Client', 'string'),
      col('source', 'Source', 'string'),
      col('etape', 'Étape', 'string'),
      col('etape_code', 'Code étape', 'string'),
      col('montant', 'Montant estimé HT (€)', 'number'),
      col('probabilite', 'Probabilité (%)', 'number'),
      col('pondere', 'Montant pondéré (€)', 'number'),
      col('prochaine_action', 'Prochaine action', 'string'),
      col('prochaine_action_le', 'Prochaine action le', 'date'),
    ],
  },
  'unbilled-time': {
    label: 'Temps non facturé',
    columns: [
      col('id', 'ID', 'number'),
      col('projet', 'Projet', 'string'),
      col('element_id', 'ID de l’élément', 'number'),
      col('element', 'Élément', 'string'),
      col('date', 'Date', 'date'),
      col('heures', 'Heures', 'number'),
    ],
  },
} as const

type TableName = keyof typeof TABLES

const ACTIONS = [
  { id: 'opportunities.list', label: 'Lister les opportunités', description: 'Pipeline commercial (ouvertes et closes).', kind: 'read', method: 'GET', path: '/api/atelier/opportunities', idempotency: 'none' },
  { id: 'opportunities.create', label: 'Créer une opportunité', description: 'Ajoute un prospect au pipeline (colonne « Nouveau » par défaut).', kind: 'write', method: 'POST', path: '/api/atelier/opportunities', idempotency: 'header' },
  { id: 'invoices.list', label: 'Lister les factures', description: 'Factures avec statut effectif (en retard compris) et reste à payer.', kind: 'read', method: 'GET', path: '/api/atelier/invoices', idempotency: 'none' },
  { id: 'time.import', label: 'Importer le temps d’un projet', description: 'Relit les saisies de temps d’un projet d’Atelier Projets (réimport sans doublon).', kind: 'write', method: 'POST', path: '/api/atelier/time/import', idempotency: 'natural' },
  { id: 'invoices.create_from_time', label: 'Facturer le temps passé', description: 'Crée une facture brouillon à partir des saisies non facturées d’un projet.', kind: 'write', method: 'POST', path: '/api/atelier/invoices/from-time', idempotency: 'header' },
  { id: 'reminders.run', label: 'Envoyer les relances dues', description: 'Envoie par Brevo les relances arrivées à échéance (mode En ligne uniquement).', kind: 'write', method: 'POST', path: '/api/atelier/reminders/run', idempotency: 'natural' },
  { id: 'tables.get', label: 'Lire une table de Mission', description: 'Factures, opportunités ou temps non facturé au format atelier-table/1.', kind: 'read', method: 'GET', path: '/api/atelier/tables/{name}', idempotency: 'none' },
] as const

const euros = (cents: number) => Math.round(cents) / 100

export const atelierRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/manifest', async () => ({
    contract: 'atelier-node/1',
    app: 'mission',
    name: 'Atelier Mission',
    version,
    transport: 'http',
    actions: ACTIONS.map((a) => ({
      id: a.id,
      label: a.label,
      description: a.description,
      kind: a.kind,
      http: { method: a.method, path: a.path },
      mcp_tool: null,
      input_schema: { type: 'object', properties: {}, required: [] },
      output: { format: a.id === 'tables.get' ? 'atelier-table/1' : 'json', schema: {} },
      idempotency: a.idempotency,
    })),
    events: EVENT_TYPES.map((type) => ({ type, label: type.split('.').slice(1).join(' '), data_schema: { type: 'object' } })),
  }))

  app.get(
    '/events',
    { schema: { querystring: Strict({ since: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })), types: Type.Optional(Type.String({ maxLength: 1000 })) }) } },
    async (req) => listEvents(app.ctx.db, { since: req.query.since, limit: req.query.limit, types: req.query.types?.split(',').map((t) => t.trim()).filter(Boolean) }),
  )

  app.get('/opportunities', async () => toSnake(listOpportunities(app.ctx)))
  app.get('/invoices', async () => toSnake(listInvoices(app.ctx)))

  app.post(
    '/opportunities',
    { schema: { body: Strict({ client_id: Id, title: Type.String({ minLength: 1, maxLength: 200 }), amount_cents: Type.Optional(Type.Integer({ minimum: 0 })), next_action: Type.Optional(Type.String({ maxLength: 300 })), next_action_date: Type.Optional(IsoDate) }) } },
    async (req, reply) => {
      const result = await withIdempotency(
        app.ctx.db,
        { key: req.headers['idempotency-key'] as string | undefined, scope: 'POST /api/atelier/opportunities', body: req.body, now: app.ctx.now() },
        () => ({
          statusCode: 201,
          body: toSnake(
            createOpportunity(app.ctx, {
              clientId: req.body.client_id,
              title: req.body.title,
              amountCents: req.body.amount_cents,
              nextAction: req.body.next_action,
              nextActionDate: req.body.next_action_date,
            }),
          ),
        }),
      )
      if (result.replayed) reply.header('Idempotency-Replayed', 'true')
      return reply.code(result.statusCode).send(result.body)
    },
  )

  app.post('/time/import', { schema: { body: Strict({ project_id: Id }) } }, async (req) => toSnake(await importTimeFromProjets(app.ctx, req.body.project_id)))

  app.post(
    '/invoices/from-time',
    {
      schema: {
        body: Strict({
          client_id: Id,
          project_id: Id,
          from: Type.Optional(IsoDate),
          to: Type.Optional(IsoDate),
          unit: Type.Union([Type.Literal('DAY'), Type.Literal('HOUR')]),
          rate_cents: Type.Optional(Type.Integer({ minimum: 0 })),
          title: Type.Optional(Type.String({ maxLength: 200 })),
        }),
      },
    },
    async (req, reply) => {
      const result = await withIdempotency(
        app.ctx.db,
        { key: req.headers['idempotency-key'] as string | undefined, scope: 'POST /api/atelier/invoices/from-time', body: req.body, now: app.ctx.now() },
        () => {
          const invoice = createInvoiceFromTime(app.ctx, {
            clientId: req.body.client_id,
            projectId: req.body.project_id,
            from: req.body.from,
            to: req.body.to,
            unit: req.body.unit,
            rateCents: req.body.rate_cents,
            title: req.body.title,
          })
          return { statusCode: 201, body: toSnake({ id: invoice.id, displayNumber: invoice.displayNumber, title: invoice.title, totalHtCents: invoice.totalHtCents, lines: invoice.lines.length }) }
        },
      )
      if (result.replayed) reply.header('Idempotency-Replayed', 'true')
      return reply.code(result.statusCode).send(result.body)
    },
  )

  app.post('/reminders/run', async () => toSnake(await runDueReminders(app.ctx, { force: false })))

  app.get(
    '/tables/:name',
    { schema: { params: Strict({ name: Type.String({ maxLength: 50 }) }), querystring: Strict({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })) }) } },
    async (req) => {
      const name = req.params.name as TableName
      const table = TABLES[name]
      if (!table) throw notFound(`Table inconnue : ${req.params.name} (invoices, opportunities, unbilled-time)`)
      let rows: Record<string, unknown>[] = []
      if (name === 'invoices') {
        rows = listInvoices(app.ctx).map((i) => ({
          id: i.id,
          numero: i.displayNumber,
          client: i.clientName,
          canal: i.channel === 'MALT' ? 'Malt' : 'Direct',
          statut: INVOICE_STATUS_LABELS[i.status],
          statut_code: i.status,
          emise_le: i.issueDate,
          echeance: i.dueDate,
          total_ht: euros(i.totalHtCents),
          total_ttc: euros(i.totalTtcCents),
          encaisse: euros(i.paidCents),
          reste_a_payer: euros(i.balanceCents),
        }))
      } else if (name === 'opportunities') {
        rows = listOpportunities(app.ctx).map((o) => ({
          id: o.id,
          titre: o.title,
          client: o.clientName ?? null,
          source: o.source,
          etape: STAGE_LABELS[o.stage],
          etape_code: o.stage,
          montant: euros(o.amountCents),
          probabilite: o.probability,
          pondere: euros(o.weightedCents),
          prochaine_action: o.nextAction || null,
          prochaine_action_le: o.nextActionDate,
        }))
      } else {
        rows = listTimeEntries(app.ctx, { billed: 'unbilled' }).map((t) => ({
          id: t.id,
          projet: t.projetsProjectName,
          element_id: t.workItemId,
          element: t.workItemTitle,
          date: t.spentOn,
          heures: Math.round((t.minutes / 60) * 100) / 100,
        }))
      }
      const limit = req.query.limit ?? 5000
      return { format: 'atelier-table/1', name, label: table.label, columns: table.columns, rows: rows.slice(0, limit), total: rows.length, truncated: rows.length > limit }
    },
  )
}
