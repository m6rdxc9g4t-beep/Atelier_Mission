// Relances de factures impayées : calendrier et contenu des e-mails (envoyés par Brevo).
import { addDays, formatLongDate } from './dates.ts'
import { formatEuros } from './money.ts'

export const REMINDER_LEVEL_LABELS: Record<number, string> = {
  1: 'Rappel amical',
  2: 'Relance',
  3: 'Dernière relance',
}

export const DEFAULT_REMINDER_OFFSETS = [3, 15, 30] as const

/** Relances à planifier après l'échéance : un niveau par décalage (jours après l'échéance), triés. */
export function planReminders(dueDate: string, offsetsDays: readonly number[]): { level: number; dueOn: string }[] {
  return [...new Set(offsetsDays.filter((d) => Number.isInteger(d) && d >= 0))]
    .sort((a, b) => a - b)
    .slice(0, 3)
    .map((offset, index) => ({ level: index + 1, dueOn: addDays(dueDate, offset) }))
}

export interface ReminderContext {
  level: number
  invoiceNumber: string
  invoiceTitle: string
  issueDate: string
  dueDate: string
  balanceCents: number
  daysLate: number
  clientContactName: string | null
  clientName: string
  sellerName: string
  sellerEmail: string | null
  iban: string | null
  latePenaltyRateText: string
  recoveryFeeCents: number
}

export interface ReminderEmail {
  subject: string
  text: string
  html: string
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c)
}

/** Corps de la relance : ton croissant avec le niveau, rappel des pénalités à partir du niveau 2. */
export function reminderEmail(ctx: ReminderContext): ReminderEmail {
  const hello = ctx.clientContactName ? `Bonjour ${ctx.clientContactName},` : 'Bonjour,'
  const amount = formatEuros(ctx.balanceCents)
  const ref = `la facture ${ctx.invoiceNumber} du ${formatLongDate(ctx.issueDate)} (${ctx.invoiceTitle})`
  const due = formatLongDate(ctx.dueDate)
  const paragraphs: string[] = []
  let subject: string

  if (ctx.level <= 1) {
    subject = `Rappel : facture ${ctx.invoiceNumber} arrivée à échéance`
    paragraphs.push(
      `Sauf erreur de ma part, ${ref} arrivait à échéance le ${due} et reste à régler pour un montant de ${amount}.`,
      'Il s’agit peut-être d’un simple oubli : pourriez-vous vérifier de votre côté ? Si le paiement est déjà parti, merci de ne pas tenir compte de ce message.',
    )
  } else if (ctx.level === 2) {
    subject = `Relance : facture ${ctx.invoiceNumber} impayée (${ctx.daysLate} jours de retard)`
    paragraphs.push(
      `Je reviens vers vous au sujet de ${ref}, échue depuis le ${due}. Le solde de ${amount} n’a pas encore été reçu.`,
      `Je vous remercie de procéder au règlement dans les meilleurs délais. Pour rappel, les conditions de la facture prévoient des pénalités de retard (${ctx.latePenaltyRateText}) ainsi qu’une indemnité forfaitaire de ${formatEuros(ctx.recoveryFeeCents)} pour frais de recouvrement.`,
    )
  } else {
    subject = `Dernière relance avant mise en demeure : facture ${ctx.invoiceNumber}`
    paragraphs.push(
      `Malgré mes précédents messages, ${ref} reste impayée ${ctx.daysLate} jours après son échéance du ${due}, pour un solde de ${amount}.`,
      `Sans règlement sous 8 jours, je serai contraint·e de vous adresser une mise en demeure et d’appliquer les pénalités de retard (${ctx.latePenaltyRateText}) et l’indemnité forfaitaire de ${formatEuros(ctx.recoveryFeeCents)}.`,
      'Si une difficulté empêche le paiement, parlons-en : je préfère toujours trouver une solution ensemble.',
    )
  }
  if (ctx.iban) paragraphs.push(`Coordonnées bancaires : IBAN ${ctx.iban}.`)
  paragraphs.push('Je reste disponible pour toute question.')

  const signature = [ctx.sellerName, ctx.sellerEmail].filter(Boolean).join('\n')
  const text = [hello, '', ...paragraphs.flatMap((p) => [p, '']), 'Bien cordialement,', signature].join('\n')
  const html = [
    '<!DOCTYPE html><html lang="fr"><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#1f1b16">',
    `<p>${escapeHtml(hello)}</p>`,
    ...paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`),
    `<p>Bien cordialement,<br>${signature.split('\n').map(escapeHtml).join('<br>')}</p>`,
    '</body></html>',
  ].join('')
  return { subject, text, html }
}
