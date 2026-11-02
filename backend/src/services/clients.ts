// Clients : fiches, agrégats (CA facturé, encours) et fil d'activité.
import { and, asc, eq, like, or, sql } from 'drizzle-orm'
import type { DbOrTx } from '../db/client.ts'
import { clients, invoices, opportunities, quotes, type Channel } from '../db/schema.ts'
import { effectiveStatus } from '../domain/invoicing.ts'
import { conflict } from '../http/errors.ts'
import { pick, requireClient } from './common.ts'
import { type Ctx, nowIso, today } from './context.ts'
import { listActivities, logActivity } from './events.ts'

export interface ClientInput {
  name: string
  siren?: string | null
  vatNumber?: string | null
  email?: string | null
  contactName?: string | null
  phone?: string | null
  address?: string | null
  channel?: Channel
  maltFeeBps?: number | null
  paymentTermsDays?: number | null
  notes?: string
}

export type ClientPatch = Partial<ClientInput> & { archived?: boolean }

const FIELDS = ['name', 'siren', 'vatNumber', 'email', 'contactName', 'phone', 'address', 'channel', 'maltFeeBps', 'paymentTermsDays', 'notes', 'archived'] as const

function clean(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function normalize<T extends ClientPatch>(input: T): T {
  return {
    ...input,
    name: input.name?.trim(),
    siren: clean(input.siren)?.replace(/\s+/g, '') ?? clean(input.siren),
    vatNumber: clean(input.vatNumber),
    email: clean(input.email)?.toLowerCase() ?? clean(input.email),
    contactName: clean(input.contactName),
    phone: clean(input.phone),
    address: clean(input.address),
  }
}

export function listClients(ctx: Ctx, options: { q?: string; includeArchived?: boolean } = {}) {
  const day = today(ctx)
  const filters = []
  if (!options.includeArchived) filters.push(eq(clients.archived, false))
  if (options.q) filters.push(or(like(clients.name, `%${options.q}%`), like(clients.contactName, `%${options.q}%`), like(clients.email, `%${options.q}%`)))
  const rows = ctx.db
    .select()
    .from(clients)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(asc(sql`lower(${clients.name})`))
    .all()
  const invoiceRows = ctx.db
    .select({
      clientId: invoices.clientId,
      status: invoices.status,
      dueDate: invoices.dueDate,
      kind: invoices.kind,
      totalTtcCents: invoices.totalTtcCents,
      paidCents: invoices.paidCents,
    })
    .from(invoices)
    .all()
  const openOpps = ctx.db
    .select({ clientId: opportunities.clientId, n: sql<number>`count(*)` })
    .from(opportunities)
    .where(sql`${opportunities.stage} not in ('WON', 'LOST')`)
    .groupBy(opportunities.clientId)
    .all()
  const oppCount = new Map(openOpps.map((r) => [r.clientId, r.n]))
  return rows.map((client) => {
    const own = invoiceRows.filter((i) => i.clientId === client.id && i.status !== 'DRAFT')
    // CA facturé : factures émises non annulées (un avoir ne fait qu'annuler une facture déjà exclue).
    const billed = own.filter((i) => i.kind === 'INVOICE' && i.status !== 'CANCELLED').reduce((s, i) => s + i.totalTtcCents, 0)
    const open = own.filter((i) => i.status === 'ISSUED' || i.status === 'PARTIALLY_PAID')
    return {
      ...client,
      openOpportunities: oppCount.get(client.id) ?? 0,
      billedTtcCents: billed,
      outstandingCents: open.reduce((s, i) => s + i.totalTtcCents - i.paidCents, 0),
      overdueCount: open.filter((i) => effectiveStatus(i.status, i.dueDate, day) === 'OVERDUE').length,
    }
  })
}

export function getClient(ctx: Ctx, clientId: number) {
  const client = requireClient(ctx.db, clientId)
  const day = today(ctx)
  return {
    ...client,
    opportunities: ctx.db.select().from(opportunities).where(eq(opportunities.clientId, clientId)).orderBy(asc(opportunities.createdAt)).all(),
    quotes: ctx.db
      .select({ id: quotes.id, number: quotes.number, title: quotes.title, status: quotes.status, issueDate: quotes.issueDate, totalHtCents: quotes.totalHtCents })
      .from(quotes)
      .where(eq(quotes.clientId, clientId))
      .orderBy(asc(quotes.id))
      .all(),
    invoices: ctx.db
      .select()
      .from(invoices)
      .where(eq(invoices.clientId, clientId))
      .orderBy(asc(invoices.id))
      .all()
      .map((i) => ({
        id: i.id,
        number: i.number,
        externalRef: i.externalRef,
        kind: i.kind,
        title: i.title,
        channel: i.channel,
        status: effectiveStatus(i.status, i.dueDate, day),
        issueDate: i.issueDate,
        dueDate: i.dueDate,
        totalTtcCents: i.totalTtcCents,
        paidCents: i.paidCents,
      })),
    activities: listActivities(ctx.db, { clientId }),
  }
}

export function createClient(ctx: Ctx, input: ClientInput) {
  const data = normalize(input)
  if (!data.name) throw conflict('Le nom du client est obligatoire', 'VALIDATION')
  return ctx.db.transaction((tx) => {
    const created = tx
      .insert(clients)
      .values({ ...data, name: data.name!, notes: data.notes ?? '' })
      .returning()
      .get()
    logActivity(tx, { clientId: created.id, entityType: 'client', entityId: created.id, type: 'created', message: 'Fiche client créée', at: nowIso(ctx) })
    return created
  })
}

export function updateClient(ctx: Ctx, clientId: number, patch: ClientPatch) {
  requireClient(ctx.db, clientId)
  const data = pick(normalize(patch), FIELDS)
  if (data.name === '') throw conflict('Le nom du client est obligatoire', 'VALIDATION')
  return ctx.db
    .update(clients)
    .set({ ...data, updatedAt: nowIso(ctx) })
    .where(eq(clients.id, clientId))
    .returning()
    .get()
}

/** Suppression possible seulement sans devis ni facture (les pièces comptables se conservent : on archive). */
export function deleteClient(ctx: Ctx, clientId: number): void {
  requireClient(ctx.db, clientId)
  const hasDocs =
    ctx.db.select({ id: quotes.id }).from(quotes).where(eq(quotes.clientId, clientId)).get() ??
    ctx.db.select({ id: invoices.id }).from(invoices).where(eq(invoices.clientId, clientId)).get()
  if (hasDocs) throw conflict('Ce client a des devis ou des factures : archivez-le plutôt que de le supprimer')
  ctx.db.delete(clients).where(eq(clients.id, clientId)).run()
}
