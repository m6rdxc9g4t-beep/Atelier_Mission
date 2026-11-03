// Facture électronique via la plateforme agréée SUPER PDP : dépôt du Factur-X, suivi du cycle de vie, statut
// « Encaissée » (données de paiement de l'e-reporting). Appels EXTÉRIEURS : mode « En ligne » obligatoire.
//
// Sûreté :
// - une facture n'est déposée qu'une fois (external_id = son numéro) ; si la réponse du dépôt se perd (délai, coupure),
//   l'état passe à UNKNOWN et le nouvel essai cherche d'abord le dépôt parmi les factures émises récentes ;
// - les événements sont lus par curseur (identifiants strictement croissants, recommandation de SUPER PDP) et stockés
//   une seule fois (remote_event_id unique) ;
// - un encaissement n'est déclaré qu'une fois (einvoice_payment_reports.payment_id unique).
import { and, asc, eq, inArray } from 'drizzle-orm'
import { clients, counters, einvoiceEvents, einvoicePaymentReports, einvoiceTransmissions, invoiceLines, invoices, payments } from '../db/schema.ts'
import { isBlocking, lifecycleLabel, ratePercent, splitPaymentByRate } from '../domain/einvoicing.ts'
import { computeTotals } from '../domain/money.ts'
import { badRequest, conflict, forbidden, notFound } from '../http/errors.ts'
import { UpstreamError } from '../integrations/http.ts'
import type { SuperPdpEvent } from '../integrations/superpdp.ts'
import { type Ctx, nowIso } from './context.ts'
import { emitEvent, logActivity } from './events.ts'
import { facturxPdf } from './facturx.ts'
import { requireInvoice } from './invoices.ts'
import { getSettings } from './settings.ts'

const CURSOR = 'superpdp:events'

type Transmission = typeof einvoiceTransmissions.$inferSelect

/** Raison pour laquelle rien ne peut partir vers la plateforme maintenant (null = prêt). */
export function einvoicingBlocker(ctx: Ctx): { code: string; message: string } | null {
  if (!ctx.integrations.superpdp) {
    return { code: 'SUPERPDP_NOT_CONFIGURED', message: 'SUPER PDP non configurée : renseignez SUPERPDP_CLIENT_ID et SUPERPDP_CLIENT_SECRET dans backend/.env puis relancez l’API' }
  }
  if (!getSettings(ctx.db).onlineMode) return { code: 'OFFLINE', message: 'Mode hors ligne : passez « En ligne » pour échanger avec la plateforme agréée' }
  return null
}

function requireReady(ctx: Ctx) {
  const blocker = einvoicingBlocker(ctx)
  if (blocker) throw forbidden(blocker.code, blocker.message)
  return ctx.integrations.superpdp!
}

/** Une facture peut-elle partir sur le réseau de la facture électronique ? (null = oui) */
export function eligibility(ctx: Ctx, invoiceId: number): string | null {
  const invoice = requireInvoice(ctx.db, invoiceId)
  if (invoice.channel === 'MALT') return 'Mission Malt : Malt émet et transmet la facture officielle'
  if (invoice.status === 'DRAFT' || !invoice.number) return 'Émettez d’abord la facture'
  const snapshot = invoice.clientSnapshot ? (JSON.parse(invoice.clientSnapshot) as { siren?: string | null }) : null
  const siren = snapshot?.siren ?? ctx.db.select({ siren: clients.siren }).from(clients).where(eq(clients.id, invoice.clientId)).get()?.siren
  if (!siren) return 'SIREN du client manquant : il sert à acheminer la facture vers sa plateforme (complétez la fiche client avant d’émettre)'
  return null
}

export function transmissionOf(ctx: Ctx, invoiceId: number) {
  const transmission = ctx.db.select().from(einvoiceTransmissions).where(eq(einvoiceTransmissions.invoiceId, invoiceId)).get()
  if (!transmission) return null
  const events = ctx.db.select().from(einvoiceEvents).where(eq(einvoiceEvents.transmissionId, transmission.id)).orderBy(asc(einvoiceEvents.remoteEventId)).all()
  return { ...transmission, lastStatusLabel: transmission.lastStatusCode ? lifecycleLabel(transmission.lastStatusCode, transmission.lastStatusText) : null, events }
}

export function einvoiceView(ctx: Ctx, invoiceId: number) {
  return { eligibility: eligibility(ctx, invoiceId), transmission: transmissionOf(ctx, invoiceId) }
}

