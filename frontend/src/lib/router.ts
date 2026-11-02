// Navigation par l'ancre de l'URL (#/factures/12) : pas de serveur à configurer, liens partageables, retour arrière natif.
import { useSyncExternalStore } from 'react'

function current(): string {
  return window.location.hash.replace(/^#/, '') || '/'
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

export function useRoute(): { path: string; segments: string[]; query: URLSearchParams } {
  const raw = useSyncExternalStore(subscribe, current, () => '/')
  const [path = '/', search = ''] = raw.split('?')
  return { path, segments: path.split('/').filter(Boolean), query: new URLSearchParams(search) }
}

export function navigate(to: string): void {
  window.location.hash = to
}

export const href = (to: string) => `#${to}`
