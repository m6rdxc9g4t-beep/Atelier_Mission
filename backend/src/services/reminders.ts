// Relances des factures impayées par e-mail, envoyées par Brevo.
// Garde-fous : mode « En ligne » obligatoire (flux sortant, comme SUPER PDP), clé BREVO_API_KEY, expéditeur vérifié,
// facture encore ouverte et adresse du client connue. Si plusieurs niveaux sont dus en même temps (app fermée
// quelques jours), seul le plus élevé part : les autres sont marqués « dépassés » — le client ne reçoit pas trois mails.
import { and, asc, eq, lte } from 'drizzle-orm'
import { clients, invoices, reminders } from '../db/schema.ts'
import { daysBetween } from '../domain/dates.ts'
import { isOpenInvoice } from '../domain/invoicing.ts'
import { REMINDER_LEVEL_LABELS, reminderEmail, type ReminderEmail } from '../domain/reminders.ts'
import { badRequest, conflict, forbidden, notFound } from '../http/errors.ts'
import { UpstreamError } from '../integrations/http.ts'
import { type Ctx, nowIso, today } from './context.ts'
import { emitEvent, logActivity } from './events.ts'
import { getSettings } from './settings.ts'

type ReminderRow = typeof reminders.$inferSelect

function requireReminder(ctx: Ctx, id: number): ReminderRow {
  const row = ctx.db.select().from(reminders).where(eq(reminders.id, id)).get()
  if (!row) throw notFound(`Relance ${id} introuvable`)
  return row
}

export function listReminders(ctx: Ctx, options: { scope?: 'due' | 'upcoming' | 'history' | 'all' } = {}) {
  const day = today(ctx)
  const rows = ctx.db
    .select({ reminder: reminders, invoice: invoices, clientName: clients.name, clientEmail: clients.email })
    .from(reminders)
    .innerJoin(invoices, eq(invoices.id, reminders.invoiceId))
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .orderBy(asc(reminders.dueOn), asc(reminders.level))
    .all()
  return rows
    .map(({ reminder, invoice, clientName, clientEmail }) => {
      const due = reminder.status === 'PLANNED' && reminder.dueOn <= day
      return {
        ...reminder,
        state: due ? ('DUE' as const) : reminder.status,
        levelLabel: REMINDER_LEVEL_LABELS[reminder.level] ?? `Niveau ${reminder.level}`,
        invoice: {
          id: invoice.id,
          number: invoice.number,
          title: invoice.title,
          dueDate: invoice.dueDate,
          balanceCents: invoice.totalTtcCents - invoice.paidCents,
          status: invoice.status,
        },
        clientName,
        clientEmail,
        daysLate: invoice.dueDate ? Math.max(0, daysBetween(invoice.dueDate, day)) : 0,
      }
    })
    .filter((r) => {
      switch (options.scope ?? 'all') {
        case 'due':
          return r.state === 'DUE' || r.state === 'FAILED'
        case 'upcoming':
          return r.state === 'PLANNED'
        case 'history':
          return r.status === 'SENT' || r.status === 'CANCELLED'
        default:
          return true
      }
    })
}

function buildEmail(ctx: Ctx, reminder: ReminderRow): { email: ReminderEmail; to: string | null; invoice: typeof invoices.$inferSelect; clientName: string } {
  const invoice = ctx.db.select().from(invoices).where(eq(invoices.id, reminder.invoiceId)).get()
  if (!invoice) throw notFound(`Facture ${reminder.invoiceId} introuvable`)
  const client = ctx.db.select().from(clients).where(eq(clients.id, invoice.clientId)).get()
  if (!client) throw notFound(`Client ${invoice.clientId} introuvable`)
  const settings = getSettings(ctx.db)
  const day = today(ctx)
  const email = reminderEmail({
    level: reminder.level,
    invoiceNumber: invoice.number ?? `#${invoice.id}`,
    invoiceTitle: invoice.title,
    issueDate: invoice.issueDate ?? day,
    dueDate: invoice.dueDate ?? day,
    balanceCents: invoice.totalTtcCents - invoice.paidCents,
    daysLate: invoice.dueDate ? Math.max(0, daysBetween(invoice.dueDate, day)) : 0,
    clientContactName: client.contactName,
    clientName: client.name,
    sellerName: settings.company.name || settings.integrations.brevoSenderName || 'Atelier Mission',
    sellerEmail: settings.company.email || settings.integrations.brevoSenderEmail || null,
    iban: settings.company.iban || null,
    latePenaltyRateText: settings.billing.latePenaltyRateText,
    recoveryFeeCents: settings.billing.recoveryFeeCents,
  })
  return { email, to: client.email, invoice, clientName: client.name }
}

export function previewReminder(ctx: Ctx, id: number) {
  const reminder = requireReminder(ctx, id)
  const { email, to } = buildEmail(ctx, reminder)
  return { id, level: reminder.level, to, ...email }
}

/** Raison pour laquelle une relance ne peut pas partir maintenant (null = prête). */
export function sendBlocker(ctx: Ctx): { code: string; message: string } | null {
  const settings = getSettings(ctx.db)
  if (!settings.onlineMode) return { code: 'OFFLINE', message: 'Mode hors ligne : passez « En ligne » pour envoyer des relances par Brevo' }
  if (!ctx.integrations.brevo) return { code: 'BREVO_NOT_CONFIGURED', message: 'Clé Brevo absente : renseignez BREVO_API_KEY dans backend/.env puis relancez l’API' }
  if (!settings.integrations.brevoSenderEmail) return { code: 'BREVO_NO_SENDER', message: 'Choisissez l’expéditeur Brevo (adresse vérifiée) dans Paramètres › Connexions' }
  return null
}

