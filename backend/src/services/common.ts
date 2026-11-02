// Outils communs des services : compteurs de numérotation, recherche par id, lignes de document.
import { eq, sql } from 'drizzle-orm'
import type { DbOrTx } from '../db/client.ts'
import { clients, counters, type Unit } from '../db/schema.ts'
import { lineTotalCents } from '../domain/money.ts'
import { notFound } from '../http/errors.ts'

/** Incrémente un compteur (« invoice:2026 ») dans la transaction en cours et renvoie la nouvelle valeur. */
export function nextSequence(db: DbOrTx, name: string): number {
  const row = db
    .insert(counters)
    .values({ name, value: 1 })
    .onConflictDoUpdate({ target: counters.name, set: { value: sql`${counters.value} + 1` } })
    .returning({ value: counters.value })
    .get()
  return row.value
}

export function requireClient(db: DbOrTx, clientId: number) {
  const client = db.select().from(clients).where(eq(clients.id, clientId)).get()
  if (!client) throw notFound(`Client ${clientId} introuvable`)
  return client
}

export interface LineInput {
  id?: number
  label: string
  details?: string
  unit: Unit
  quantity: number
  unitPriceCents: number
  vatRateBps: number
}

export interface LineRow {
  id: number
  position: number
  label: string
  details: string
  unit: Unit
  quantityMilli: number
  unitPriceCents: number
  vatRateBps: number
}

export function lineView(line: LineRow) {
  return {
    id: line.id,
    position: line.position,
    label: line.label,
    details: line.details,
    unit: line.unit,
    quantity: line.quantityMilli / 1000,
    unitPriceCents: line.unitPriceCents,
    vatRateBps: line.vatRateBps,
    totalHtCents: lineTotalCents(line.quantityMilli, line.unitPriceCents),
  }
}

/** Valeur d'une colonne optionnelle d'un correctif : undefined = inchangée, sinon la nouvelle valeur. */
export function pick<T extends object, K extends keyof T>(patch: T, keys: readonly K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {}
  for (const key of keys) if (patch[key] !== undefined) out[key] = patch[key]
  return out
}
