// Factures : brouillon → émise (numéro légal, coordonnées figées, relances planifiées) → payée.
// Une facture émise ne se modifie ni ne se supprime : on l'annule par un avoir (factures directes).
// Canal Malt : Malt émet la facture au nom du freelance (mandat de facturation) et encaisse le client ;
// Atelier Mission en suit le statut, le versement net et les frais, sans numéro propre ni relance.
import { and, asc, desc, eq, inArray, isNotNull, max } from 'drizzle-orm'
import type { DbOrTx } from '../db/client.ts'
import { clients, invoiceLines, invoices, payments, quoteLines, quotes, reminders, timeEntries, type Channel, type InvoiceStatus } from '../db/schema.ts'
import { addDays, formatShortDate } from '../domain/dates.ts'
import { effectiveStatus, type EffectiveInvoiceStatus, formatDocumentNumber, legalMentions, maltFees } from '../domain/invoicing.ts'
import { computeTotals, toMilli } from '../domain/money.ts'
import { badRequest, conflict, notFound } from '../http/errors.ts'
import { type LineInput, lineView, nextSequence, requireClient } from './common.ts'
import { type Ctx, nowIso, today } from './context.ts'
import { einvoiceView, paymentReportOf } from './einvoicing.ts'
import { emitEvent, listActivities, logActivity } from './events.ts'
import { advanceOpportunity } from './opportunities.ts'
import { cancelOpenReminders, scheduleReminders } from './reminder-plan.ts'
import { type CompanySettings, getSettings, sellerSnapshot } from './settings.ts'

export interface InvoiceInput {
  clientId: number
  title: string
  channel?: Channel
  opportunityId?: number | null
  quoteId?: number | null
  serviceStart?: string | null
  serviceEnd?: string | null
  paymentTermsDays?: number
  notes?: string
  remindersEnabled?: boolean
  maltFeeBps?: number
  lines?: LineInput[]
}

export type InvoicePatch = Partial<InvoiceInput> & { externalRef?: string | null }

type InvoiceRow = typeof invoices.$inferSelect

export interface ClientSnapshot {
  name: string
  address: string | null
  siren: string | null
  vatNumber: string | null
  email: string | null
  contactName: string | null
}

export function requireInvoice(db: DbOrTx, id: number): InvoiceRow {
  const row = db.select().from(invoices).where(eq(invoices.id, id)).get()
  if (!row) throw notFound(`Facture ${id} introuvable`)
  return row
}

function recomputeTotals(db: DbOrTx, invoiceId: number): void {
  const lines = db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId)).all()
  const totals = computeTotals(lines)
  db.update(invoices).set({ totalHtCents: totals.htCents, totalVatCents: totals.vatCents, totalTtcCents: totals.ttcCents }).where(eq(invoices.id, invoiceId)).run()
}

/**
 * Écrit les lignes d'un brouillon. Une ligne qui garde son `id` est mise à jour en place (elle reste liée à ses
 * saisies de temps) ; une ligne retirée est supprimée et ses saisies redeviennent facturables.
 */
export function writeInvoiceLines(db: DbOrTx, invoiceId: number, lines: readonly LineInput[]): number[] {
  const existing = db.select({ id: invoiceLines.id }).from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId)).all()
  const existingIds = new Set(existing.map((l) => l.id))
  for (const line of lines) {
    if (line.id !== undefined && !existingIds.has(line.id)) throw badRequest(`La ligne ${line.id} n’appartient pas à cette facture`)
  }
  const kept = new Set(lines.map((l) => l.id).filter((id): id is number => id !== undefined))
  const removed = [...existingIds].filter((id) => !kept.has(id))
  if (removed.length > 0) {
    db.update(timeEntries).set({ invoiceLineId: null }).where(inArray(timeEntries.invoiceLineId, removed)).run()
    db.delete(invoiceLines).where(inArray(invoiceLines.id, removed)).run()
  }
  const ids: number[] = []
  lines.forEach((line, position) => {
    const values = {
      position,
      label: line.label.trim(),
      details: line.details?.trim() ?? '',
      unit: line.unit,
      quantityMilli: toMilli(line.quantity),
      unitPriceCents: line.unitPriceCents,
      vatRateBps: line.vatRateBps,
    }
    if (line.id !== undefined) {
      db.update(invoiceLines).set(values).where(eq(invoiceLines.id, line.id)).run()
      ids.push(line.id)
    } else {
      ids.push(db.insert(invoiceLines).values({ ...values, invoiceId }).returning({ id: invoiceLines.id }).get().id)
    }
  })
  recomputeTotals(db, invoiceId)
  return ids
}

