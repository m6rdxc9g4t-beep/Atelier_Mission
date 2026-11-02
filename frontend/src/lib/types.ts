// Formes des réponses de l'API (backend/src/services). Montants en centimes, dates « AAAA-MM-JJ ».
export type Channel = 'MALT' | 'DIRECT'
export type Source = 'MALT' | 'DIRECT' | 'REFERRAL' | 'NETWORK' | 'OTHER'
export type Stage = 'NEW' | 'QUALIFIED' | 'PROPOSAL' | 'NEGOTIATION' | 'WON' | 'LOST'
export type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED'
export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED'
export type Unit = 'DAY' | 'HOUR' | 'UNIT' | 'FLAT'
export type PaymentMethod = 'TRANSFER' | 'MALT' | 'CHEQUE' | 'CARD' | 'OTHER'
export type SyncStatus = 'PENDING' | 'SYNCED' | 'FAILED' | 'SKIPPED'

export interface Client {
  id: number
  name: string
  siren: string | null
  vatNumber: string | null
  email: string | null
  contactName: string | null
  phone: string | null
  address: string | null
  channel: Channel
  maltFeeBps: number | null
  paymentTermsDays: number | null
  notes: string
  archived: boolean
  openOpportunities?: number
  billedTtcCents?: number
  outstandingCents?: number
  overdueCount?: number
}

export interface Activity {
  id: number
  type: string
  message: string
  at: string
  entityType: string
  entityId: number
}

export interface Opportunity {
  id: number
  clientId: number
  clientName?: string
  clientChannel?: Channel
  title: string
  stage: Stage
  source: Source
  maltUrl: string | null
  amountCents: number
  dailyRateCents: number | null
  days: number | null
  probability: number
  weightedCents: number
  expectedCloseDate: string | null
  nextAction: string
  nextActionDate: string | null
  lostReason: string | null
  projetsProjectId: number | null
  notes: string
  position: number
  stageChangedAt: string | null
}

export interface ClientDetail extends Client {
  opportunities: Opportunity[]
  quotes: { id: number; number: string; title: string; status: QuoteStatus; issueDate: string; totalHtCents: number }[]
  invoices: InvoiceSummary[]
  activities: Activity[]
}

export interface Line {
  id?: number
  label: string
  details: string
  unit: Unit
  quantity: number
  unitPriceCents: number
  vatRateBps: number
  totalHtCents?: number
  timeEntryCount?: number
}

export interface VatBucket {
  rateBps: number
  baseCents: number
  vatCents: number
}

export interface QuoteSummary {
  id: number
  number: string
  clientId: number
  clientName: string
  opportunityId: number | null
  channel: Channel
  status: QuoteStatus
  title: string
  issueDate: string
  validUntil: string
  totalHtCents: number
  totalTtcCents: number
}

export interface Quote extends QuoteSummary {
  notes: string
  totalVatCents: number
  lines: Line[]
  vatByRate: VatBucket[]
  client: { id: number; name: string; email: string | null; address: string | null }
}

export interface InvoiceSummary {
  id: number
  number: string | null
  displayNumber?: string
  externalRef: string | null
  kind: 'INVOICE' | 'CREDIT_NOTE'
  clientId?: number
  clientName?: string
  channel: Channel
  title: string
  status: InvoiceStatus
  rawStatus?: InvoiceStatus
  issueDate: string | null
  dueDate: string | null
  totalHtCents?: number
  totalTtcCents: number
  paidCents: number
  balanceCents?: number
  opportunityId?: number | null
}

export interface Payment {
  id: number
  amountCents: number
  receivedOn: string
  method: PaymentMethod
  note: string
  tresorerieStatus: SyncStatus
  tresorerieTransactionIds: number[]
  tresorerieError: string | null
}

export interface Reminder {
  id: number
  invoiceId: number
  level: number
  dueOn: string
  status: 'PLANNED' | 'SENT' | 'FAILED' | 'CANCELLED'
  toEmail: string | null
  subject: string | null
  error: string | null
  sentAt: string | null
}

