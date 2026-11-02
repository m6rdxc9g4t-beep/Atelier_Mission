// Devis : brouillon → envoyé → accepté / refusé (expiré = envoyé et date de validité dépassée). Un devis accepté
// devient une facture en un clic ; l'opportunité liée avance avec lui (Devis envoyé, puis Gagné / Perdu).
import { and, asc, desc, eq } from 'drizzle-orm'
import type { DbOrTx } from '../db/client.ts'
import { clients, quoteLines, quotes, type Channel, type QuoteStatus } from '../db/schema.ts'
import { addDays } from '../domain/dates.ts'
import { formatDocumentNumber } from '../domain/invoicing.ts'
import { computeTotals, toMilli } from '../domain/money.ts'
import { badRequest, conflict, notFound } from '../http/errors.ts'
import { type LineInput, lineView, nextSequence, requireClient } from './common.ts'
import { type Ctx, nowIso, today } from './context.ts'
import { emitEvent, logActivity } from './events.ts'
import { advanceOpportunity } from './opportunities.ts'
import { getSettings } from './settings.ts'

export type EffectiveQuoteStatus = QuoteStatus

export interface QuoteInput {
  clientId: number
  opportunityId?: number | null
  title: string
  channel?: Channel
  issueDate?: string
  validUntil?: string
  notes?: string
  lines?: LineInput[]
}

export type QuotePatch = Partial<Omit<QuoteInput, 'clientId'>> & { clientId?: number }

type QuoteRow = typeof quotes.$inferSelect

function requireQuote(db: DbOrTx, id: number): QuoteRow {
  const row = db.select().from(quotes).where(eq(quotes.id, id)).get()
  if (!row) throw notFound(`Devis ${id} introuvable`)
  return row
}

export function effectiveQuoteStatus(status: QuoteStatus, validUntil: string, day: string): QuoteStatus {
  return status === 'SENT' && validUntil < day ? 'EXPIRED' : status
}

/** Remplace les lignes d'un devis (brouillon) et recalcule ses totaux. */
function writeLines(db: DbOrTx, quoteId: number, lines: readonly LineInput[]): void {
  db.delete(quoteLines).where(eq(quoteLines.quoteId, quoteId)).run()
  lines.forEach((line, position) => {
    db.insert(quoteLines)
      .values({
        quoteId,
        position,
        label: line.label.trim(),
        details: line.details?.trim() ?? '',
        unit: line.unit,
        quantityMilli: toMilli(line.quantity),
        unitPriceCents: line.unitPriceCents,
        vatRateBps: line.vatRateBps,
      })
      .run()
  })
  const stored = db.select().from(quoteLines).where(eq(quoteLines.quoteId, quoteId)).all()
  const totals = computeTotals(stored)
  db.update(quotes).set({ totalHtCents: totals.htCents, totalVatCents: totals.vatCents, totalTtcCents: totals.ttcCents }).where(eq(quotes.id, quoteId)).run()
}

