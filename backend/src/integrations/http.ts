// Appels HTTP vers les apps reliées. Projets et Trésorerie : bouclage uniquement (127.0.0.1, localhost, ::1),
// quel que soit le mode — leurs données ne quittent jamais la machine. Brevo et SUPER PDP : seuls appels extérieurs, en mode En ligne.
import { HttpError } from '../http/errors.ts'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

export function assertLoopbackUrl(raw: string, appName: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new HttpError(400, 'VALIDATION', `Adresse d’${appName} invalide : « ${raw} »`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, 'VALIDATION', `Adresse d’${appName} invalide : http(s) uniquement`)
  }
  if (!LOOPBACK.has(url.hostname)) {
    throw new HttpError(403, 'FORBIDDEN_HOST', `${appName} doit être une adresse locale (127.0.0.1, localhost ou ::1) : ses données ne quittent pas la machine`)
  }
  return url
}

export class UpstreamError extends HttpError {
  readonly upstreamStatus: number | null

  constructor(code: string, message: string, upstreamStatus: number | null = null) {
    super(502, code, message)
    this.name = 'UpstreamError'
    this.upstreamStatus = upstreamStatus
  }
}

export interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  /** Corps JSON. */
  body?: unknown
  /** Corps brut (PDF, formulaire encodé…) avec son type de contenu. */
  rawBody?: { data: Uint8Array | string; contentType: string }
  timeoutMs?: number
}

/** Requête JSON avec délai ; toute erreur réseau ou HTTP devient une UpstreamError au message français. */
export async function requestJson<T>(fetchImpl: FetchLike, url: string, appName: string, code: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000)
  let response: Response
  try {
    const contentType = options.rawBody ? options.rawBody.contentType : options.body !== undefined ? 'application/json' : undefined
    response = await fetchImpl(url, {
      method: options.method ?? 'GET',
      headers: { accept: 'application/json', ...(contentType ? { 'content-type': contentType } : {}), ...options.headers },
      body: options.rawBody ? (options.rawBody.data as NonNullable<RequestInit["body"]>) : options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    })
  } catch (error) {
    const reason = controller.signal.aborted ? 'délai dépassé' : error instanceof Error ? error.message : String(error)
    throw new UpstreamError(code, `${appName} injoignable (${reason}). L’application est-elle lancée ?`)
  } finally {
    clearTimeout(timer)
  }
  const text = await response.text()
  let payload: unknown = null
  if (text !== '') {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }
  if (!response.ok) {
    const detail =
      typeof payload === 'object' && payload !== null
        ? ((payload as Record<string, unknown>).detail ?? (payload as Record<string, unknown>).error ?? (payload as Record<string, unknown>).message)
        : payload
    throw new UpstreamError(code, `${appName} a refusé la requête (HTTP ${response.status}) : ${String(detail ?? response.statusText)}`, response.status)
  }
  return payload as T
}
