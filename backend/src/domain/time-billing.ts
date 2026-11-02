// Du temps passé (saisies d'Atelier Projets) aux lignes de facture.
import type { Unit } from '../db/schema.ts'

export type TimeUnit = Extract<Unit, 'DAY' | 'HOUR'>
export type TimeGrouping = 'WORK_ITEM' | 'PROJECT' | 'ENTRY'

export interface BillableEntry {
  id: number
  projetsProjectName: string
  workItemId: number
  workItemTitle: string
  workItemType: string
  spentOn: string
  minutes: number
  comment: string
}

export interface TimeBillingOptions {
  unit: TimeUnit
  /** Heures facturées par jour (unité DAY). */
  hoursPerDay: number
  /** Prix unitaire : TJM (DAY) ou taux horaire (HOUR), centimes HT. */
  rateCents: number
  vatRateBps: number
  grouping: TimeGrouping
}

export interface DraftLine {
  label: string
  details: string
  unit: Unit
  quantityMilli: number
  unitPriceCents: number
  vatRateBps: number
  entryIds: number[]
}

/** Minutes → quantité en millièmes de jour ou d'heure. */
export function minutesToQuantityMilli(minutes: number, unit: TimeUnit, hoursPerDay: number): number {
  const minutesPerUnit = unit === 'DAY' ? hoursPerDay * 60 : 60
  return Math.round((minutes * 1000) / minutesPerUnit)
}

function period(entries: readonly BillableEntry[]): string {
  const days = entries.map((e) => e.spentOn).sort()
  const first = days[0] ?? ''
  const last = days[days.length - 1] ?? ''
  const fr = (d: string) => d.split('-').reverse().join('/')
  return first === last ? `le ${fr(first)}` : `du ${fr(first)} au ${fr(last)}`
}

function hoursText(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`
}

/** Regroupe les saisies en lignes de facture (ordre stable : premier jour travaillé, puis titre). */
export function buildTimeLines(entries: readonly BillableEntry[], options: TimeBillingOptions): DraftLine[] {
  if (!Number.isFinite(options.hoursPerDay) || options.hoursPerDay <= 0) throw new RangeError('hoursPerDay doit être positif')
  const groups = new Map<string, BillableEntry[]>()
  for (const entry of entries) {
    const key =
      options.grouping === 'ENTRY' ? `e${entry.id}` : options.grouping === 'PROJECT' ? `p${entry.projetsProjectName}` : `w${entry.workItemId}`
    const list = groups.get(key) ?? []
    list.push(entry)
    groups.set(key, list)
  }
  const lines = [...groups.values()].map((group): DraftLine & { sortKey: string } => {
    const first = group[0]!
    const minutes = group.reduce((sum, e) => sum + e.minutes, 0)
    const label =
      options.grouping === 'PROJECT'
        ? `${first.projetsProjectName} — prestations`
        : options.grouping === 'ENTRY'
          ? `#${first.workItemId} ${first.workItemTitle}${first.comment ? ` — ${first.comment}` : ''}`
          : `#${first.workItemId} ${first.workItemTitle}`
    return {
      label,
      details: `${hoursText(minutes)} ${period(group)}`,
      unit: options.unit,
      quantityMilli: minutesToQuantityMilli(minutes, options.unit, options.hoursPerDay),
      unitPriceCents: options.rateCents,
      vatRateBps: options.vatRateBps,
      entryIds: group.map((e) => e.id).sort((a, b) => a - b),
      sortKey: `${group.map((e) => e.spentOn).sort()[0]}|${label}`,
    }
  })
  return lines.sort((a, b) => a.sortKey.localeCompare(b.sortKey)).map(({ sortKey: _sortKey, ...line }) => line)
}

/** Heures décimales de Projets (1,25) → minutes entières. */
export function hoursToMinutes(hours: number): number {
  return Math.round(hours * 60)
}