function displayNumber(row: Pick<InvoiceRow, 'id' | 'number' | 'externalRef' | 'channel' | 'status'>): string {
  if (row.number) return row.number
  if (row.channel === 'MALT') return row.externalRef ? `Malt ${row.externalRef}` : `Malt #${row.id}`
  return `Brouillon #${row.id}`
}

export function invoiceSummary(row: InvoiceRow & { clientName: string }, day: string) {
  return {
    id: row.id,
    number: row.number,
    displayNumber: displayNumber(row),
    externalRef: row.externalRef,
    kind: row.kind,
    clientId: row.clientId,
    clientName: row.clientName,
    channel: row.channel,
    title: row.title,
    status: effectiveStatus(row.status, row.dueDate, day),
    rawStatus: row.status,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    totalHtCents: row.totalHtCents,
    totalTtcCents: row.totalTtcCents,
    paidCents: row.paidCents,
    balanceCents: row.totalTtcCents - row.paidCents,
    opportunityId: row.opportunityId,
  }
}

export function listInvoices(ctx: Ctx, options: { clientId?: number; status?: EffectiveInvoiceStatus; channel?: Channel; q?: string } = {}) {
  const day = today(ctx)
  const filters = []
  if (options.clientId !== undefined) filters.push(eq(invoices.clientId, options.clientId))
  if (options.channel !== undefined) filters.push(eq(invoices.channel, options.channel))
  const q = options.q?.trim().toLowerCase()
  return ctx.db
    .select({ invoice: invoices, clientName: clients.name })
    .from(invoices)
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(invoices.issueDate), desc(invoices.id))
    .all()
    .map(({ invoice, clientName }) => invoiceSummary({ ...invoice, clientName }, day))
    .filter((i) => options.status === undefined || i.status === options.status)
    .filter((i) => !q || `${i.displayNumber} ${i.title} ${i.clientName}`.toLowerCase().includes(q))
}

function parseJson<T>(value: string | null): T | null {
  if (value === null) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

export function getInvoice(ctx: Ctx, id: number) {
  const row = requireInvoice(ctx.db, id)
  const client = requireClient(ctx.db, row.clientId)
  const settings = getSettings(ctx.db)
  const day = today(ctx)
  const lines = ctx.db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.position)).all()
  const lineIds = lines.map((l) => l.id)
  const linkedTime = lineIds.length
    ? ctx.db.select().from(timeEntries).where(inArray(timeEntries.invoiceLineId, lineIds)).orderBy(asc(timeEntries.spentOn)).all()
    : []
  const seller: CompanySettings = parseJson<CompanySettings>(row.sellerSnapshot) ?? settings.company
  const clientView: ClientSnapshot = parseJson<ClientSnapshot>(row.clientSnapshot) ?? {
    name: client.name,
    address: client.address,
    siren: client.siren,
    vatNumber: client.vatNumber,
    email: client.email,
    contactName: client.contactName,
  }
  return {
    ...invoiceSummary({ ...row, clientName: client.name }, day),
    serviceStart: row.serviceStart,
    serviceEnd: row.serviceEnd,
    paymentTermsDays: row.paymentTermsDays,
    notes: row.notes,
    quoteId: row.quoteId,
    creditedInvoiceId: row.creditedInvoiceId,
    remindersEnabled: row.remindersEnabled,
    maltFeeBps: row.maltFeeBps,
    totalVatCents: row.totalVatCents,
    issuedAt: row.issuedAt,
    paidAt: row.paidAt,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
    client: { id: client.id, ...clientView, currentEmail: client.email },
    seller,
    lines: lines.map((line) => ({ ...lineView(line), timeEntryCount: linkedTime.filter((t) => t.invoiceLineId === line.id).length })),
    vatByRate: computeTotals(lines).byRate,
    malt: row.channel === 'MALT' ? { feeBps: row.maltFeeBps, ...maltFees(row.totalHtCents, row.totalTtcCents, row.maltFeeBps, settings.malt.feeVatBps) } : null,
    payments: ctx.db.select().from(payments).where(eq(payments.invoiceId, id)).orderBy(asc(payments.receivedOn), asc(payments.id)).all().map((p) => ({
      ...p,
      tresorerieTransactionIds: parseJson<number[]>(p.tresorerieTransactionIds) ?? [],
      einvoiceReport: paymentReportOf(ctx, p.id),
    })),
    einvoice: einvoiceView(ctx, id),
    reminders: ctx.db.select().from(reminders).where(eq(reminders.invoiceId, id)).orderBy(asc(reminders.level)).all(),
    time: {
      entries: linkedTime.length,
      minutes: linkedTime.reduce((s, t) => s + t.minutes, 0),
      flagged: linkedTime.filter((t) => t.changedAfterBilling || t.removedInProjets).length,
      projectIds: [...new Set(linkedTime.map((t) => t.projetsProjectId))],
    },
    legalMentions:
      row.channel === 'DIRECT'
        ? legalMentions({
            vatRegime: seller.vatRegime,
            latePenaltyRateText: settings.billing.latePenaltyRateText,
            recoveryFeeCents: settings.billing.recoveryFeeCents,
            isB2B: true,
          })
        : [],
    footer: settings.billing.footer,
    activities: listActivities(ctx.db, { entityType: 'invoice', entityId: id }),
  }
}

