// Prospects / opportunités : pipeline en colonnes (kanban), déplacement entre étapes, valeur pondérée.
import { and, asc, eq, gte, ne, sql } from 'drizzle-orm'
import type { DbOrTx } from '../db/client.ts'
import { clients, opportunities, type Source, type Stage } from '../db/schema.ts'
import { DEFAULT_PROBABILITY, isClosedStage, probabilityAfterMove, STAGE_LABELS, weightedCents } from '../domain/pipeline.ts'
import { badRequest, notFound } from '../http/errors.ts'
import { pick, requireClient } from './common.ts'
import { type Ctx, nowIso } from './context.ts'
import { emitEvent, logActivity } from './events.ts'

export interface OpportunityInput {
  clientId: number
  title: string
  stage?: Stage
  source?: Source
  maltUrl?: string | null
  amountCents?: number
  dailyRateCents?: number | null
  days?: number | null
  probability?: number
  expectedCloseDate?: string | null
  nextAction?: string
  nextActionDate?: string | null
  projetsProjectId?: number | null
  notes?: string
}

export type OpportunityPatch = Partial<Omit<OpportunityInput, 'stage'>> & { lostReason?: string | null }

const PATCH_FIELDS = [
  'clientId',
  'title',
  'source',
  'maltUrl',
  'amountCents',
  'dailyRateCents',
  'probability',
  'expectedCloseDate',
  'nextAction',
  'nextActionDate',
  'projetsProjectId',
  'notes',
  'lostReason',
] as const

type Row = typeof opportunities.$inferSelect

export function opportunityView(row: Row & { clientName?: string; clientChannel?: string }) {
  const { daysMilli, ...rest } = row
  return { ...rest, days: daysMilli === null ? null : daysMilli / 1000, weightedCents: weightedCents(row.amountCents, row.probability) }
}

function requireOpportunity(db: DbOrTx, id: number): Row {
  const row = db.select().from(opportunities).where(eq(opportunities.id, id)).get()
  if (!row) throw notFound(`Opportunité ${id} introuvable`)
  return row
}

/** Montant estimé : saisi, ou TJM × jours s'il ne l'est pas. */
function estimatedAmount(input: { amountCents?: number; dailyRateCents?: number | null; days?: number | null }): number | undefined {
  if (input.amountCents !== undefined && input.amountCents > 0) return input.amountCents
  if (input.dailyRateCents && input.days) return Math.round(input.dailyRateCents * input.days)
  return input.amountCents
}