/** Enregistre un événement de la plateforme (une seule fois) et met à jour l'état de la transmission. */
function recordEvent(ctx: Ctx, transmission: Transmission, event: SuperPdpEvent): boolean {
  const known = ctx.db.select({ id: einvoiceEvents.id }).from(einvoiceEvents).where(eq(einvoiceEvents.remoteEventId, event.id)).get()
  if (known) return false
  const at = event.created_at || nowIso(ctx)
  const label = lifecycleLabel(event.status_code, event.status_text)
  const blocking = isBlocking(event.status_code, event.status_text)
  const invoice = requireInvoice(ctx.db, transmission.invoiceId)
  ctx.db.transaction((tx) => {
    tx.insert(einvoiceEvents)
      .values({ transmissionId: transmission.id, remoteEventId: event.id, statusCode: event.status_code, statusText: event.status_text ?? null, reason: event.data?.reason ?? null, at })
      .run()
    const latest = !transmission.lastEventAt || at >= transmission.lastEventAt
    tx.update(einvoiceTransmissions)
      .set({
        ...(latest ? { lastStatusCode: event.status_code, lastStatusText: event.status_text ?? null, lastEventAt: at } : {}),
        ...(blocking ? { state: 'REJECTED' as const, error: event.data?.reason ?? label } : {}),
        updatedAt: nowIso(ctx),
      })
      .where(eq(einvoiceTransmissions.id, transmission.id))
      .run()
    emitEvent(tx, {
      type: 'mission.einvoice.status_changed',
      at: nowIso(ctx),
      subject: { kind: 'invoice', id: invoice.id, label: invoice.number ?? `#${invoice.id}` },
      data: { client_id: invoice.clientId, status_code: event.status_code, status: label, blocking },
    })
    logActivity(tx, {
      clientId: invoice.clientId,
      entityType: 'invoice',
      entityId: invoice.id,
      type: 'einvoice_status',
      message: `Facture électronique : ${label}${event.data?.reason ? ` — ${event.data.reason}` : ''}`,
      at: nowIso(ctx),
    })
  })
  return true
}

export async function sendEinvoice(ctx: Ctx, invoiceId: number) {
  const reason = eligibility(ctx, invoiceId)
  if (reason) throw badRequest(reason)
  const client = requireReady(ctx)
  const invoice = requireInvoice(ctx.db, invoiceId)
  const number = invoice.number!
  let transmission = ctx.db.select().from(einvoiceTransmissions).where(eq(einvoiceTransmissions.invoiceId, invoiceId)).get()
  if (transmission?.state === 'SENT') throw conflict('Facture déjà déposée sur la plateforme agréée')
  if (transmission?.state === 'REJECTED') {
    throw conflict('Facture rejetée ou refusée : une facture émise ne se redépose pas — annulez-la par un avoir et émettez-en une nouvelle')
  }
  const at = nowIso(ctx)

  // Réponse d'un précédent dépôt perdue : la facture est peut-être déjà chez la plateforme.
  if (transmission?.state === 'UNKNOWN') {
    const found = (await client.recentOutgoing(100)).find((r) => r.external_id === number)
    if (found) return confirmDeposit(ctx, transmission, found.id, found.events ?? [], at)
  }

  transmission = transmission
    ? ctx.db.update(einvoiceTransmissions).set({ state: 'SENDING', error: null, updatedAt: at }).where(eq(einvoiceTransmissions.id, transmission.id)).returning().get()
    : ctx.db.insert(einvoiceTransmissions).values({ invoiceId, state: 'SENDING', createdAt: at, updatedAt: at }).returning().get()

  const { pdf } = await facturxPdf(ctx, invoiceId)
  try {
    const deposit = await client.sendInvoice(pdf, number)
    return confirmDeposit(ctx, transmission, deposit.id, deposit.events ?? [], at)
  } catch (error) {
    // Réponse HTTP reçue = refus net (dépôt non fait) ; pas de réponse = issue inconnue (peut-être déposée).
    const answered = error instanceof UpstreamError && error.upstreamStatus !== null
    ctx.db
      .update(einvoiceTransmissions)
      .set({ state: answered ? 'FAILED' : 'UNKNOWN', error: error instanceof Error ? error.message : String(error), updatedAt: nowIso(ctx) })
      .where(eq(einvoiceTransmissions.id, transmission.id))
      .run()
    throw error
  }
}

