// Dates calendaires « AAAA-MM-JJ » (sans heure) et horodatages ISO. Le jour courant est celui du fuseau de l'utilisateur.

export const DEFAULT_TIME_ZONE = 'Europe/Paris'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** Jour calendaire de `now` dans le fuseau donné. */
export function localDate(now: Date, timeZone = DEFAULT_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Nombre de jours de `from` à `to` (positif si `to` est après). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** « 2026-11-03 » → « 3 novembre 2026 ». */
export function formatLongDate(isoDate: string): string {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${isoDate}T00:00:00Z`),
  )
}

/** « 2026-11-03 » → « 03/11/2026 ». */
export function formatShortDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-')
  return `${d}/${m}/${y}`
}

/** Mois « AAAA-MM » des `count` derniers mois, du plus ancien au courant. */
export function lastMonths(today: string, count: number): string[] {
  const [y, m] = today.split('-').map(Number) as [number, number]
  const months: string[] = []
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = new Date(Date.UTC(y, m - 1 - i, 1))
    months.push(date.toISOString().slice(0, 7))
  }
  return months
}