export async function sendReminder(ctx: Ctx, id: number) {
  const reminder = requireReminder(ctx, id)
  if (reminder.status === 'SENT') throw conflict('Relance déjà envoyée')
  if (reminder.status === 'CANCELLED') throw conflict('Relance annulée')
  const blocker = sendBlocker(ctx)
  if (blocker) throw forbidden(blocker.code, blocker.message)
  const { email, to, invoice, clientName } = buildEmail(ctx, reminder)
  if (!isOpenInvoice(invoice.status)) throw conflict('La facture n’est plus impayée : relance inutile')
  if (!to) throw badRequest(`Pas d’adresse e-mail pour ${clientName} : complétez sa fiche`)
  const settings = getSettings(ctx.db)
  const sender = { email: settings.integrations.brevoSenderEmail, name: settings.integrations.brevoSenderName || settings.company.name || undefined }
  const at = nowIso(ctx)
  try {
    const result = await ctx.integrations.brevo!.sendEmail({
      sender,
      to: [{ email: to, name: clientName }],
      bcc: settings.reminders.bccSelf && settings.company.email && settings.company.email !== to ? [{ email: settings.company.email }] : undefined,
      replyTo: settings.company.email ? { email: settings.company.email, name: settings.company.name || undefined } : undefined,
      subject: email.subject,
      htmlContent: email.html,
      textContent: email.text,
      tags: ['atelier-mission', `relance-${reminder.level}`],
    })
    ctx.db.transaction((tx) => {
      tx.update(reminders)
        .set({ status: 'SENT', sentAt: at, toEmail: to, subject: email.subject, brevoMessageId: result.messageId, error: null })
        .where(eq(reminders.id, id))
        .run()
      // Niveaux inférieurs encore planifiés : dépassés par cet envoi.
      for (const lower of tx.select().from(reminders).where(and(eq(reminders.invoiceId, invoice.id), eq(reminders.status, 'PLANNED'))).all()) {
        if (lower.level < reminder.level) tx.update(reminders).set({ status: 'CANCELLED', error: 'Dépassée par une relance de niveau supérieur' }).where(eq(reminders.id, lower.id)).run()
      }
      emitEvent(tx, {
        type: 'mission.reminder.sent',
        at,
        subject: { kind: 'invoice', id: invoice.id, label: invoice.number ?? `#${invoice.id}` },
        data: { client_id: invoice.clientId, level: reminder.level, balance_cents: invoice.totalTtcCents - invoice.paidCents },
      })
      logActivity(tx, {
        clientId: invoice.clientId,
        entityType: 'invoice',
        entityId: invoice.id,
        type: 'reminder_sent',
        message: `${REMINDER_LEVEL_LABELS[reminder.level] ?? 'Relance'} envoyée à ${to} (Brevo)`,
        at,
      })
    })
  } catch (error) {
    const message = error instanceof UpstreamError ? error.message : error instanceof Error ? error.message : String(error)
    ctx.db.update(reminders).set({ status: 'FAILED', error: message, toEmail: to, subject: email.subject }).where(eq(reminders.id, id)).run()
    throw error
  }
  return requireReminder(ctx, id)
}

export function cancelReminder(ctx: Ctx, id: number) {
  const reminder = requireReminder(ctx, id)
  if (reminder.status === 'SENT') throw conflict('Relance déjà envoyée')
  ctx.db.update(reminders).set({ status: 'CANCELLED' }).where(eq(reminders.id, id)).run()
  return requireReminder(ctx, id)
}

export function rescheduleReminder(ctx: Ctx, id: number, dueOn: string) {
  const reminder = requireReminder(ctx, id)
  if (reminder.status === 'SENT') throw conflict('Relance déjà envoyée')
  ctx.db.update(reminders).set({ status: 'PLANNED', dueOn, error: null }).where(eq(reminders.id, id)).run()
  return requireReminder(ctx, id)
}

export interface RunSummary {
  sent: number
  failed: number
  skipped: number
  blocked: string | null
}

/**
 * Envoie les relances dues. `force` : appel manuel (bouton « Tout envoyer »), sans exiger l'envoi automatique.
 * Le planificateur appelle sans `force` : rien ne part si l'envoi automatique est désactivé.
 */
export async function runDueReminders(ctx: Ctx, options: { force?: boolean } = {}): Promise<RunSummary> {
  const settings = getSettings(ctx.db)
  const summary: RunSummary = { sent: 0, failed: 0, skipped: 0, blocked: null }
  if (!options.force && !settings.reminders.autoSend) return { ...summary, blocked: 'AUTO_SEND_DISABLED' }
  const blocker = sendBlocker(ctx)
  if (blocker) return { ...summary, blocked: blocker.code }
  const day = today(ctx)
  const due = ctx.db
    .select({ reminder: reminders, invoiceStatus: invoices.status })
    .from(reminders)
    .innerJoin(invoices, eq(invoices.id, reminders.invoiceId))
    .where(and(eq(reminders.status, 'PLANNED'), lte(reminders.dueOn, day)))
    .all()
  // Une seule relance par facture : le niveau le plus élevé parmi ceux qui sont dus.
  const byInvoice = new Map<number, ReminderRow>()
  for (const { reminder, invoiceStatus } of due) {
    if (!isOpenInvoice(invoiceStatus)) {
      summary.skipped += 1
      continue
    }
    const current = byInvoice.get(reminder.invoiceId)
    if (!current || reminder.level > current.level) byInvoice.set(reminder.invoiceId, reminder)
  }
  for (const reminder of byInvoice.values()) {
    try {
      await sendReminder(ctx, reminder.id)
      summary.sent += 1
    } catch {
      summary.failed += 1
    }
  }
  return summary
}
