// Configuration du backend : variables d'environnement (fichier backend/.env facultatif) avec valeurs par défaut.
// Ports de la Suite Atelier : API d'Atelier Mission sur 127.0.0.1:3001 (Projets 3000, Trésorerie 5050).
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export interface Config {
  host: string
  port: number
  /** Chemin du fichier SQLite (« :memory: » pour les tests). */
  databasePath: string
  /** Clé API Brevo : lue dans l'environnement uniquement, jamais stockée en base ni renvoyée par l'API. */
  brevoApiKey: string | undefined
  /** Plateforme agréée SUPER PDP : identifiants OAuth (client_credentials), jamais stockés ni renvoyés. */
  superpdp: { baseUrl: string; clientId: string; clientSecret: string } | null
  /** Hôtes supplémentaires acceptés par la garde « local-only ». */
  allowedHosts: string[]
  /** Intervalle du planificateur de relances (minutes, 0 = désactivé). */
  reminderTickMinutes: number
  logLevel: string
}

/** Charge backend/.env s'il existe (Node ≥ 21.7 : process.loadEnvFile), sans écraser l'environnement. */
export function loadEnvFile(file = path.join(BACKEND_ROOT, '.env')): void {
  if (existsSync(file)) process.loadEnvFile(file)
}

function integer(value: string | undefined, fallback: number): number {
  const parsed = value === undefined || value.trim() === '' ? Number.NaN : Number(value)
  return Number.isInteger(parsed) ? parsed : fallback
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databasePath = env.DATABASE_PATH?.trim() || path.join(BACKEND_ROOT, 'data', 'atelier-mission.db')
  return {
    host: env.HOST?.trim() || '127.0.0.1',
    port: integer(env.PORT, 3001),
    databasePath: databasePath === ':memory:' || path.isAbsolute(databasePath) ? databasePath : path.resolve(BACKEND_ROOT, databasePath),
    brevoApiKey: env.BREVO_API_KEY?.trim() || undefined,
    superpdp:
      env.SUPERPDP_CLIENT_ID?.trim() && env.SUPERPDP_CLIENT_SECRET?.trim()
        ? { baseUrl: env.SUPERPDP_URL?.trim() || 'https://api.superpdp.tech', clientId: env.SUPERPDP_CLIENT_ID.trim(), clientSecret: env.SUPERPDP_CLIENT_SECRET.trim() }
        : null,
    allowedHosts: (env.ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean),
    reminderTickMinutes: integer(env.REMINDER_TICK_MINUTES, 15),
    logLevel: env.LOG_LEVEL?.trim() || 'info',
  }
}
