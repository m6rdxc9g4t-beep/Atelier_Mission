// Contexte partagé par les services : base, horloge, fuseau, clients des apps reliées.
import type { Db } from '../db/client.ts'
import { localDate } from '../domain/dates.ts'
import type { BrevoClient } from '../integrations/brevo.ts'
import type { ProjetsClient } from '../integrations/projets.ts'
import type { SuperPdpClient } from '../integrations/superpdp.ts'
import type { TresorerieClient } from '../integrations/tresorerie.ts'

export interface Integrations {
  projets: (baseUrl: string) => ProjetsClient
  tresorerie: (baseUrl: string) => TresorerieClient
  /** null quand BREVO_API_KEY n'est pas configurée. */
  brevo: BrevoClient | null
  /** null quand SUPERPDP_CLIENT_ID / SUPERPDP_CLIENT_SECRET ne sont pas configurés. */
  superpdp: SuperPdpClient | null
}

export interface Ctx {
  db: Db
  now: () => Date
  timeZone: string
  integrations: Integrations
}

export function nowIso(ctx: Pick<Ctx, 'now'>): string {
  return ctx.now().toISOString()
}

export function today(ctx: Pick<Ctx, 'now' | 'timeZone'>): string {
  return localDate(ctx.now(), ctx.timeZone)
}
