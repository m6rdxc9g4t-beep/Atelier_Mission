// État d'interface : notifications, compteur de rafraîchissement global.
// Le thème n'est plus ici : c'est la préférence commune de la suite (lib/theme.ts, design-system/brand/atelier-theme.js).
import { create } from 'zustand'

export interface Toast {
  id: number
  tone: 'success' | 'error' | 'info'
  message: string
}

interface UiState {
  toasts: Toast[]
  notify: (message: string, tone?: Toast['tone']) => void
  dismiss: (id: number) => void
  /** Incrémenté après une écriture : les écrans abonnés se rechargent. */
  revision: number
  refresh: () => void
}

let nextId = 1

export const useUi = create<UiState>()((set) => ({
  toasts: [],
  notify: (message, tone = 'success') => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, tone, message }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), tone === 'error' ? 7000 : 3500)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  revision: 0,
  refresh: () => set((s) => ({ revision: s.revision + 1 })),
}))
