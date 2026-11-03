// Encaissements : mettent à jour le statut de la facture, arrêtent les relances et remontent dans Atelier Trésorerie.
// Trésorerie (local, bouclage) : une opération « revenu » du montant reçu ; pour une mission Malt, le montant
// facturé au client en revenu ET les frais de service Malt en dépense — le net correspond au virement reçu,
// et le chiffre d'affaires reste le montant brut (celui à déclarer en micro-entreprise).
import { and, eq } from 'drizzle-orm'
import { clients, invoices, payments, type PaymentMethod } from '../db/schema.ts'
import { formatShortDate } from '../domain/dates.ts'
import { maltFees, statusAfterPayments } from '../domain/invoicing.ts'
import { formatEuros } from '../domain/money.ts'
import { applyRate } from '../domain/money.ts'
import { badRequest, conflict, notFound } from '../http/errors.ts'
import type { TresorerieTransactionInput } from '../integrations/tresorerie.ts'
import { type Ctx, nowIso } from './context.ts'
import { afterPayment, paymentReportOf } from './einvoicing.ts'
import { emitEvent, logActivity } from './events.ts'
import { requireInvoice } from './invoices.ts'
import { cancelOpenReminders, scheduleReminders } from './reminder-plan.ts'
import { getSettings } from './settings.ts'

export interface PaymentInput {
  amountCents: number
  receivedOn: string
  method?: PaymentMethod
  note?: string
}

type PaymentRow = typeof payments.$inferSelect

function requirePayment(ctx: Ctx, id: number): PaymentRow {
  const row = ctx.db.select().from(payments).where(eq(payments.id, id)).get()
  if (!row) throw notFound(`Encaissement ${id} introuvable`)
  return row
}

function refreshInvoiceStatus(ctx: Ctx, invoiceId: number, at: string): { becamePaid: boolean } {
  const invoice = requireInvoice(ctx.db, invoiceId)
  const paid = ctx.db.select({ amount: payments.amountCents }).from(payments).where(eq(payments.invoiceId, invoiceId)).all().reduce((s, p) => s + p.amount, 0)
  const status = statusAfterPayments(invoice.totalTtcCents, paid)
  ctx.db
    .update(invoices)
    .set({ paidCents: paid, status, paidAt: status === 'PAID' ? (invoice.paidAt ?? at) : null, updatedAt: at })
    .where(eq(invoices.id, invoiceId))
    .run()
  if (status === 'PAID') cancelOpenReminders(ctx.db, invoiceId)
  else if (invoice.status === 'PAID') scheduleReminders(ctx.db, { ...invoice, status }, getSettings(ctx.db).reminders.offsetsDays)
  return { becamePaid: status === 'PAID' && invoice.status !== 'PAID' }
}

