// Appels à l'API d'Atelier Mission (même origine : Vite relaie /api vers 127.0.0.1:3001).
// Toute erreur devient une ApiError portant le message français du backend (`detail`) et son code.

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? (method === 'GET' || method === 'DELETE' ? undefined : '{}') : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'NETWORK', 'API d’Atelier Mission injoignable : lancez « npm run dev » à la racine du dépôt')
  }
  if (response.status === 204) return undefined as T
  const text = await response.text()
  const payload = text ? (JSON.parse(text) as unknown) : null
  if (!response.ok) {
    const error = (payload ?? {}) as { detail?: string; message?: string; code?: string }
    throw new ApiError(response.status, error.code ?? 'ERROR', error.detail ?? error.message ?? `Erreur HTTP ${response.status}`)
  }
  return payload as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}

/** Paramètres de requête sans les valeurs vides. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}` : ''
}