export interface Invoice extends Omit<InvoiceSummary, 'displayNumber' | 'clientName' | 'balanceCents' | 'rawStatus' | 'totalHtCents'> {
  displayNumber: string
  clientName: string
  balanceCents: number
  rawStatus: InvoiceStatus
  totalHtCents: number
  serviceStart: string | null
  serviceEnd: string | null
  paymentTermsDays: number
  notes: string
  quoteId: number | null
  creditedInvoiceId: number | null
  remindersEnabled: boolean
  maltFeeBps: number
  totalVatCents: number
  client: { id: number; name: string; address: string | null; email: string | null; contactName: string | null; currentEmail: string | null }
  lines: Line[]
  vatByRate: VatBucket[]
  malt: { feeBps: number; feeHtCents: number; feeVatCents: number; feeTtcCents: number; netPayoutCents: number } | null
  payments: Payment[]
  reminders: Reminder[]
  time: { entries: number; minutes: number; flagged: number; projectIds: number[] }
  legalMentions: string[]
  activities: Activity[]
}

export interface TimeEntry {
  id: number
  projetsEntryId: number
  projetsProjectId: number
  projetsProjectName: string
  workItemId: number
  workItemTitle: string
  spentOn: string
  minutes: number
  comment: string
  invoiceLineId: number | null
  changedAfterBilling: boolean
  removedInProjets: boolean
}

export interface ProjectSummary {
  id: number
  name: string
  unbilledMinutes: number
  unbilledEntries: number
  billedMinutes: number
  flagged: number
  firstUnbilled: string | null
  lastUnbilled: string | null
}

export interface ReminderItem extends Reminder {
  state: 'DUE' | 'PLANNED' | 'SENT' | 'FAILED' | 'CANCELLED'
  levelLabel: string
  invoice: { id: number; number: string | null; title: string; dueDate: string | null; balanceCents: number; status: string }
  clientName: string
  clientEmail: string | null
  daysLate: number
}

export interface Settings {
  company: { name: string; legalForm: string; siren: string; siret: string; vatNumber: string; address: string; email: string; phone: string; iban: string; bic: string; vatRegime: 'FRANCHISE' | 'REEL' }
  billing: {
    defaultVatRateBps: number
    paymentTermsDays: number
    quoteValidityDays: number
    hoursPerDay: number
    defaultDailyRateCents: number
    latePenaltyRateText: string
    recoveryFeeCents: number
    invoicePrefix: string
    creditNotePrefix: string
    quotePrefix: string
    footer: string
  }
  malt: { feeBps: number; feeVatBps: number }
  reminders: { offsetsDays: number[]; autoSend: boolean; bccSelf: boolean }
  integrations: {
    projetsUrl: string
    tresorerieUrl: string
    tresorerieAccountId: number | null
    tresorerieRevenueCategoryId: number | null
    tresorerieFeeCategoryId: number | null
    tresorerieAutoSync: boolean
    brevoSenderEmail: string
    brevoSenderName: string
  }
  onlineMode: boolean
  brevoKeyConfigured: boolean
}

export interface Dashboard {
  today: string
  kpis: {
    collectedMonthCents: number
    collectedYearCents: number
    billedYearHtCents: number
    outstandingCents: number
    outstandingCount: number
    overdueCents: number
    overdueCount: number
    pipelineCents: number
    pipelineWeightedCents: number
    openOpportunities: number
    conversionRate: number | null
    unbilledMinutes: number
    unbilledEntries: number
    unbilledValueCents: number
    paymentsToSync: number
  }
  pipeline: { stage: Stage; label: string; count: number; amountCents: number }[]
  series: { month: string; collectedCents: number; billedHtCents: number }[]
  agenda: {
    nextActions: { id: number; title: string; clientName: string; stage: Stage; nextAction: string; nextActionDate: string | null; late: boolean }[]
    dueReminders: { id: number; level: number; levelLabel: string; invoiceId: number; invoiceNumber: string | null; clientName: string; balanceCents: number; daysLate: number; state: string }[]
    overdueInvoices: { id: number; number: string | null; clientName: string; channel: Channel; dueDate: string | null; balanceCents: number }[]
    expiringQuotes: { id: number; number: string; title: string; clientName: string; validUntil: string; totalHtCents: number }[]
  }
  onlineMode: boolean
}
