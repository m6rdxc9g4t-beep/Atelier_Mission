// Client Brevo (e-mails transactionnels) : POST https://api.brevo.com/v3/smtp/email, clé dans l'en-tête « api-key ».
// Appel extérieur (avec SUPER PDP) : n'est appelé qu'en mode « En ligne » (vérifié par le service).
import { requestJson, type FetchLike } from './http.ts'

export const BREVO_API = 'https://api.brevo.com/v3'

export interface BrevoEmail {
  sender: { email: string; name?: string }
  to: { email: string; name?: string }[]
  bcc?: { email: string; name?: string }[]
  replyTo?: { email: string; name?: string }
  subject: string
  htmlContent: string
  textContent: string
  tags?: string[]
}

export interface BrevoClient {
  sendEmail(email: BrevoEmail): Promise<{ messageId: string }>
  account(): Promise<{ email: string; companyName: string | null }>
}

const APP = 'Brevo'

export function createBrevoClient(apiKey: string, fetchImpl: FetchLike = fetch): BrevoClient {
  const headers = { 'api-key': apiKey }
  return {
    async sendEmail(email) {
      const result = await requestJson<{ messageId?: string }>(fetchImpl, `${BREVO_API}/smtp/email`, APP, 'BREVO_ERROR', {
        method: 'POST',
        headers,
        body: email,
        timeoutMs: 15_000,
      })
      return { messageId: result.messageId ?? '' }
    },
    async account() {
      const result = await requestJson<{ email: string; companyName?: string }>(fetchImpl, `${BREVO_API}/account`, APP, 'BREVO_ERROR', { headers })
      return { email: result.email, companyName: result.companyName ?? null }
    },
  }
}
