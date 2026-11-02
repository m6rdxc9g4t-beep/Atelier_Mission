import type { Channel, InvoiceStatus, PaymentMethod, QuoteStatus, Source, Stage, SyncStatus, Unit } from './types.ts'

export const STAGES: Stage[] = ['NEW', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST']
export const STAGE_LABEL: Record<Stage, string> = { NEW: 'Nouveau', QUALIFIED: 'Qualifié', PROPOSAL: 'Devis envoyé', NEGOTIATION: 'Négociation', WON: 'Gagné', LOST: 'Perdu' }
export const SOURCE_LABEL: Record<Source, string> = { MALT: 'Malt', DIRECT: 'Direct', REFERRAL: 'Recommandation', NETWORK: 'Réseau', OTHER: 'Autre' }
export const CHANNEL_LABEL: Record<Channel, string> = { MALT: 'Malt', DIRECT: 'Direct' }
export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = { DRAFT: 'Brouillon', SENT: 'Envoyé', ACCEPTED: 'Accepté', DECLINED: 'Refusé', EXPIRED: 'Expiré' }
export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: 'Brouillon',
  ISSUED: 'Émise',
  PARTIALLY_PAID: 'Payée en partie',
  PAID: 'Payée',
  OVERDUE: 'En retard',
  CANCELLED: 'Annulée',
}
export const UNIT_LABEL: Record<Unit, string> = { DAY: 'jour', HOUR: 'heure', UNIT: 'unité', FLAT: 'forfait' }
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = { TRANSFER: 'Virement', MALT: 'Versement Malt', CHEQUE: 'Chèque', CARD: 'Carte', OTHER: 'Autre' }
export const SYNC_LABEL: Record<SyncStatus, string> = { PENDING: 'À envoyer', SYNCED: 'Dans Trésorerie', FAILED: 'Échec', SKIPPED: 'Ignoré' }
export const SYNC_TONE: Record<SyncStatus, string> = { PENDING: 'PLANNED', SYNCED: 'SENT', FAILED: 'FAILED', SKIPPED: 'CANCELLED' }
export const VAT_RATES = [0, 550, 1000, 2000]