export async function recordPayment(ctx: Ctx, invoiceId: number, input: PaymentInput) {
  const invoice = requireInvoice(ctx.db, invoiceId)
  if (invoice.status !== 'ISSUED' && invoice.status !== 'PARTIALLY_PAID') throw conflict('Seule une facture émise et non soldée reçoit un encaissement')
  if (input.amountCents <= 0) throw badRequest('Le montant encaissé doit être positif')
  const balance = invoice.totalTtcCents - invoice.paidCents
  if (input.amountCents > balance) throw badRequest(`Montant supérieur au reste à payer (${(balance / 100).toFixed(2)} €)`)
  const at = nowIso(ctx)
  const label = invoice.number ?? invoice.externalRef ?? `#${invoice.id}`
  const payment = ctx.db.transaction((tx) => {
    const created = tx
      .insert(payments)
      .values({
        invoiceId,
        amountCents: input.amountCents,
        receivedOn: input.receivedOn,
        method: input.method ?? (invoice.channel === 'MALT' ? 'MALT' : 'TRANSFER'),
        note: input.note ?? '',
        createdAt: at,
        updatedAt: at,
      })
      .returning()
      .get()
    emitEvent(tx, {
      type: 'mission.payment.recorded',
      at,
      subject: { kind: 'invoice', id: invoiceId, label },
      data: { client_id: invoice.clientId, payment_id: created.id, amount_cents: created.amountCents, received_on: created.receivedOn },
    })
    logActivity(tx, { clientId: invoice.clientId, entityType: 'invoice', entityId: invoiceId, type: 'payment', message: `Encaissement de ${formatEuros(created.amountCents)} reçu le ${formatShortDate(created.receivedOn)}`, at })
    return created
  })
  const { becamePaid } = ctx.db.transaction(() => refreshInvoiceStatus(ctx, invoiceId, at))
  if (becamePaid) {
    emitEvent(ctx.db, {
      type: 'mission.invoice.paid',
      at,
      subject: { kind: 'invoice', id: invoiceId, label },
      data: { client_id: invoice.clientId, total_ttc_cents: invoice.totalTtcCents, channel: invoice.channel },
    })
  }
  const settings = getSettings(ctx.db)
  if (settings.integrations.tresorerieAutoSync) await syncPayment(ctx, payment.id).catch(() => undefined)
  await afterPayment(ctx, payment.id)
  return requirePayment(ctx, payment.id)
}

export function deletePayment(ctx: Ctx, paymentId: number) {
  const payment = requirePayment(ctx, paymentId)
  const reported = paymentReportOf(ctx, paymentId)?.state === 'SENT'
  const at = nowIso(ctx)
  ctx.db.transaction(() => {
    ctx.db.delete(payments).where(eq(payments.id, paymentId)).run()
    refreshInvoiceStatus(ctx, payment.invoiceId, at)
  })
  return {
    deleted: paymentId,
    warning:
      [
        payment.tresorerieStatus === 'SYNCED' ? 'Cet encaissement avait été envoyé à Atelier Trésorerie : supprimez-y aussi les opérations correspondantes.' : null,
        reported ? 'Le statut « Encaissée » avait été transmis à la plateforme agréée : corrigez-le depuis votre compte SUPER PDP.' : null,
      ]
        .filter(Boolean)
        .join(' ') || null,
  }
}

/** Opérations à créer dans Trésorerie pour un encaissement (pur, testé). */
export function tresorerieOperations(
  invoice: Pick<typeof invoices.$inferSelect, 'id' | 'number' | 'externalRef' | 'channel' | 'title' | 'totalHtCents' | 'totalTtcCents' | 'maltFeeBps'>,
  payment: Pick<PaymentRow, 'id' | 'amountCents' | 'receivedOn'>,
  clientName: string,
  config: { accountId: number; revenueCategoryId: number | null; feeCategoryId: number | null; feeVatBps: number },
): { marker: string; input: TresorerieTransactionInput }[] {
  const ref = invoice.number ?? (invoice.externalRef ? `Malt ${invoice.externalRef}` : `Malt #${invoice.id}`)
  const revenueMarker = `[mission:payment:${payment.id}:encaissement]`
  const ops = [
    {
      marker: revenueMarker,
      input: {
        account_id: config.accountId,
        date: payment.receivedOn,
        label: `${clientName} — facture ${ref}`.slice(0, 200),
        amount_cents: payment.amountCents,
        category_id: config.revenueCategoryId,
        notes: `${invoice.title}\nAtelier Mission ${revenueMarker}`.slice(0, 1000),
      },
    },
  ]
  if (invoice.channel === 'MALT' && invoice.maltFeeBps > 0 && invoice.totalTtcCents > 0) {
    // Frais au prorata de l'encaissement (un versement Malt solde en général la facture en une fois).
    const fees = maltFees(invoice.totalHtCents, invoice.totalTtcCents, invoice.maltFeeBps, config.feeVatBps)
    const share = Math.round((fees.feeTtcCents * payment.amountCents) / invoice.totalTtcCents)
    const feeMarker = `[mission:payment:${payment.id}:frais-malt]`
    if (share > 0) {
      ops.push({
        marker: feeMarker,
        input: {
          account_id: config.accountId,
          date: payment.receivedOn,
          label: `Frais de service Malt — ${ref}`.slice(0, 200),
          amount_cents: -share,
          category_id: config.feeCategoryId,
          notes: `${applyRate(10_000, invoice.maltFeeBps) / 100} % HT + TVA, prélevés sur le versement\nAtelier Mission ${feeMarker}`,
        },
      })
    }
  }
  return ops
}

