// Réglages de l'application, stockés par groupe (JSON) dans la table settings, fusionnés avec les valeurs par défaut.
// Le mode « En ligne » (seul chemin vers Brevo) est hors ligne par défaut et ne se change que depuis l'interface locale.
import { eq } from 'drizzle-orm'
import type { DbOrTx } from '../db/client.ts'
import { settings } from '../db/schema.ts'
import type { VatRegime } from '../domain/invoicing.ts'

export interface CompanySettings {
  /** Nom commercial / dénomination (avec « EI » pour un entrepreneur individuel). */
  name: string
  legalForm: string
  siren: string
  siret: string
  vatNumber: string
  address: string
  email: string
  phone: string
  iban: string
  bic: string
  vatRegime: VatRegime
}

export interface BillingSettings {
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

export interface MaltSettings {
  /** Frais de service freelance par défaut (HT, points de base). À vérifier sur help.malt.com. */
  feeBps: number
  feeVatBps: number
}

export interface ReminderSettings {
  /** Jours après l'échéance : un niveau de relance par valeur (3 au plus). */
  offsetsDays: number[]
  /** Envoi automatique par le planificateur (sinon : bouton « Envoyer » dans l'écran Relances). */
  autoSend: boolean
  /** Copie cachée de chaque relance à l'adresse de l'entreprise. */
  bccSelf: boolean
}

export interface IntegrationSettings {
  projetsUrl: string
  tresorerieUrl: string
  tresorerieAccountId: number | null
  tresorerieRevenueCategoryId: number | null
  tresorerieFeeCategoryId: number | null
  /** Encaissement enregistré → opération créée tout de suite dans Trésorerie. */
  tresorerieAutoSync: boolean
  brevoSenderEmail: string
  brevoSenderName: string
}

export interface AppSettings {
  company: CompanySettings
  billing: BillingSettings
  malt: MaltSettings
  reminders: ReminderSettings
  integrations: IntegrationSettings
  onlineMode: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  company: {
    name: '',
    legalForm: 'EI',
    siren: '',
    siret: '',
    vatNumber: '',
    address: '',
    email: '',
    phone: '',
    iban: '',
    bic: '',
    vatRegime: 'FRANCHISE',
  },
  billing: {
    defaultVatRateBps: 0,
    paymentTermsDays: 30,
    quoteValidityDays: 30,
    hoursPerDay: 7,
    defaultDailyRateCents: 50_000,
    latePenaltyRateText: 'pénalités au taux de trois fois le taux d’intérêt légal, exigibles dès le lendemain de l’échéance',
    recoveryFeeCents: 4_000,
    invoicePrefix: 'F',
    creditNotePrefix: 'A',
    quotePrefix: 'D',
    footer: '',
  },
  malt: { feeBps: 1_000, feeVatBps: 2_000 },
  reminders: { offsetsDays: [3, 15, 30], autoSend: false, bccSelf: true },
  integrations: {
    projetsUrl: 'http://127.0.0.1:3000',
    tresorerieUrl: 'http://127.0.0.1:5050',
    tresorerieAccountId: null,
    tresorerieRevenueCategoryId: null,
    tresorerieFeeCategoryId: null,
    tresorerieAutoSync: true,
    brevoSenderEmail: '',
    brevoSenderName: '',
  },
  onlineMode: false,
}

type Group = keyof AppSettings
const GROUPS = Object.keys(DEFAULT_SETTINGS) as Group[]

export type SettingsPatch = { [K in Group]?: AppSettings[K] extends object ? Partial<AppSettings[K]> : AppSettings[K] }

function parse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

export function getSettings(db: DbOrTx): AppSettings {
  const rows = db.select().from(settings).all()
  const stored = new Map(rows.map((row) => [row.key, parse(row.value)]))
  const result = structuredClone(DEFAULT_SETTINGS) as unknown as Record<Group, unknown>
  for (const group of GROUPS) {
    const value = stored.get(group)
    const fallback = DEFAULT_SETTINGS[group]
    if (value === undefined) continue
    if (typeof fallback === 'object' && fallback !== null && typeof value === 'object' && value !== null) {
      result[group] = { ...fallback, ...(value as object) }
    } else if (typeof value === typeof fallback) {
      result[group] = value
    }
  }
  return result as unknown as AppSettings
}

/** Applique un correctif partiel ; `onlineMode` n'est accepté que si `allowOnlineMode` (route locale dédiée). */
export function updateSettings(db: DbOrTx, patch: SettingsPatch, options: { allowOnlineMode?: boolean } = {}): AppSettings {
  const current = getSettings(db)
  for (const group of GROUPS) {
    const value = patch[group]
    if (value === undefined) continue
    if (group === 'onlineMode' && !options.allowOnlineMode) continue
    const next = typeof value === 'object' && value !== null ? { ...(current[group] as object), ...(value as object) } : value
    db.insert(settings)
      .values({ key: group, value: JSON.stringify(next) })
      .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(next) } })
      .run()
  }
  return getSettings(db)
}

export function setOnlineMode(db: DbOrTx, online: boolean): AppSettings {
  return updateSettings(db, { onlineMode: online }, { allowOnlineMode: true })
}

/** Identité du vendeur figée sur une facture émise. */
export function sellerSnapshot(company: CompanySettings): CompanySettings {
  return { ...company }
}

export function readSettingValue(db: DbOrTx, key: string): string | undefined {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value
}
