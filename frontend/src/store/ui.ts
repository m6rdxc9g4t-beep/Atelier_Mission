// État d'interface : thème (mémorisé), notifications, compteur de rafraîchissement global.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ThemePreference } from '../lib/theme.ts'

export interface Toast {
  id: number
  tone: 'success' | 'error' | 'info'
  message: string
}

interface UiState {
  theme: ThemePreference
  setTheme: (theme: ThemePreference) => void
  toasts: Toast[]
  notify: (message: string, tone?: Toast['tone']) => void
  dismiss: (id: number) => void
  /** Incrémenté après une écriture : les écrans abonnés se rechargent. */
  revision: number
  refresh: () => void
}

let nextId = 1

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => set({ theme }),
      toasts: [],
      notify: (message, tone = 'success') => {
        const id = nextId++
        set((s) => ({ toasts: [...s.toasts, { id, tone, message }] }))
        setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), tone === 'error' ? 7000 : 3500)
      },
      dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      revision: 0,
      refresh: () => set((s) => ({ revision: s.revision + 1 })),
    }),
    { name: 'atelier-mission:ui', partialize: (s) => ({ theme: s.theme }) },
  ),
)
