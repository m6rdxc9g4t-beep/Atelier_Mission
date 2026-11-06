// Barre haute de la coquille (44 px) : la coquille y réserve un emplacement, que l'en-tête de la vue (PageHeader)
// remplit par un portail avec le titre de l'écran. Sans en-tête (chargement, erreur), la coquille affiche le nom
// de la rubrique courante.
import { createContext, useContext } from 'react'

export const TopBarSlot = createContext<HTMLElement | null>(null)

export function useTopBarSlot(): HTMLElement | null {
  return useContext(TopBarSlot)
}
