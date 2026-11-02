// Schéma SQLite d'Atelier Mission (Drizzle ORM).
// Règles : montants en CENTIMES entiers (*Cents), quantités en millièmes (*Milli : 2,5 jours = 2500),
// taux en points de base (*Bps : 20 % = 2000), durées en minutes, dates « AAAA-MM-JJ », horodatages ISO 8601.
// Toute évolution = `npm run db:generate` (nouvelle migration dans drizzle/), jamais de modification à la main d'une migration.
import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const timestamps = {
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
}

export const CHANNELS = ['MALT', 'DIRECT'] as const
export type Channel = (typeof CHANNELS)[number]

export const SOURCES = ['MALT', 'DIRECT', 'REFERRAL', 'NETWORK', 'OTHER'] as const
export type Source = (typeof SOURCES)[number]

export const STAGES = ['NEW', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'] as const
export type Stage = (typeof STAGES)[number]

export const QUOTE_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED'] as const
export type QuoteStatus = (typeof QUOTE_STATUSES)[number]

export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export const INVOICE_KINDS = ['INVOICE', 'CREDIT_NOTE'] as const
export type InvoiceKind = (typeof INVOICE_KINDS)[number]

export const UNITS = ['DAY', 'HOUR', 'UNIT', 'FLAT'] as const
export type Unit = (typeof UNITS)[number]

export const PAYMENT_METHODS = ['TRANSFER', 'MALT', 'CHEQUE', 'CARD', 'OTHER'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const SYNC_STATUSES = ['PENDING', 'SYNCED', 'FAILED', 'SKIPPED'] as const
export type SyncStatus = (typeof SYNC_STATUSES)[number]

export const REMINDER_STATUSES = ['PLANNED', 'SENT', 'FAILED', 'CANCELLED'] as const
export type ReminderStatus = (typeof REMINDER_STATUSES)[number]

export const clients = sqliteTable('clients', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  siren: text('siren'),
  vatNumber: text('vat_number'),
  email: text('email'),
  contactName: text('contact_name'),
  phone: text('phone'),
  address: text('address'),
  channel: text('channel', { enum: CHANNELS }).notNull().default('DIRECT'),
  /** Frais de service Malt propres à ce client (null = réglage par défaut). */
  maltFeeBps: integer('malt_fee_bps'),
  paymentTermsDays: integer('payment_terms_days'),
  notes: text('notes').notNull().default(''),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  ...timestamps,
})

export const opportunities = sqliteTable(
  'opportunities',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    stage: text('stage', { enum: STAGES }).notNull().default('NEW'),
    source: text('source', { enum: SOURCES }).notNull().default('MALT'),
    maltUrl: text('malt_url'),
    amountCents: integer('amount_cents').notNull().default(0),
    dailyRateCents: integer('daily_rate_cents'),
    daysMilli: integer('days_milli'),
    probability: integer('probability').notNull().default(10),
    expectedCloseDate: text('expected_close_date'),
    nextAction: text('next_action').notNull().default(''),
    nextActionDate: text('next_action_date'),
    lostReason: text('lost_reason'),
    /** Projet lié dans Atelier Projets (temps passé → facture). */
    projetsProjectId: integer('projets_project_id'),
    notes: text('notes').notNull().default(''),
    position: integer('position').notNull().default(0),
    stageChangedAt: text('stage_changed_at'),
    closedAt: text('closed_at'),
    ...timestamps,
  },
  (t) => [index('opportunities_stage_idx').on(t.stage), index('opportunities_client_idx').on(t.clientId)],
)

