// Pipeline commercial : étapes, probabilités par défaut et valeur pondérée.
import type { Source, Stage } from '../db/schema.ts'

export const STAGE_LABELS: Record<Stage, string> = {
  NEW: 'Nouveau',
  QUALIFIED: 'Qualifié',
  PROPOSAL: 'Devis envoyé',
  NEGOTIATION: 'Négociation',
  WON: 'Gagné',
  LOST: 'Perdu',
}

export const SOURCE_LABELS: Record<Source, string> = {
  MALT: 'Malt',
  DIRECT: 'Direct',
  REFERRAL: 'Recommandation',
  NETWORK: 'Réseau',
  OTHER: 'Autre',
}

/** Probabilité appliquée quand on déplace une carte et que l'utilisateur ne l'a pas fixée lui-même. */
export const DEFAULT_PROBABILITY: Record<Stage, number> = {
  NEW: 10,
  QUALIFIED: 25,
  PROPOSAL: 50,
  NEGOTIATION: 70,
  WON: 100,
  LOST: 0,
}

export const OPEN_STAGES: readonly Stage[] = ['NEW', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION']

export function isOpenStage(stage: Stage): boolean {
  return OPEN_STAGES.includes(stage)
}

export function isClosedStage(stage: Stage): boolean {
  return stage === 'WON' || stage === 'LOST'
}

/** Valeur pondérée d'une opportunité (centimes). */
export function weightedCents(amountCents: number, probability: number): number {
  return Math.round((amountCents * Math.min(100, Math.max(0, probability))) / 100)
}

/**
 * Probabilité après un changement d'étape : on garde celle de l'utilisateur si elle est cohérente avec la
 * nouvelle étape (ni 0 ni 100 pour une étape ouverte), sinon la valeur par défaut de l'étape.
 */
export function probabilityAfterMove(current: number, from: Stage, to: Stage): number {
  if (to === 'WON' || to === 'LOST') return DEFAULT_PROBABILITY[to]
  if (current === DEFAULT_PROBABILITY[from] || current <= 0 || current >= 100) return DEFAULT_PROBABILITY[to]
  return current
}

/** Taux de conversion : gagnées / (gagnées + perdues), en pourcentage entier ; null sans opportunité close. */
export function conversionRate(won: number, lost: number): number | null {
  return won + lost === 0 ? null : Math.round((won * 100) / (won + lost))
}
