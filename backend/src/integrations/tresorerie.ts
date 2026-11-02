// Client d'Atelier Trésorerie (Flask, http://127.0.0.1:5050). Écritures : en-tête X-Requested-With obligatoire (anti-CSRF).
// Trésorerie n'a pas d'Idempotency-Key : chaque opération porte un marqueur « [mission:…] » dans ses notes,
// recherché avant toute création — un nouvel essai ne crée jamais de doublon.
import { assertLoopbackUrl, requestJson, type FetchLike } from './http.ts'

export interface TresorerieAccount {
  id: number
  name: string
  type: string
  archived: boolean
}

export interface TresorerieCategory {
  id: number
  name: string
  kind: 'depense' | 'revenu' | 'transfert'
}

export interface TresorerieTransactionInput {
  account_id: number
  date: string
  label: string
  amount_cents: number
  category_id: number | null
  notes: string
}

export interface TresorerieClient {
  baseUrl: string
  ping(): Promise<boolean>
  listAccounts(): Promise<TresorerieAccount[]>
  listCategories(): Promise<TresorerieCategory[]>
  /** Opération portant ce marqueur dans ses notes, si elle existe déjà. */
  findByMarker(marker: string): Promise<number | null>
  createTransaction(input: TresorerieTransactionInput): Promise<number>
}

const APP = 'Atelier Trésorerie'
const HEADERS = { 'X-Requested-With': 'AtelierMission' }

/** Trésorerie lit `amount` en euros (« 1925.00 ») : un entier serait compris comme des euros, pas des centimes. */
export function centsToAmount(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** Les listes de Trésorerie sont enveloppées : { items: [...] } (un tableau nu est aussi accepté). */
function items<T>(payload: T[] | { items: T[] }): T[] {
  return Array.isArray(payload) ? payload : (payload?.items ?? [])
}

export function createTresorerieClient(baseUrl: string, fetchImpl: FetchLike = fetch): TresorerieClient {
  const base = assertLoopbackUrl(baseUrl, APP).toString().replace(/\/$/, '')
  return {
    baseUrl: base,
    async ping() {
      try {
        await requestJson(fetchImpl, `${base}/api/ping`, APP, 'TRESORERIE_UNAVAILABLE', { timeoutMs: 1500 })
        return true
      } catch {
        return false
      }
    },
    async listAccounts() {
      const accounts = items(await requestJson<TresorerieAccount[] | { items: TresorerieAccount[] }>(fetchImpl, `${base}/api/accounts`, APP, 'TRESORERIE_UNAVAILABLE'))
      return accounts.map(({ id, name, type, archived }) => ({ id, name, type, archived: Boolean(archived) }))
    },
    async listCategories() {
      const categories = items(await requestJson<TresorerieCategory[] | { items: TresorerieCategory[] }>(fetchImpl, `${base}/api/categories`, APP, 'TRESORERIE_UNAVAILABLE'))
      return categories.map(({ id, name, kind }) => ({ id, name, kind }))
    },
    async findByMarker(marker) {
      const page = await requestJson<{ items: { id: number; notes: string | null }[] }>(
        fetchImpl,
        `${base}/api/transactions?q=${encodeURIComponent(marker)}&per_page=5`,
        APP,
        'TRESORERIE_UNAVAILABLE',
      )
      return page.items.find((item) => (item.notes ?? '').includes(marker))?.id ?? null
    },
    async createTransaction(input) {
      const created = await requestJson<{ id: number }>(fetchImpl, `${base}/api/transactions`, APP, 'TRESORERIE_UNAVAILABLE', {
        method: 'POST',
        headers: HEADERS,
        body: {
          account_id: input.account_id,
          date: input.date,
          label: input.label,
          amount: centsToAmount(input.amount_cents),
          ...(input.category_id !== null ? { category_id: input.category_id } : {}),
          notes: input.notes,
          status: 'valide',
        },
      })
      return created.id
    },
  }
}