function confirmDeposit(ctx: Ctx, transmission: Transmission, remoteId: number, events: SuperPdpEvent[], at: string) {
  const invoice = requireInvoice(ctx.db, transmission.invoiceId)
  ctx.db.transaction((tx) => {
    tx.update(einvoiceTransmissions)
      .set({ state: 'SENT', remoteId, error: null, sentAt: transmission.sentAt ?? at, updatedAt: at })
      .where(eq(einvoiceTransmissions.id, transmission.id))
      .run()
    emitEvent(tx, {
      type: 'mission.einvoice.sent',
      at,
      subject: { kind: 'invoice', id: invoice.id, label: invoice.number ?? `#${invoice.id}` },
      data: { client_id: invoice.clientId, platform: 'SUPERPDP', remote_id: String(remoteId), kind: invoice.kind },
    })
    logActivity(tx, { clientId: invoice.clientId, entityType: 'invoice', entityId: invoice.id, type: 'einvoice_sent', message: `Facture électronique déposée sur SUPER PDP (n° ${remoteId})`, at })
  })
  const fresh = ctx.db.select().from(einvoiceTransmissions).where(eq(einvoiceTransmissions.id, transmission.id)).get()!
  for (const event of events) recordEvent(ctx, ctx.db.select().from(einvoiceTransmissions).where(eq(einvoiceTransmissions.id, fresh.id)).get()!, { ...event, invoice_id: remoteId })
  return transmissionOf(ctx, transmission.invoiceId)!
}

/** Lit les nouveaux événements de la plateforme (curseur persistant) et met à jour les factures concernées. */
export async function syncEvents(ctx: Ctx): Promise<number> {
  const client = requireReady(ctx)
  let cursor = ctx.db.select().from(counters).where(eq(counters.name, CURSOR)).get()?.value ?? 0
  let recorded = 0
  for (let page = 0; page < 50; page += 1) {
    const list = await client.listEvents(cursor, 100)
    const events = list.data ?? []
    if (events.length === 0) break
    const remoteIds = [...new Set(events.map((e) => e.invoice_id))]
    const transmissions = ctx.db.select().from(einvoiceTransmissions).where(inArray(einvoiceTransmissions.remoteId, remoteIds)).all()
    for (const event of events.sort((a, b) => a.id - b.id)) {
      const transmission = transmissions.find((t) => t.remoteId === event.invoice_id)
      // Événements de factures inconnues (factures reçues des fournisseurs…) : ignorés, le curseur avance quand même.
      if (transmission && recordEvent(ctx, ctx.db.select().from(einvoiceTransmissions).where(eq(einvoiceTransmissions.id, transmission.id)).get()!, event)) recorded += 1
      cursor = Math.max(cursor, event.id)
    }
    ctx.db.insert(counters).values({ name: CURSOR, value: cursor }).onConflictDoUpdate({ target: counters.name, set: { value: cursor } }).run()
    if (!list.has_after) break
  }
  return recorded
}

/** Déclare un encaissement (statut « Encaissée », fr:212) pour une facture déposée. */
export async function reportPayment(ctx: Ctx, paymentId: number) {
  const payment = ctx.db.select().from(payments).where(eq(payments.id, paymentId)).get()
  if (!payment) throw notFound(`Encaissement ${paymentId} introuvable`)
  const invoice = requireInvoice(ctx.db, payment.invoiceId)
  const transmission = ctx.db.select().from(einvoiceTransmissions).where(eq(einvoiceTransmissions.invoiceId, invoice.id)).get()
  if (!transmission || transmission.state !== 'SENT' || transmission.remoteId === null) {
    throw conflict('La facture n’a pas été déposée sur la plateforme : rien à déclarer pour cet encaissement')
  }
  const existing = ctx.db.select().from(einvoicePaymentReports).where(eq(einvoicePaymentReports.paymentId, paymentId)).get()
  if (existing?.state === 'SENT') return existing
  const client = requireReady(ctx)
  const at = nowIso(ctx)
  const report =
    existing ?? ctx.db.insert(einvoicePaymentReports).values({ paymentId, state: 'PENDING', createdAt: at, updatedAt: at }).returning().get()
  const franchise = (invoice.sellerSnapshot ? (JSON.parse(invoice.sellerSnapshot) as { vatRegime?: string }).vatRegime : getSettings(ctx.db).company.vatRegime) === 'FRANCHISE'
  const buckets = computeTotals(ctx.db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoice.id)).all()).byRate
  const parts = splitPaymentByRate(payment.amountCents, buckets, franchise)
  try {
    const event = await client.reportPayment(
      transmission.remoteId,
      parts.map((p) => ({ amountCents: p.amountCents, ratePercent: ratePercent(p.rateBps), date: payment.receivedOn })),
    )
    ctx.db
      .update(einvoicePaymentReports)
      .set({ state: 'SENT', remoteEventId: event?.id ?? null, error: null, sentAt: at, updatedAt: at })
      .where(eq(einvoicePaymentReports.id, report.id))
      .run()
    logActivity(ctx.db, { clientId: invoice.clientId, entityType: 'invoice', entityId: invoice.id, type: 'einvoice_paid', message: 'Statut « Encaissée » transmis à la plateforme agréée', at })
  } catch (error) {
    ctx.db
      .update(einvoicePaymentReports)
      .set({ state: 'FAILED', error: error instanceof Error ? error.message : String(error), updatedAt: nowIso(ctx) })
      .where(eq(einvoicePaymentReports.id, report.id))
      .run()
    throw error
  }
  return ctx.db.select().from(einvoicePaymentReports).where(eq(einvoicePaymentReports.id, report.id)).get()!
}

