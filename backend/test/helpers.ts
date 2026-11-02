// Application de test : base SQLite en mémoire, horloge fixe, apps reliées simulées (aucun réseau).
import { buildApp } from '../src/app.ts'
import { openDatabase } from '../src/db/client.ts'
import type { BrevoClient, BrevoEmail } from '../src/integrations/brevo.ts'
import { UpstreamError } from '../src/integrations/http.ts'
import type { ProjetsClient, ProjetsTimeRow } from '../src/integrations/projets.ts'
import type { TresorerieClient, TresorerieTransactionInput } from '../src/integrations/tresorerie.ts'

export interface Fakes {
  projetsRows: ProjetsTimeRow[]
  tresorerie: { created: (TresorerieTransactionInput & { id: number })[]; down: boolean }
  brevo: { sent: BrevoEmail[]; fail: boolean }
  clock: { now: Date }
}

export async function testApp(options: { brevo?: boolean; start?: string } = {}) {
  const { db, close } = openDatabase(':memory:')
  const fakes: Fakes = {
    projetsRows: [],
    tresorerie: { created: [], down: false },
    brevo: { sent: [], fail: false },
    clock: { now: new Date(`${options.start ?? '2026-11-03'}T09:00:00Z`) },
  }
  const projets = (baseUrl: string): ProjetsClient => ({
    baseUrl,
    ping: async () => true,
    listProjects: async () => [{ id: 1, name: 'Portail transporteurs' }],
    timeEntries: async () => ({ rows: fakes.projetsRows, truncated: false }),
  })
  const tresorerie = (baseUrl: string): TresorerieClient => ({
    baseUrl,
    ping: async () => !fakes.tresorerie.down,
    listAccounts: async () => [{ id: 3, name: 'Compte pro', type: 'courant', archived: false }],
    listCategories: async () => [
      { id: 7, name: 'Missions', kind: 'revenu' },
      { id: 8, name: 'Frais Malt', kind: 'depense' },
    ],
    findByMarker: async (marker) => {
      if (fakes.tresorerie.down) throw new UpstreamError('TRESORERIE_UNAVAILABLE', 'Atelier Trésorerie injoignable')
      return fakes.tresorerie.created.find((t) => t.notes.includes(marker))?.id ?? null
    },
    createTransaction: async (input) => {
      if (fakes.tresorerie.down) throw new UpstreamError('TRESORERIE_UNAVAILABLE', 'Atelier Trésorerie injoignable')
      const id = 100 + fakes.tresorerie.created.length
      fakes.tresorerie.created.push({ ...input, id })
      return id
    },
  })
  const brevo: BrevoClient = {
    sendEmail: async (email) => {
      if (fakes.brevo.fail) throw new UpstreamError('BREVO_ERROR', 'Brevo a refusé la requête (HTTP 401)')
      fakes.brevo.sent.push(email)
      return { messageId: `<msg-${fakes.brevo.sent.length}@brevo>` }
    },
    account: async () => ({ email: 'moi@example.com', companyName: null }),
  }
  const app = await buildApp({
    db,
    now: () => fakes.clock.now,
    integrations: { projets, tresorerie, brevo: options.brevo === false ? null : brevo },
  })
  const api = async <T = any>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await app.inject({ method: method as 'GET', url, payload: body as object, headers: { host: '127.0.0.1:3001', ...headers } })
    return { status: response.statusCode, body: (response.body ? JSON.parse(response.body) : null) as T, headers: response.headers }
  }
  const setToday = (iso: string) => {
    fakes.clock.now = new Date(`${iso}T09:00:00Z`)
  }
  return { app, db, api, fakes, setToday, close: async () => { await app.close(); close() } }
}

export const COMPANY = {
  company: { name: 'Camille Martin EI', siren: '912345678', address: '12 rue des Artisans\n69002 Lyon', email: 'camille@example.com', iban: 'FR76 0000' },
}

export function timeRow(id: number, elementId: number, title: string, date: string, hours: number): ProjetsTimeRow {
  return { id, element_id: elementId, element: title, type: 'TASK', projet: 'Portail transporteurs', date, heures: hours, commentaire: null }
}
