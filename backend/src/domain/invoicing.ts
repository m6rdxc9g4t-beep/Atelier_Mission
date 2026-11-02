// Règles de facturation : statut effectif (retard), solde, numérotation, frais Malt, mentions légales.
import type { Channel, InvoiceStatus } from '../db/schema.ts'
import { applyRate } from './money.ts'

export type EffectiveInvoiceStatus = InvoiceStatus | 'OVERDUE'

export const INVOICE_STATUS_LABELS: Record<EffectiveInvoiceStatus, string> = {
  DRAFT: 'Brouillon',
  ISSUED: 'Émise',
  PARTIALLY_PAID: 'Payée en partie',
  PAID: 'Payée',
  OVERDUE: 'En retard',
  CANCELLED: 'Annulée',
}

export const QUOTE_STATUS_LABELS = {
  DRAFT: 'Brouillon',
  SENT: 'Envoyé',
  ACCEPTED: 'Accepté',
  DECLINED: 'Refusé',
  EXPIRED: 'Expiré',
} as const

/** Une facture émise (ou payée en partie) dont l'échéance est passée est « en retard ». */
export function effectiveStatus(status: InvoiceStatus, dueDate: string | null, today: string): EffectiveInvoiceStatus {
  if ((status === 'ISSUED' || status === 'PARTIALLY_PAID') && dueDate !== null && dueDate < today) return 'OVERDUE'
  return status
}

export function isOpenInvoice(status: InvoiceStatus): boolean {
  return status === 'ISSUED' || status === 'PARTIALLY_PAID'
}

export function balanceCents(totalTtcCents: number, paidCents: number): number {
  return totalTtcCents - paidCents
}

/** Statut après un encaissement (ou la suppression d'un encaissement). */
export function statusAfterPayments(totalTtcCents: number, paidCents: number): InvoiceStatus {
  if (paidCents <= 0) return 'ISSUED'
  return paidCents >= totalTtcCents ? 'PAID' : 'PARTIALLY_PAID'
}

/** Numéro chronologique : F-2026-0007, D-2026-0012, A-2026-0001 (avoir). */
export function formatDocumentNumber(prefix: string, year: number | string, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(4, '0')}`
}

export interface MaltFees {
  feeHtCents: number
  feeVatCents: number
  feeTtcCents: number
  /** Ce que Malt verse réellement au freelance : TTC facturé − frais TTC. */
  netPayoutCents: number
}

/**
 * Frais de service Malt côté freelance : un pourcentage du montant HT de la mission, TVA (20 %) en sus,
 * prélevés sur le versement. Le taux dépend de la relation client (souvent 10 % puis 5 %) et Malt l'a
 * changé plusieurs fois en 2026 : il est donc réglable par client et figé sur chaque facture.
 */
export function maltFees(totalHtCents: number, totalTtcCents: number, feeBps: number, feeVatBps = 2000): MaltFees {
  const feeHtCents = applyRate(totalHtCents, feeBps)
  const feeVatCents = applyRate(feeHtCents, feeVatBps)
  const feeTtcCents = feeHtCents + feeVatCents
  return { feeHtCents, feeVatCents, feeTtcCents, netPayoutCents: totalTtcCents - feeTtcCents }
}

export function channelLabel(channel: Channel): string {
  return channel === 'MALT' ? 'Malt' : 'Direct'
}

export type VatRegime = 'FRANCHISE' | 'REEL'

export interface LegalContext {
  vatRegime: VatRegime
  latePenaltyRateText: string
  recoveryFeeCents: number
  isB2B: boolean
}

/** Mentions de bas de facture (Code de commerce L441-9, CGI 242 nonies A, art. 293 B en franchise). */
export function legalMentions(ctx: LegalContext): string[] {
  const mentions: string[] = []
  if (ctx.vatRegime === 'FRANCHISE') mentions.push('TVA non applicable, art. 293 B du CGI.')
  mentions.push('Catégorie de l’opération : prestation de services.')
  mentions.push('Pas d’escompte pour paiement anticipé.')
  mentions.push(`En cas de retard de paiement : ${ctx.latePenaltyRateText}`)
  if (ctx.isB2B) {
    const euros = (ctx.recoveryFeeCents / 100).toLocaleString('fr-FR')
    mentions.push(`Indemnité forfaitaire pour frais de recouvrement due au créancier en cas de retard : ${euros} € (art. L441-10 du Code de commerce).`)
  }
  return mentions
}