export function createInvoice(ctx: Ctx, input: InvoiceInput, tx?: DbOrTx): number {
  const run = (db: DbOrTx) => {
    const client = requireClient(db, input.clientId)
    const settings = getSettings(db)
    const channel = input.channel ?? client.channel
    const at = nowIso(ctx)
    const created = db
      .insert(invoices)
      .values({
        clientId: client.id,
        opportunityId: input.opportunityId ?? null,
        quoteId: input.quoteId ?? null,
        channel,
        title: input.title.trim(),
        serviceStart: input.serviceStart ?? null,
        serviceEnd: input.serviceEnd ?? null,
        paymentTermsDays: input.paymentTermsDays ?? client.paymentTermsDays ?? settings.billing.paymentTermsDays,
        maltFeeBps: channel === 'MALT' ? (input.maltFeeBps ?? client.maltFeeBps ?? settings.malt.feeBps) : 0,
        notes: input.notes ?? '',
        remindersEnabled: input.remindersEnabled ?? channel === 'DIRECT',
        createdAt: at,
        updatedAt: at,
      })
      .returning({ id: invoices.id })
      .get()
    writeInvoiceLines(db, created.id, input.lines ?? [])
    logActivity(db, { clientId: client.id, entityType: 'invoice', entityId: created.id, type: 'created', message: `Brouillon de facture « ${input.title.trim()} » créé`, at })
    return created.id
  }
  return tx ? run(tx) : ctx.db.transaction(run)
}

export function updateInvoice(ctx: Ctx, id: number, patch: InvoicePatch) {
  const row = requireInvoice(ctx.db, id)
  const onlyMeta = Object.keys(patch).every((k) => k === 'externalRef' || k === 'notes' || k === 'remindersEnabled')
  if (row.status !== 'DRAFT' && !onlyMeta) {
    throw conflict('Une facture émise ne se modifie plus (obligation légale) : annulez-la par un avoir et refaites-la')
  }
  if (patch.clientId !== undefined) requireClient(ctx.db, patch.clientId)
  ctx.db.transaction((tx) => {
    const { lines, ...fields } = patch
    tx.update(invoices)
      .set({ ...fields, ...(fields.title !== undefined ? { title: fields.title.trim() } : {}), updatedAt: nowIso(ctx) })
      .where(eq(invoices.id, id))
      .run()
    if (lines !== undefined) writeInvoiceLines(tx, id, lines)
    if (patch.remindersEnabled === false) cancelOpenReminders(tx, id)
    if (patch.remindersEnabled === true && row.status !== 'DRAFT' && row.dueDate && row.channel === 'DIRECT') {
      scheduleReminders(tx, { ...row, remindersEnabled: true }, getSettings(tx).reminders.offsetsDays)
    }
  })
  return getInvoice(ctx, id)
}

export function createInvoiceFromQuote(ctx: Ctx, quoteId: number) {
  const quote = ctx.db.select().from(quotes).where(eq(quotes.id, quoteId)).get()
  if (!quote) throw notFound(`Devis ${quoteId} introuvable`)
  if (quote.status === 'DRAFT' || quote.status === 'DECLINED') throw conflict('Seul un devis envoyé ou accepté se transforme en facture')
  const lines = ctx.db.select().from(quoteLines).where(eq(quoteLines.quoteId, quoteId)).orderBy(asc(quoteLines.position)).all()
  const id = createInvoice(ctx, {
    clientId: quote.clientId,
    title: quote.title,
    channel: quote.channel,
    opportunityId: quote.opportunityId,
    quoteId: quote.id,
    notes: quote.notes,
    lines: lines.map((l) => ({ label: l.label, details: l.details, unit: l.unit, quantity: l.quantityMilli / 1000, unitPriceCents: l.unitPriceCents, vatRateBps: l.vatRateBps })),
  })
  if (quote.status === 'SENT') {
    ctx.db.update(quotes).set({ status: 'ACCEPTED', decidedAt: nowIso(ctx) }).where(eq(quotes.id, quoteId)).run()
    advanceOpportunity(ctx, quote.opportunityId, 'WON')
  }
  return getInvoice(ctx, id)
}