export function listQuotes(ctx: Ctx, options: { clientId?: number; status?: QuoteStatus } = {}) {
  const day = today(ctx)
  const filters = []
  if (options.clientId !== undefined) filters.push(eq(quotes.clientId, options.clientId))
  return ctx.db
    .select({ quote: quotes, clientName: clients.name })
    .from(quotes)
    .innerJoin(clients, eq(clients.id, quotes.clientId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(quotes.issueDate), desc(quotes.id))
    .all()
    .map(({ quote, clientName }) => ({ ...quote, clientName, status: effectiveQuoteStatus(quote.status, quote.validUntil, day) }))
    .filter((q) => options.status === undefined || q.status === options.status)
}

export function getQuote(ctx: Ctx, id: number) {
  const quote = requireQuote(ctx.db, id)
  const client = requireClient(ctx.db, quote.clientId)
  const lines = ctx.db.select().from(quoteLines).where(eq(quoteLines.quoteId, id)).orderBy(asc(quoteLines.position)).all()
  return {
    ...quote,
    status: effectiveQuoteStatus(quote.status, quote.validUntil, today(ctx)),
    client: { id: client.id, name: client.name, email: client.email, address: client.address, siren: client.siren, vatNumber: client.vatNumber, contactName: client.contactName },
    lines: lines.map(lineView),
    vatByRate: computeTotals(lines).byRate,
  }
}

export function createQuote(ctx: Ctx, input: QuoteInput) {
  const client = requireClient(ctx.db, input.clientId)
  const settings = getSettings(ctx.db)
  const issueDate = input.issueDate ?? today(ctx)
  const at = nowIso(ctx)
  const id = ctx.db.transaction((tx) => {
    const year = issueDate.slice(0, 4)
    const number = formatDocumentNumber(settings.billing.quotePrefix, year, nextSequence(tx, `quote:${year}`))
    const created = tx
      .insert(quotes)
      .values({
        number,
        clientId: input.clientId,
        opportunityId: input.opportunityId ?? null,
        channel: input.channel ?? client.channel,
        title: input.title.trim(),
        issueDate,
        validUntil: input.validUntil ?? addDays(issueDate, settings.billing.quoteValidityDays),
        notes: input.notes ?? '',
        createdAt: at,
        updatedAt: at,
      })
      .returning()
      .get()
    writeLines(tx, created.id, input.lines ?? [])
    logActivity(tx, { clientId: client.id, entityType: 'quote', entityId: created.id, type: 'created', message: `Devis ${number} créé`, at })
    return created.id
  })
  return getQuote(ctx, id)
}

export function updateQuote(ctx: Ctx, id: number, patch: QuotePatch) {
  const quote = requireQuote(ctx.db, id)
  if (quote.status !== 'DRAFT') throw conflict('Seul un devis en brouillon se modifie : dupliquez-le pour en faire une nouvelle version')
  if (patch.clientId !== undefined) requireClient(ctx.db, patch.clientId)
  ctx.db.transaction((tx) => {
    const { lines, ...fields } = patch
    tx.update(quotes)
      .set({ ...fields, ...(fields.title !== undefined ? { title: fields.title.trim() } : {}), updatedAt: nowIso(ctx) })
      .where(eq(quotes.id, id))
      .run()
    if (lines !== undefined) writeLines(tx, id, lines)
  })
  return getQuote(ctx, id)
}

function setStatus(ctx: Ctx, id: number, from: readonly QuoteStatus[], to: QuoteStatus, message: string) {
  const quote = requireQuote(ctx.db, id)
  const current = effectiveQuoteStatus(quote.status, quote.validUntil, today(ctx))
  if (!from.includes(quote.status)) throw conflict(`Action impossible pour un devis « ${current} »`)
  const at = nowIso(ctx)
  ctx.db.transaction((tx) => {
    tx.update(quotes)
      .set({ status: to, updatedAt: at, ...(to === 'SENT' ? { sentAt: at } : { decidedAt: at }) })
      .where(eq(quotes.id, id))
      .run()
    logActivity(tx, { clientId: quote.clientId, entityType: 'quote', entityId: id, type: to.toLowerCase(), message: `Devis ${quote.number} ${message}`, at })
    if (to === 'SENT' || to === 'ACCEPTED') {
      emitEvent(tx, {
        type: to === 'SENT' ? 'mission.quote.sent' : 'mission.quote.accepted',
        at,
        subject: { kind: 'quote', id, label: quote.number },
        data: { client_id: quote.clientId, opportunity_id: quote.opportunityId === null ? null : String(quote.opportunityId), total_ht_cents: quote.totalHtCents },
      })
    }
  })
  return quote
}

export function sendQuote(ctx: Ctx, id: number) {
  const quote = requireQuote(ctx.db, id)
  const count = ctx.db.select({ id: quoteLines.id }).from(quoteLines).where(eq(quoteLines.quoteId, id)).all().length
  if (count === 0) throw badRequest('Ajoutez au moins une ligne avant d’envoyer le devis')
  setStatus(ctx, id, ['DRAFT'], 'SENT', 'marqué comme envoyé')
  advanceOpportunity(ctx, quote.opportunityId, 'PROPOSAL')
  return getQuote(ctx, id)
}

export function acceptQuote(ctx: Ctx, id: number) {
  const quote = setStatus(ctx, id, ['SENT', 'DRAFT'], 'ACCEPTED', 'accepté')
  advanceOpportunity(ctx, quote.opportunityId, 'WON')
  return getQuote(ctx, id)
}

export function declineQuote(ctx: Ctx, id: number, options: { markOpportunityLost?: boolean } = {}) {
  const quote = setStatus(ctx, id, ['SENT', 'DRAFT'], 'DECLINED', 'refusé')
  if (options.markOpportunityLost) advanceOpportunity(ctx, quote.opportunityId, 'LOST')
  return getQuote(ctx, id)
}

/** Nouvelle version d'un devis (brouillon, nouveau numéro, mêmes lignes). */
export function duplicateQuote(ctx: Ctx, id: number) {
  const source = getQuote(ctx, id)
  return createQuote(ctx, {
    clientId: source.clientId,
    opportunityId: source.opportunityId,
    title: source.title,
    channel: source.channel,
    notes: source.notes,
    lines: source.lines.map(({ label, details, unit, quantity, unitPriceCents, vatRateBps }) => ({ label, details, unit, quantity, unitPriceCents, vatRateBps })),
  })
}

export function deleteQuote(ctx: Ctx, id: number): void {
  const quote = requireQuote(ctx.db, id)
  if (quote.status !== 'DRAFT') throw conflict('Seul un devis en brouillon se supprime')
  ctx.db.delete(quotes).where(eq(quotes.id, id)).run()
}

/** Devis envoyés qui expirent dans les `days` prochains jours (tableau de bord). */
export function expiringQuotes(ctx: Ctx, days: number) {
  const day = today(ctx)
  const limit = addDays(day, days)
  return listQuotes(ctx)
    .filter((q) => q.status === 'SENT' && q.validUntil >= day && q.validUntil <= limit)
    .map(({ id, number, title, clientName, validUntil, totalHtCents }) => ({ id, number, title, clientName, validUntil, totalHtCents }))
}

