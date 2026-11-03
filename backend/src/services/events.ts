// Journal d'événements du contrat atelier-node/1 (Suite Atelier §7.3) et fil d'activité des fiches.
// Les événements sont émis par les SERVICES, dans la transaction de l'écriture : pas d'événement sans écriture.
import { and, asc, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm'
import type { DbOrTx } from '../db/client.ts'
import { activities, events } from '../db/schema.ts'

export const EVENT_TYPES = [
  'mission.opportunity.created',
  'mission.opportunity.stage_changed',
  'mission.quote.sent',
  'mission.quote.accepted',
  'mission.invoice.issued',
  'mission.invoice.paid',
  'mission.invoice.cancelled',
  'mission.payment.recorded',
  'mission.reminder.sent',
  'mission.time.imported',
  'mission.einvoice.sent',
  'mission.einvoice.status_changed',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

export interface EventInput {
  type: EventType
  at: string
  subject: { kind: string; id: string | number; label?: string }
  /** Identifiants, libellés, statuts et nombres agrégés uniquement — jamais de ligne de données ni de secret. */
  data?: Record<string, unknown>
}

const RETENTION_COUNT = 1000
const RETENTION_DAYS = 30

export function emitEvent(db: DbOrTx, input: EventInput): void {
  const data = Object.fromEntries(
    Object.entries(input.data ?? {}).map(([k, v]) => [k, typeof v === 'number' && k.endsWith('_id') ? String(v) : v]),
  )
  db.insert(events)
    .values({
      type: input.type,
      at: input.at,
      subjectKind: input.subject.kind,
      subjectId: String(input.subject.id),
      subjectLabel: input.subject.label ?? '',
      data: JSON.stringify(data),
    })
    .run()
  // Rétention : on garde au moins les 1 000 derniers OU ceux de moins de 30 jours.
  const cutoff = new Date(Date.parse(input.at) - RETENTION_DAYS * 86_400_000).toISOString()
  const keepFrom = db.select({ seq: events.seq }).from(events).orderBy(desc(events.seq)).limit(1).offset(RETENTION_COUNT - 1).get()
  if (keepFrom) db.delete(events).where(and(lt(events.seq, keepFrom.seq), lt(events.at, cutoff))).run()
}

export interface EventsPage {
  events: { seq: number; type: string; at: string; subject: { kind: string; id: string; label: string }; data: unknown }[]
  next: number
  oldest: number
  gap: boolean
}

export function listEvents(db: DbOrTx, options: { since?: number; limit?: number; types?: string[] }): EventsPage {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500)
  const bounds = db
    .select({ min: sql<number | null>`min(${events.seq})`, max: sql<number | null>`max(${events.seq})` })
    .from(events)
    .get()
  const seqRow = db.get<{ seq: number } | undefined>(sql`select seq from sqlite_sequence where name = 'events'`)
  const lastKnown = Math.max(bounds?.max ?? 0, seqRow?.seq ?? 0)
  const oldest = bounds?.min ?? lastKnown + 1
  const filters = [] as ReturnType<typeof eq>[]
  if (options.since !== undefined) filters.push(gt(events.seq, options.since))
  if (options.types && options.types.length > 0) filters.push(inArray(events.type, options.types))
  const where = filters.length > 0 ? and(...filters) : undefined
  const rows =
    options.since === undefined
      ? db.select().from(events).where(where).orderBy(desc(events.seq)).limit(limit).all().reverse()
      : db.select().from(events).where(where).orderBy(asc(events.seq)).limit(limit).all()
  const last = rows[rows.length - 1]
  const gap = options.since !== undefined && (options.since < oldest - 1 || options.since > lastKnown)
  return {
    events: rows.map((row) => ({
      seq: row.seq,
      type: row.type,
      at: row.at,
      subject: { kind: row.subjectKind, id: row.subjectId, label: row.subjectLabel },
      data: JSON.parse(row.data) as unknown,
    })),
    next: last?.seq ?? options.since ?? lastKnown,
    oldest,
    gap,
  }
}

export interface ActivityInput {
  clientId: number | null
  entityType: 'client' | 'opportunity' | 'quote' | 'invoice'
  entityId: number
  type: string
  message: string
  at: string
}

export function logActivity(db: DbOrTx, input: ActivityInput): void {
  db.insert(activities).values(input).run()
}

export function listActivities(db: DbOrTx, filter: { clientId?: number; entityType?: string; entityId?: number }, limit = 50) {
  const filters = []
  if (filter.clientId !== undefined) filters.push(eq(activities.clientId, filter.clientId))
  if (filter.entityType !== undefined) filters.push(eq(activities.entityType, filter.entityType))
  if (filter.entityId !== undefined) filters.push(eq(activities.entityId, filter.entityId))
  return db
    .select()
    .from(activities)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(activities.at), desc(activities.id))
    .limit(limit)
    .all()
}