function missingSellerFields(company: CompanySettings): string[] {
  const missing: string[] = []
  if (!company.name.trim()) missing.push('nom')
  if (!company.siren.trim() && !company.siret.trim()) missing.push('SIREN ou SIRET')
  if (!company.address.trim()) missing.push('adresse')
  return missing
}

export interface IssueInput {
  issueDate?: string
  externalRef?: string | null
}

export function issueInvoice(ctx: Ctx, id: number, input: IssueInput = {}) {
  const row = requireInvoice(ctx.db, id)
  if (row.status !== 'DRAFT') throw conflict('Cette facture est déjà émise')
  if (row.kind !== 'INVOICE') throw conflict('Un avoir est émis avec l’annulation de sa facture')
  const lineCount = ctx.db.select({ id: invoiceLines.id }).from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).all().length
  if (lineCount === 0 || row.totalTtcCents <= 0) throw badRequest('La facture doit avoir au moins une ligne et un total positif')
  const client = requireClient(ctx.db, row.clientId)
  const settings = getSettings(ctx.db)
  const issueDate = input.issueDate ?? today(ctx)
  if (row.channel === 'DIRECT') {
    const missing = missingSellerFields(settings.company)
    if (missing.length) throw badRequest(`Complétez votre identité dans Paramètres avant d’émettre une facture : ${missing.join(', ')}`)
    if (!client.address) throw badRequest(`Ajoutez l’adresse du client « ${client.name} » (mention obligatoire sur la facture)`)
    if (settings.company.vatRegime === 'FRANCHISE') {
      const taxed = ctx.db.select({ rate: invoiceLines.vatRateBps }).from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).all().some((l) => l.rate > 0)
      if (taxed) throw badRequest('Vous êtes en franchise en base de TVA : mettez toutes les lignes à 0 % avant d’émettre')
    }
    const last = ctx.db
      .select({ date: max(invoices.issueDate) })
      .from(invoices)
      .where(and(eq(invoices.channel, 'DIRECT'), isNotNull(invoices.number)))
      .get()
    if (last?.date && issueDate < last.date) {
      throw conflict(`Date d’émission antérieure à la dernière facture (${last.date}) : la numérotation doit rester chronologique`)
    }
  }
  const at = nowIso(ctx)
  ctx.db.transaction((tx) => {
    const year = issueDate.slice(0, 4)
    const number =
      row.channel === 'DIRECT' ? formatDocumentNumber(settings.billing.invoicePrefix, year, nextSequence(tx, `invoice:${year}`)) : null
    const snapshot: ClientSnapshot = {
      name: client.name,
      address: client.address,
      siren: client.siren,
      vatNumber: client.vatNumber,
      email: client.email,
      contactName: client.contactName,
    }
    const dueDate = addDays(issueDate, row.paymentTermsDays)
    tx.update(invoices)
      .set({
        number,
        externalRef: input.externalRef ?? row.externalRef,
        status: 'ISSUED',
        issueDate,
        dueDate,
        clientSnapshot: JSON.stringify(snapshot),
        sellerSnapshot: JSON.stringify(sellerSnapshot(settings.company)),
        issuedAt: at,
        updatedAt: at,
      })
      .where(eq(invoices.id, id))
      .run()
    const issued = requireInvoice(tx, id)
    if (issued.channel === 'DIRECT' && issued.remindersEnabled) scheduleReminders(tx, issued, settings.reminders.offsetsDays)
    const label = number ?? displayNumber(issued)
    emitEvent(tx, {
      type: 'mission.invoice.issued',
      at,
      subject: { kind: 'invoice', id, label },
      data: { client_id: row.clientId, channel: row.channel, total_ttc_cents: row.totalTtcCents, due_date: dueDate },
    })
    logActivity(tx, { clientId: row.clientId, entityType: 'invoice', entityId: id, type: 'issued', message: `Facture ${label} émise (échéance ${formatShortDate(dueDate)})`, at })
  })
  advanceOpportunity(ctx, row.opportunityId, 'WON')
  return getInvoice(ctx, id)
}