export const quotes = sqliteTable('quotes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  number: text('number').notNull().unique(),
  clientId: integer('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'restrict' }),
  opportunityId: integer('opportunity_id').references(() => opportunities.id, { onDelete: 'set null' }),
  channel: text('channel', { enum: CHANNELS }).notNull().default('DIRECT'),
  status: text('status', { enum: QUOTE_STATUSES }).notNull().default('DRAFT'),
  title: text('title').notNull(),
  issueDate: text('issue_date').notNull(),
  validUntil: text('valid_until').notNull(),
  notes: text('notes').notNull().default(''),
  totalHtCents: integer('total_ht_cents').notNull().default(0),
  totalVatCents: integer('total_vat_cents').notNull().default(0),
  totalTtcCents: integer('total_ttc_cents').notNull().default(0),
  sentAt: text('sent_at'),
  decidedAt: text('decided_at'),
  ...timestamps,
})

export const quoteLines = sqliteTable('quote_lines', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  quoteId: integer('quote_id')
    .notNull()
    .references(() => quotes.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(0),
  label: text('label').notNull(),
  details: text('details').notNull().default(''),
  unit: text('unit', { enum: UNITS }).notNull().default('DAY'),
  quantityMilli: integer('quantity_milli').notNull(),
  unitPriceCents: integer('unit_price_cents').notNull(),
  vatRateBps: integer('vat_rate_bps').notNull().default(0),
})

export const invoices = sqliteTable(
  'invoices',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Numéro légal, chronologique et sans trou : attribué à l'émission, factures directes uniquement. */
    number: text('number').unique(),
    /** Numéro de la facture émise par Malt (mandat de facturation) pour une mission Malt. */
    externalRef: text('external_ref'),
    kind: text('kind', { enum: INVOICE_KINDS }).notNull().default('INVOICE'),
    /** Avoir : facture qu'il annule. */
    creditedInvoiceId: integer('credited_invoice_id'),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    opportunityId: integer('opportunity_id').references(() => opportunities.id, { onDelete: 'set null' }),
    quoteId: integer('quote_id').references(() => quotes.id, { onDelete: 'set null' }),
    channel: text('channel', { enum: CHANNELS }).notNull().default('DIRECT'),
    status: text('status', { enum: INVOICE_STATUSES }).notNull().default('DRAFT'),
    title: text('title').notNull(),
    issueDate: text('issue_date'),
    serviceStart: text('service_start'),
    serviceEnd: text('service_end'),
    dueDate: text('due_date'),
    paymentTermsDays: integer('payment_terms_days').notNull().default(30),
    /** Frais Malt figés à la création (points de base, HT). */
    maltFeeBps: integer('malt_fee_bps').notNull().default(0),
    notes: text('notes').notNull().default(''),
    totalHtCents: integer('total_ht_cents').notNull().default(0),
    totalVatCents: integer('total_vat_cents').notNull().default(0),
    totalTtcCents: integer('total_ttc_cents').notNull().default(0),
    paidCents: integer('paid_cents').notNull().default(0),
    /** Coordonnées du client et du vendeur figées à l'émission (JSON) : une facture émise ne change plus. */
    clientSnapshot: text('client_snapshot'),
    sellerSnapshot: text('seller_snapshot'),
    remindersEnabled: integer('reminders_enabled', { mode: 'boolean' }).notNull().default(true),
    issuedAt: text('issued_at'),
    paidAt: text('paid_at'),
    cancelledAt: text('cancelled_at'),
    ...timestamps,
  },
  (t) => [index('invoices_status_idx').on(t.status), index('invoices_client_idx').on(t.clientId)],
)

export const invoiceLines = sqliteTable('invoice_lines', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  invoiceId: integer('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(0),
  label: text('label').notNull(),
  details: text('details').notNull().default(''),
  unit: text('unit', { enum: UNITS }).notNull().default('DAY'),
  quantityMilli: integer('quantity_milli').notNull(),
  unitPriceCents: integer('unit_price_cents').notNull(),
  vatRateBps: integer('vat_rate_bps').notNull().default(0),
})

