import { api } from './api.ts'
import type { Settings } from './types.ts'
import { useApi } from './use-api.ts'

/** Réglages courants (TVA par défaut, franchise, TJM…) pour les formulaires. */
export function useSettings() {
  const { data } = useApi(() => api.get<Settings>('/settings'))
  return {
    settings: data,
    franchise: (data?.company.vatRegime ?? 'FRANCHISE') === 'FRANCHISE',
    defaultVat: data?.billing.defaultVatRateBps ?? 0,
  }
}