/**
 * Annule une facture émise sans encaissement. Directe : un avoir numéroté (A-…) reprend les lignes en négatif.
 * Malt : simple changement de statut (l'avoir est émis par Malt). Les saisies de temps redeviennent facturables.
 */
export function cancelInvoice(ctx: Ctx, id: number, input: { reason?: string } = {}) {
  const row = requireInvoice(ctx.db, id)
  if (row.status === 'DRAFT') throw conflict('Un brouillon se supprime, il ne s’annule pas')
  if (row.status === 'CANCELLED') throw conflict('Facture déjà annulée')
  if (row.kind === 'CREDIT_NOTE') throw conflict('Un avoir ne s’annule pas')
  if (row.paidCents !== 0) throw conflict('Cette facture a des encaissements : supprimez-les avant de l’annuler')
  const settings = getSettings(ctx.db)
  const at = nowIso(ctx)
  const day = today(ctx)
  let creditNoteId: number | null = null
  ctx.db.transaction((tx) => {
    const lines = tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).all()
    tx.update(invoices).set({ status: 'CANCELLED', cancelledAt: at, updatedAt: at }).where(eq(invoices.id, id)).run()
    cancelOpenReminders(tx, id)
    if (lines.length) tx.update(timeEntries).set({ invoiceLineId: null }).where(inArray(timeEntries.invoiceLineId, lines.map((l) => l.id))).run()
    if (row.channel === 'DIRECT') {
      const year = day.slice(0, 4)
      const number = formatDocumentNumber(settings.billing.creditNotePrefix, year, nextSequence(tx, `credit:${year}`))
      const credit = tx
        .insert(invoices)
        .values({
          number,
          kind: 'CREDIT_NOTE',
          creditedInvoiceId: id,
          clientId: row.clientId,
          opportunityId: row.opportunityId,
          channel: 'DIRECT',
          status: 'PAID',
          title: `Avoir sur la facture ${row.number}`,
          issueDate: day,
          dueDate: day,
          paymentTermsDays: 0,
          notes: input.reason?.trim() ? `Motif : ${input.reason.trim()}` : '',
          clientSnapshot: row.clientSnapshot,
          sellerSnapshot: JSON.stringify(sellerSnapshot(settings.company)),
          remindersEnabled: false,
          issuedAt: at,
          paidAt: at,
          createdAt: at,
          updatedAt: at,
        })
        .returning({ id: invoices.id })
        .get()
      creditNoteId = credit.id
      lines.forEach((l, position) => {
        tx.insert(invoiceLines)
          .values({ invoiceId: credit.id, position, label: l.label, details: l.details, unit: l.unit, quantityMilli: -l.quantityMilli, unitPriceCents: l.unitPriceCents, vatRateBps: l.vatRateBps })
          .run()
      })
      recomputeTotals(tx, credit.id)
      const totals = requireInvoice(tx, credit.id)
      tx.update(invoices).set({ paidCents: totals.totalTtcCents }).where(eq(invoices.id, credit.id)).run()
    }
    const label = row.number ?? displayNumber(row)
    emitEvent(tx, {
      type: 'mission.invoice.cancelled',
      at,
      subject: { kind: 'invoice', id, label },
      data: { client_id: row.clientId, credit_note_id: creditNoteId === null ? null : String(creditNoteId) },
    })
    logActivity(tx, { clientId: row.clientId, entityType: 'invoice', entityId: id, type: 'cancelled', message: `Facture ${label} annulée${creditNoteId ? ' par avoir' : ''}`, at })
  })
  return { invoice: getInvoice(ctx, id), creditNoteId }
}

export function deleteDraftInvoice(ctx: Ctx, id: number): void {
  const row = requireInvoice(ctx.db, id)
  if (row.status !== 'DRAFT') throw conflict('Seul un brouillon se supprime : une facture émise s’annule par un avoir')
  ctx.db.transaction((tx) => {
    const lineIds = tx.select({ id: invoiceLines.id }).from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).all().map((l) => l.id)
    if (lineIds.length) tx.update(timeEntries).set({ invoiceLineId: null }).where(inArray(timeEntries.invoiceLineId, lineIds)).run()
    tx.delete(invoices).where(eq(invoices.id, id)).run()
  })
}

export function invoiceStatusOf(db: DbOrTx, id: number): InvoiceStatus {
  return requireInvoice(db, id).status
}