export function paymentReportOf(ctx: Ctx, paymentId: number) {
  return ctx.db.select().from(einvoicePaymentReports).where(eq(einvoicePaymentReports.paymentId, paymentId)).get() ?? null
}

// --- Automatismes (ne bloquent jamais l'action de l'utilisateur) ----------------------------------------------

/** Après l'émission (ou l'annulation, pour l'avoir) : dépôt automatique si activé, en ligne et éligible. */
export async function afterIssue(ctx: Ctx, invoiceId: number): Promise<void> {
  if (!getSettings(ctx.db).einvoicing.autoSend || einvoicingBlocker(ctx) || eligibility(ctx, invoiceId)) return
  await sendEinvoice(ctx, invoiceId).catch(() => undefined)
}

/** Après un encaissement : statut « Encaissée » si la facture a été déposée. */
export async function afterPayment(ctx: Ctx, paymentId: number): Promise<void> {
  if (!getSettings(ctx.db).einvoicing.reportPayments || einvoicingBlocker(ctx)) return
  const payment = ctx.db.select().from(payments).where(eq(payments.id, paymentId)).get()
  if (!payment) return
  const sent = ctx.db
    .select({ id: einvoiceTransmissions.id })
    .from(einvoiceTransmissions)
    .where(and(eq(einvoiceTransmissions.invoiceId, payment.invoiceId), eq(einvoiceTransmissions.state, 'SENT')))
    .get()
  if (sent) await reportPayment(ctx, paymentId).catch(() => undefined)
}

/** Planificateur : nouveaux statuts + encaissements à déclarer encore en attente ou en échec. Silencieux hors ligne. */
export async function syncEinvoicing(ctx: Ctx): Promise<{ events: number; reports: number; blocked: string | null }> {
  const blocker = einvoicingBlocker(ctx)
  if (blocker) return { events: 0, reports: 0, blocked: blocker.code }
  const events = await syncEvents(ctx)
  let reports = 0
  if (getSettings(ctx.db).einvoicing.reportPayments) {
    const sentInvoices = ctx.db.select({ invoiceId: einvoiceTransmissions.invoiceId }).from(einvoiceTransmissions).where(eq(einvoiceTransmissions.state, 'SENT')).all()
    const ids = sentInvoices.map((s) => s.invoiceId)
    const pending = ids.length
      ? ctx.db
          .select({ id: payments.id, report: einvoicePaymentReports.state })
          .from(payments)
          .leftJoin(einvoicePaymentReports, eq(einvoicePaymentReports.paymentId, payments.id))
          .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
          .where(and(inArray(payments.invoiceId, ids), eq(invoices.kind, 'INVOICE')))
          .all()
          .filter((p) => p.report !== 'SENT')
      : []
    for (const p of pending) {
      try {
        await reportPayment(ctx, p.id)
        reports += 1
      } catch {
        // état FAILED enregistré ; nouvel essai au prochain passage
      }
    }
  }
  return { events, reports, blocked: null }
}

export async function checkConnection(ctx: Ctx) {
  const client = requireReady(ctx)
  const [session, company] = await Promise.all([client.session(), client.company()])
  const settings = getSettings(ctx.db)
  const ownSiren = (settings.company.siren || settings.company.siret.slice(0, 9)).replace(/\s+/g, '')
  return {
    company,
    verified: session.companyVerificationStatus === 'verified',
    verificationStatus: session.companyVerificationStatus,
    sirenMatches: !company.number || !ownSiren ? null : company.number.replace(/\s+/g, '') === ownSiren,
  }
}