/** Saisies de temps importées d'Atelier Projets. Une saisie liée à une ligne de facture n'est plus refacturable. */
export const timeEntries = sqliteTable(
  'time_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projetsEntryId: integer('projets_entry_id').notNull(),
    projetsProjectId: integer('projets_project_id').notNull(),
    projetsProjectName: text('projets_project_name').notNull(),
    workItemId: integer('work_item_id').notNull(),
    workItemTitle: text('work_item_title').notNull(),
    workItemType: text('work_item_type').notNull().default('TASK'),
    spentOn: text('spent_on').notNull(),
    minutes: integer('minutes').notNull(),
    comment: text('comment').notNull().default(''),
    invoiceLineId: integer('invoice_line_id').references(() => invoiceLines.id, { onDelete: 'set null' }),
    /** Modifiée ou supprimée dans Projets après avoir été facturée : à vérifier. */
    changedAfterBilling: integer('changed_after_billing', { mode: 'boolean' }).notNull().default(false),
    removedInProjets: integer('removed_in_projets', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('time_entries_projets_idx').on(t.projetsEntryId),
    index('time_entries_project_idx').on(t.projetsProjectId),
    index('time_entries_line_idx').on(t.invoiceLineId),
  ],
)

export const payments = sqliteTable('payments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  invoiceId: integer('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  amountCents: integer('amount_cents').notNull(),
  receivedOn: text('received_on').notNull(),
  method: text('method', { enum: PAYMENT_METHODS }).notNull().default('TRANSFER'),
  note: text('note').notNull().default(''),
  tresorerieStatus: text('tresorerie_status', { enum: SYNC_STATUSES }).notNull().default('PENDING'),
  /** Identifiants des opérations créées dans Atelier Trésorerie (JSON : number[]). */
  tresorerieTransactionIds: text('tresorerie_transaction_ids').notNull().default('[]'),
  tresorerieError: text('tresorerie_error'),
  syncedAt: text('synced_at'),
  ...timestamps,
})

export const reminders = sqliteTable(
  'reminders',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    invoiceId: integer('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    level: integer('level').notNull(),
    dueOn: text('due_on').notNull(),
    status: text('status', { enum: REMINDER_STATUSES }).notNull().default('PLANNED'),
    toEmail: text('to_email'),
    subject: text('subject'),
    brevoMessageId: text('brevo_message_id'),
    error: text('error'),
    sentAt: text('sent_at'),
    ...timestamps,
  },
  (t) => [index('reminders_due_idx').on(t.status, t.dueOn), uniqueIndex('reminders_invoice_level_idx').on(t.invoiceId, t.level)],
)

/** Fil d'activité (fiche client, fiche facture…). */
export const activities = sqliteTable(
  'activities',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    clientId: integer('client_id').references(() => clients.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: integer('entity_id').notNull(),
    type: text('type').notNull(),
    message: text('message').notNull(),
    at: text('at').notNull(),
  },
  (t) => [index('activities_client_idx').on(t.clientId), index('activities_entity_idx').on(t.entityType, t.entityId)],
)

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

/** Compteurs de numérotation (« invoice:2026 » → 12) : incrémentés dans la transaction d'émission. */
export const counters = sqliteTable('counters', {
  name: text('name').primaryKey(),
  value: integer('value').notNull().default(0),
})

/** Journal d'événements du contrat atelier-node/1 (Suite Atelier §7.3). */
export const events = sqliteTable('events', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  at: text('at').notNull(),
  subjectKind: text('subject_kind').notNull(),
  subjectId: text('subject_id').notNull(),
  subjectLabel: text('subject_label').notNull().default(''),
  data: text('data').notNull().default('{}'),
})

/** Réponses mémorisées des écritures appelées avec Idempotency-Key (Suite Atelier §7.4). */
export const idempotencyRecords = sqliteTable(
  'idempotency_records',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    key: text('key').notNull(),
    scope: text('scope').notNull(),
    bodyHash: text('body_hash').notNull(),
    statusCode: integer('status_code').notNull(),
    response: text('response').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('idempotency_key_idx').on(t.key)],
)