/** Envoie (ou renvoie) un encaissement à Trésorerie. Sans doublon : chaque opération est cherchée par son marqueur. */
export async function syncPayment(ctx: Ctx, paymentId: number) {
  const payment = requirePayment(ctx, paymentId)
  if (payment.tresorerieStatus === 'SYNCED') return payment
  const invoice = requireInvoice(ctx.db, payment.invoiceId)
  const client = ctx.db.select().from(clients).where(eq(clients.id, invoice.clientId)).get()
  const settings = getSettings(ctx.db)
  const { tresorerieAccountId, tresorerieRevenueCategoryId, tresorerieFeeCategoryId, tresorerieUrl } = settings.integrations
  if (tresorerieAccountId === null) {
    ctx.db
      .update(payments)
      .set({ tresorerieStatus: 'PENDING', tresorerieError: 'Choisissez le compte bancaire Trésorerie dans Paramètres › Connexions' })
      .where(eq(payments.id, paymentId))
      .run()
    return requirePayment(ctx, paymentId)
  }
  const ops = tresorerieOperations(invoice, payment, client?.name ?? 'Client', {
    accountId: tresorerieAccountId,
    revenueCategoryId: tresorerieRevenueCategoryId,
    feeCategoryId: tresorerieFeeCategoryId,
    feeVatBps: settings.malt.feeVatBps,
  })
  try {
    const tresorerie = ctx.integrations.tresorerie(tresorerieUrl)
    const ids: number[] = []
    for (const op of ops) {
      ids.push((await tresorerie.findByMarker(op.marker)) ?? (await tresorerie.createTransaction(op.input)))
    }
    ctx.db
      .update(payments)
      .set({ tresorerieStatus: 'SYNCED', tresorerieTransactionIds: JSON.stringify(ids), tresorerieError: null, syncedAt: nowIso(ctx) })
      .where(eq(payments.id, paymentId))
      .run()
  } catch (error) {
    ctx.db
      .update(payments)
      .set({ tresorerieStatus: 'FAILED', tresorerieError: error instanceof Error ? error.message : String(error) })
      .where(eq(payments.id, paymentId))
      .run()
    throw error
  }
  return requirePayment(ctx, paymentId)
}

/** Encaissements non envoyés (en attente ou en échec) : relancés depuis l'écran Paramètres ou le tableau de bord. */
export async function syncPendingPayments(ctx: Ctx) {
  const pending = ctx.db
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.tresorerieStatus, 'PENDING')))
    .all()
    .concat(ctx.db.select({ id: payments.id }).from(payments).where(eq(payments.tresorerieStatus, 'FAILED')).all())
  let synced = 0
  let failed = 0
  for (const { id } of pending) {
    try {
      const result = await syncPayment(ctx, id)
      if (result.tresorerieStatus === 'SYNCED') synced += 1
      else failed += 1
    } catch {
      failed += 1
    }
  }
  return { synced, failed, total: pending.length }
}

export function skipPaymentSync(ctx: Ctx, paymentId: number) {
  requirePayment(ctx, paymentId)
  ctx.db.update(payments).set({ tresorerieStatus: 'SKIPPED', tresorerieError: null }).where(eq(payments.id, paymentId)).run()
  return requirePayment(ctx, paymentId)
}