export function listOpportunities(ctx: Ctx, options: { clientId?: number; includeClosed?: boolean } = {}) {
  const filters = []
  if (options.clientId !== undefined) filters.push(eq(opportunities.clientId, options.clientId))
  return ctx.db
    .select({ opp: opportunities, clientName: clients.name, clientChannel: clients.channel })
    .from(opportunities)
    .innerJoin(clients, eq(clients.id, opportunities.clientId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(asc(opportunities.stage), asc(opportunities.position), asc(opportunities.id))
    .all()
    .filter((r) => options.includeClosed !== false || !isClosedStage(r.opp.stage))
    .map((r) => opportunityView({ ...r.opp, clientName: r.clientName, clientChannel: r.clientChannel }))
}

export function getOpportunity(ctx: Ctx, id: number) {
  const row = requireOpportunity(ctx.db, id)
  const client = requireClient(ctx.db, row.clientId)
  return { ...opportunityView({ ...row, clientName: client.name, clientChannel: client.channel }) }
}

function lastPosition(db: DbOrTx, stage: Stage): number {
  const row = db
    .select({ max: sql<number | null>`max(${opportunities.position})` })
    .from(opportunities)
    .where(eq(opportunities.stage, stage))
    .get()
  return (row?.max ?? -1) + 1
}

export function createOpportunity(ctx: Ctx, input: OpportunityInput) {
  const client = requireClient(ctx.db, input.clientId)
  const stage = input.stage ?? 'NEW'
  const at = nowIso(ctx)
  return ctx.db.transaction((tx) => {
    const created = tx
      .insert(opportunities)
      .values({
        clientId: input.clientId,
        title: input.title.trim(),
        stage,
        source: input.source ?? (client.channel === 'MALT' ? 'MALT' : 'DIRECT'),
        maltUrl: input.maltUrl ?? null,
        amountCents: estimatedAmount(input) ?? 0,
        dailyRateCents: input.dailyRateCents ?? null,
        daysMilli: input.days === undefined || input.days === null ? null : Math.round(input.days * 1000),
        probability: input.probability ?? DEFAULT_PROBABILITY[stage],
        expectedCloseDate: input.expectedCloseDate ?? null,
        nextAction: input.nextAction ?? '',
        nextActionDate: input.nextActionDate ?? null,
        projetsProjectId: input.projetsProjectId ?? null,
        notes: input.notes ?? '',
        position: lastPosition(tx, stage),
        stageChangedAt: at,
        closedAt: isClosedStage(stage) ? at : null,
        createdAt: at,
        updatedAt: at,
      })
      .returning()
      .get()
    emitEvent(tx, {
      type: 'mission.opportunity.created',
      at,
      subject: { kind: 'opportunity', id: created.id, label: created.title },
      data: { client_id: created.clientId, stage: created.stage, source: created.source, amount_cents: created.amountCents },
    })
    logActivity(tx, { clientId: created.clientId, entityType: 'opportunity', entityId: created.id, type: 'created', message: `Opportunité « ${created.title} » créée`, at })
    return opportunityView({ ...created, clientName: client.name, clientChannel: client.channel })
  })
}

export function updateOpportunity(ctx: Ctx, id: number, patch: OpportunityPatch) {
  const current = requireOpportunity(ctx.db, id)
  if (patch.clientId !== undefined) requireClient(ctx.db, patch.clientId)
  const data: Partial<Row> = { ...pick(patch, PATCH_FIELDS), updatedAt: nowIso(ctx) }
  if (patch.title !== undefined) data.title = patch.title.trim()
  if (patch.days !== undefined) data.daysMilli = patch.days === null ? null : Math.round(patch.days * 1000)
  if (patch.amountCents === undefined && (patch.dailyRateCents !== undefined || patch.days !== undefined)) {
    const amount = estimatedAmount({
      dailyRateCents: patch.dailyRateCents ?? current.dailyRateCents,
      days: patch.days ?? (current.daysMilli === null ? null : current.daysMilli / 1000),
    })
    if (amount !== undefined) data.amountCents = amount
  }
  ctx.db.update(opportunities).set(data).where(eq(opportunities.id, id)).run()
  return getOpportunity(ctx, id)
}

/** Déplace une carte vers une étape et une position (glisser-déposer du kanban). */
export function moveOpportunity(ctx: Ctx, id: number, input: { stage: Stage; position?: number; lostReason?: string | null }) {
  const current = requireOpportunity(ctx.db, id)
  const at = nowIso(ctx)
  ctx.db.transaction((tx) => {
    const stageChanged = current.stage !== input.stage
    const target = input.position ?? lastPosition(tx, input.stage)
    // Décale les cartes de la colonne cible à partir de la position visée.
    tx.update(opportunities)
      .set({ position: sql`${opportunities.position} + 1` })
      .where(and(eq(opportunities.stage, input.stage), gte(opportunities.position, target), ne(opportunities.id, id)))
      .run()
    tx.update(opportunities)
      .set({
        stage: input.stage,
        position: target,
        updatedAt: at,
        ...(stageChanged
          ? {
              stageChangedAt: at,
              probability: probabilityAfterMove(current.probability, current.stage, input.stage),
              closedAt: isClosedStage(input.stage) ? at : null,
            }
          : {}),
        ...(input.lostReason !== undefined ? { lostReason: input.lostReason } : {}),
      })
      .where(eq(opportunities.id, id))
      .run()
    if (stageChanged) {
      emitEvent(tx, {
        type: 'mission.opportunity.stage_changed',
        at,
        subject: { kind: 'opportunity', id, label: current.title },
        data: { client_id: current.clientId, from: current.stage, to: input.stage, amount_cents: current.amountCents },
      })
      logActivity(tx, {
        clientId: current.clientId,
        entityType: 'opportunity',
        entityId: id,
        type: 'stage_changed',
        message: `« ${current.title} » : ${STAGE_LABELS[current.stage]} → ${STAGE_LABELS[input.stage]}`,
        at,
      })
    }
  })
  return getOpportunity(ctx, id)
}

/** Avance une opportunité jusqu'à une étape (sans jamais la faire reculer) : utilisé par les devis. */
export function advanceOpportunity(ctx: Ctx, id: number | null, stage: Stage): void {
  if (id === null) return
  const row = ctx.db.select().from(opportunities).where(eq(opportunities.id, id)).get()
  if (!row) return
  const order: Stage[] = ['NEW', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON']
  if (row.stage === 'WON' || row.stage === 'LOST') {
    if (stage !== 'LOST' && stage !== 'WON') return
  } else if (stage !== 'LOST' && order.indexOf(stage) <= order.indexOf(row.stage)) return
  moveOpportunity(ctx, id, { stage })
}

export function deleteOpportunity(ctx: Ctx, id: number): void {
  requireOpportunity(ctx.db, id)
  ctx.db.delete(opportunities).where(eq(opportunities.id, id)).run()
}

export function assertStage(value: string): asserts value is Stage {
  if (!(value in STAGE_LABELS)) throw badRequest(`Étape inconnue : ${value}`)
}
