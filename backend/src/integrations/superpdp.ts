// Client de la plateforme agréée SUPER PDP (API v1.beta, https://api.superpdp.tech).
// Contrat relevé sur les exemples officiels (github.com/superpdp/examples) et un client validé contre leur bac à sable :
// - OAuth2 client_credentials : POST /oauth2/token (formulaire) → { access_token, expires_in } ;
// - dépôt : POST /v1.beta/invoices?external_id=…, corps brut application/pdf (Factur-X) → facture { id, events[] } ;
// - cycle de vie : GET /v1.beta/invoice_events?starting_after_id=…&limit=… → { data[], has_after } ;
// - statut « Encaissée » : POST /v1.beta/invoice_events { invoice_id, status_code: "fr:212", details[].reported_data[] } ;
// - diagnostic : GET /v1.beta/oauth2_sessions/me, GET /v1.beta/companies/me.
// Même hôte pour le bac à sable et la production : ce sont les identifiants qui décident.
// Appel EXTÉRIEUR : le service n'appelle ce client qu'en mode « En ligne ».
import { requestJson, type FetchLike } from './http.ts'

export const SUPERPDP_DEFAULT_URL = 'https://api.superpdp.tech'
const APP = 'SUPER PDP'

export interface SuperPdpEvent {
  id: number
  invoice_id: number
  status_code: string
  status_text?: string | null
  created_at: string
  data?: { reason?: string | null } | null
}

export interface SuperPdpInvoice {
  id: number
  direction?: 'in' | 'out'
  external_id?: string | null
  events?: SuperPdpEvent[]
  created_at?: string
}

export interface SuperPdpList<T> {
  data: T[]
  has_after?: boolean
}

export interface PaymentReport {
  /** Montant encaissé (centimes), pour un taux de TVA. */
  amountCents: number
  ratePercent: string
  date: string
}

export interface SuperPdpClient {
  baseUrl: string
  session(): Promise<{ companyVerificationStatus: string | null }>
  company(): Promise<{ name: string | null; number: string | null }>
  sendInvoice(pdf: Uint8Array, externalId: string): Promise<SuperPdpInvoice>
  /** Factures émises récentes : retrouver un dépôt dont la réponse s'est perdue. */
  recentOutgoing(limit?: number): Promise<SuperPdpInvoice[]>
  getInvoice(id: number): Promise<SuperPdpInvoice>
  listEvents(startingAfterId: number, limit?: number): Promise<SuperPdpList<SuperPdpEvent>>
  reportPayment(invoiceId: number, reports: PaymentReport[]): Promise<SuperPdpEvent>
}

const money = (cents: number) => `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`

export function createSuperPdpClient(config: { baseUrl?: string; clientId: string; clientSecret: string }, fetchImpl: FetchLike = fetch): SuperPdpClient {
  const base = (config.baseUrl || SUPERPDP_DEFAULT_URL).replace(/\/$/, '')
  let token: { value: string; expiresAt: number } | null = null

  const accessToken = async (): Promise<string> => {
    if (token && token.expiresAt > Date.now() + 60_000) return token.value
    const result = await requestJson<{ access_token?: string; expires_in?: number }>(fetchImpl, `${base}/oauth2/token`, APP, 'SUPERPDP_AUTH', {
      method: 'POST',
      rawBody: {
        data: new URLSearchParams({ grant_type: 'client_credentials', client_id: config.clientId, client_secret: config.clientSecret }).toString(),
        contentType: 'application/x-www-form-urlencoded',
      },
    })
    if (!result.access_token) throw new Error('SUPER PDP : réponse d’authentification sans jeton')
    token = { value: result.access_token, expiresAt: Date.now() + (result.expires_in ?? 1800) * 1000 }
    return token.value
  }

  const api = async <T>(path: string, options: Parameters<typeof requestJson>[4] = {}): Promise<T> => {
    const auth = { authorization: `Bearer ${await accessToken()}` }
    try {
      return await requestJson<T>(fetchImpl, `${base}/v1.beta${path}`, APP, 'SUPERPDP_ERROR', { timeoutMs: 20_000, ...options, headers: { ...options.headers, ...auth } })
    } catch (error) {
      // Jeton révoqué avant son expiration : on le jette pour que l'appel suivant se réauthentifie.
      if ((error as { upstreamStatus?: number }).upstreamStatus === 401) token = null
      throw error
    }
  }

  return {
    baseUrl: base,
    async session() {
      const s = await api<{ company_verification_status?: string }>('/oauth2_sessions/me')
      return { companyVerificationStatus: s.company_verification_status ?? null }
    },
    async company() {
      const c = await api<{ formal_name?: string; name?: string; number?: string }>('/companies/me')
      return { name: c.formal_name ?? c.name ?? null, number: c.number ?? null }
    },
    sendInvoice(pdf, externalId) {
      return api<SuperPdpInvoice>(`/invoices?external_id=${encodeURIComponent(externalId)}`, {
        method: 'POST',
        rawBody: { data: pdf, contentType: 'application/pdf' },
        timeoutMs: 60_000,
      })
    },
    async recentOutgoing(limit = 50) {
      const list = await api<SuperPdpList<SuperPdpInvoice>>(`/invoices?direction=out&order=desc&limit=${limit}`)
      return list.data ?? []
    },
    getInvoice(id) {
      return api<SuperPdpInvoice>(`/invoices/${id}`)
    },
    listEvents(startingAfterId, limit = 100) {
      return api<SuperPdpList<SuperPdpEvent>>(`/invoice_events?starting_after_id=${startingAfterId}&limit=${limit}`)
    },
    reportPayment(invoiceId, reports) {
      return api<SuperPdpEvent>('/invoice_events', {
        method: 'POST',
        body: {
          invoice_id: invoiceId,
          status_code: 'fr:212',
          details: [
            {
              reported_data: reports.map((r) => ({ amount: money(r.amountCents), currency_code: 'EUR', type_code: 'MEN', value_percent: r.ratePercent, date: r.date })),
            },
          ],
        },
      })
    },
  }
}
