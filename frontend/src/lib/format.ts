// Formats français : montants (centimes → « 1 234,56 € »), dates, durées. Aucune règle métier ici.

const EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
const EUR_ROUND = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const NUM = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 })

export const euros = (cents: number) => EUR.format(cents / 100)
export const eurosRound = (cents: number) => EUR_ROUND.format(cents / 100)
export const num = (value: number) => NUM.format(value)

/** « 1 234,5 » ou « 1234.50 » → centimes ; null si illisible. */
export function parseEuros(value: string): number | null {
  const cleaned = value.replace(/[\s  €]/g, '').replace(',', '.')
  if (cleaned === '' || !/^-?\d*(\.\d{0,2})?$/.test(cleaned)) return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null
}

export function parseNumber(value: string): number | null {
  const cleaned = value.replace(/[\s  ]/g, '').replace(',', '.')
  if (cleaned === '') return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

export const centsToInput = (cents: number | null | undefined) => (cents === null || cents === undefined ? '' : String(cents / 100).replace('.', ','))

const DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const DATE_SHORT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' })

export const date = (iso: string | null | undefined) => (iso ? DATE.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : '—')
export const dateShort = (iso: string | null | undefined) => (iso ? DATE_SHORT.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : '—')
export const monthLabel = (yyyyMm: string) => MONTH.format(new Date(`${yyyyMm}-01T00:00:00Z`)).replace('.', '')

export function hours(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`
}

export function todayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function relativeDays(iso: string, today = todayIso()): string {
  const diff = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
  if (diff === 0) return 'aujourd’hui'
  if (diff === 1) return 'demain'
  if (diff === -1) return 'hier'
  return diff > 0 ? `dans ${diff} j` : `il y a ${-diff} j`
}
