// Chargement d'une ressource de l'API, rechargée quand `deps` change ou après une écriture (useUi.refresh).
import { useCallback, useEffect, useState } from 'react'
import { useUi } from '../store/ui.ts'
import { ApiError } from './api.ts'

export function useApi<T>(load: () => Promise<T>, deps: readonly unknown[] = []) {
  const revision = useUi((s) => s.revision)
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    load()
      .then((value) => {
        if (!cancelled) {
          setData(value)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err : new ApiError(0, 'ERROR', String(err)))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, tick, ...deps])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, reload, setData }
}

/** Exécute une écriture : notification de succès ou d'erreur, puis rafraîchissement global. */
export function useAction() {
  const notify = useUi((s) => s.notify)
  const refresh = useUi((s) => s.refresh)
  const [busy, setBusy] = useState<string | null>(null)
  const run = useCallback(
    async <T,>(key: string, action: () => Promise<T>, success?: string | ((result: T) => string)): Promise<T | undefined> => {
      setBusy(key)
      try {
        const result = await action()
        if (success) notify(typeof success === 'function' ? success(result) : success)
        refresh()
        return result
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error), 'error')
        return undefined
      } finally {
        setBusy(null)
      }
    },
    [notify, refresh],
  )
  return { run, busy }
}
