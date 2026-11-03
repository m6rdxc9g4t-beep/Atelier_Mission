// Suite Atelier : applications reliées à Atelier Mission (sélecteur de l'en-tête) et état « en marche / arrêtée ».
// Adresses surchargeables : VITE_ATELIER_PROJETS_URL, VITE_ATELIER_TRESORERIE_URL, VITE_ATELIER_VIZ_URL, VITE_ATELIER_TAB_URL.

export type SuiteAppId = 'mission' | 'projets' | 'tresorerie' | 'viz' | 'tab'

export interface SuiteApp {
  id: SuiteAppId
  name: string
  short: string
  description: string
  url: string
  healthUrls: readonly string[]
}

export const CURRENT_APP: SuiteAppId = 'mission'
export const HEALTH_TIMEOUT_MS = 1500

const env = import.meta.env as Record<string, string | undefined>
const urlFrom = (variable: string, fallback: string) => (env[variable]?.trim() || fallback).replace(/\/+$/, '')
/** Sonde de santé : celle de l'adresse publiée si elle est fournie (serveur), sinon les ports locaux habituels. */
const healthFrom = (variable: string, path: string, local: readonly string[]) => (env[variable]?.trim() ? [`${urlFrom(variable, '')}${path}`] : local)

export const SUITE_APPS: readonly SuiteApp[] = [
  { id: 'mission', name: 'Atelier Mission', short: 'Mission', description: 'Prospects, devis, factures, relances', url: '/', healthUrls: ['/api/health'] },
  {
    id: 'projets',
    name: 'Atelier Projets',
    short: 'Projets',
    description: 'Projets agiles et temps passé → factures',
    url: urlFrom('VITE_ATELIER_PROJETS_URL', 'http://127.0.0.1:4174'),
    healthUrls: healthFrom('VITE_ATELIER_PROJETS_URL', '/api/health', ['http://127.0.0.1:3000/api/health']),
  },
  {
    id: 'tresorerie',
    name: 'Atelier Trésorerie',
    short: 'Trésorerie',
    description: 'Comptes et budget : les encaissements y remontent',
    url: urlFrom('VITE_ATELIER_TRESORERIE_URL', 'http://127.0.0.1:5050'),
    healthUrls: [`${urlFrom('VITE_ATELIER_TRESORERIE_URL', 'http://127.0.0.1:5050')}/api/ping`],
  },
  { id: 'viz', name: 'Atelier Viz', short: 'Viz', description: 'BI locale : rapports et visuels', url: urlFrom('VITE_ATELIER_VIZ_URL', 'http://127.0.0.1:8000'), healthUrls: healthFrom('VITE_ATELIER_VIZ_URL', '/api/health', ['http://127.0.0.1:8000/api/health']) },
  { id: 'tab', name: 'Atelier Tab', short: 'Tab', description: 'Tableur et base typée', url: urlFrom('VITE_ATELIER_TAB_URL', 'http://127.0.0.1:4175'), healthUrls: healthFrom('VITE_ATELIER_TAB_URL', '/api/health', ['http://127.0.0.1:4175/api/health', 'http://127.0.0.1:5175/api/health']) },
]

export type SuiteStatus = 'up' | 'down'

/** Santé sans bloquer : `no-cors` pour une autre origine (réponse opaque = serveur en écoute), 1,5 s au plus. */
export async function checkHealth(healthUrl: string, timeoutMs = HEALTH_TIMEOUT_MS): Promise<SuiteStatus> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const sameOrigin = new URL(healthUrl, window.location.href).origin === window.location.origin
    const response = await fetch(healthUrl, { mode: sameOrigin ? 'same-origin' : 'no-cors', cache: 'no-store', credentials: 'omit', signal: controller.signal })
    return response.type === 'opaque' || response.ok ? 'up' : 'down'
  } catch {
    return 'down'
  } finally {
    clearTimeout(timer)
  }
}

export async function checkAnyHealth(healthUrls: readonly string[]): Promise<SuiteStatus> {
  if (healthUrls.length === 0) return 'down'
  return Promise.any(healthUrls.map((u) => checkHealth(u).then((s) => (s === 'up' ? 'up' : Promise.reject(new Error('down')))))).catch(() => 'down' as const)
}
