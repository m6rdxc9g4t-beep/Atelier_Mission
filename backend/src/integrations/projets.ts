// Client d'Atelier Projets (contrat atelier-node/1 : /api/atelier/projects et /api/atelier/tables/time-entries).
import { assertLoopbackUrl, requestJson, type FetchLike } from './http.ts'

export interface ProjetsProject {
  id: number
  name: string
}

/** Ligne de la table « time-entries » (atelier-table/1, docs/SUITE.md §4.3 d'Atelier Projets). */
export interface ProjetsTimeRow {
  id: number
  element_id: number
  element: string
  type: string
  projet: string
  date: string
  heures: number
  commentaire: string | null
}

interface AtelierTable<Row> {
  format: string
  name: string
  rows: Row[]
  total: number | null
  truncated: boolean
}

export interface ProjetsClient {
  baseUrl: string
  ping(): Promise<boolean>
  listProjects(): Promise<ProjetsProject[]>
  timeEntries(projectId: number): Promise<{ rows: ProjetsTimeRow[]; truncated: boolean }>
}

const APP = 'Atelier Projets'

export function createProjetsClient(baseUrl: string, fetchImpl: FetchLike = fetch): ProjetsClient {
  const base = assertLoopbackUrl(baseUrl, APP).toString().replace(/\/$/, '')
  return {
    baseUrl: base,
    async ping() {
      try {
        await requestJson(fetchImpl, `${base}/api/health`, APP, 'PROJETS_UNAVAILABLE', { timeoutMs: 1500 })
        return true
      } catch {
        return false
      }
    },
    async listProjects() {
      const projects = await requestJson<{ id: number | string; name: string }[]>(fetchImpl, `${base}/api/atelier/projects`, APP, 'PROJETS_UNAVAILABLE')
      return projects.map((p) => ({ id: Number(p.id), name: p.name })).sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    },
    async timeEntries(projectId) {
      const table = await requestJson<AtelierTable<ProjetsTimeRow>>(
        fetchImpl,
        `${base}/api/atelier/tables/time-entries?project_id=${encodeURIComponent(projectId)}`,
        APP,
        'PROJETS_UNAVAILABLE',
        { timeoutMs: 15_000 },
      )
      if (table.format !== 'atelier-table/1' || !Array.isArray(table.rows)) {
        throw new Error('Réponse inattendue d’Atelier Projets (atelier-table/1 attendu)')
      }
      return { rows: table.rows, truncated: table.truncated === true }
    },
  }
}
