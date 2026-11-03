// Cycle de vie des factures électroniques (statuts de la réforme, codes « fr:2xx » de la norme AFNOR XP Z12-012).
// Le libellé renvoyé par la plateforme (status_text) fait foi ; cette table ne sert que de repli et pour décider
// des cas qui demandent une action (rejet par la plateforme, refus par le client).
import type { VatBucket } from './money.ts'

export const LIFECYCLE_LABELS: Record<string, string> = {
  'fr:200': 'Déposée',
  'fr:201': 'Émise par la plateforme',
  'fr:202': 'Reçue par la plateforme',
  'fr:203': 'Mise à disposition',
  'fr:204': 'Prise en charge',
  'fr:205': 'Approuvée',
  'fr:206': 'Approuvée partiellement',
  'fr:207': 'En litige',
  'fr:208': 'Suspendue',
  'fr:209': 'Complétée',
  'fr:210': 'Refusée',
  'fr:211': 'Paiement transmis',
  'fr:212': 'Encaissée',
  'fr:213': 'Rejetée',
}

/** Statuts qui exigent une action : rejet technique par la plateforme, refus par le client. */
export const BLOCKING_CODES = new Set(['fr:210', 'fr:213'])

export function lifecycleLabel(code: string, apiText?: string | null): string {
  return apiText?.trim() || LIFECYCLE_LABELS[code] || code
}

export function isBlocking(code: string, apiText?: string | null): boolean {
  return BLOCKING_CODES.has(code) || /rejet|refus/i.test(apiText ?? '')
}

/** « 20 » → "20.0", « 5,5 » → "5.5", franchise → "0". */
export function ratePercent(rateBps: number): string {
  return rateBps === 0 ? '0' : (rateBps / 100).toFixed(1)
}

/**
 * Données de paiement de l'e-reporting : un encaissement réparti par taux de TVA, au prorata du TTC de chaque taux
 * (la somme des parts égale toujours le montant reçu ; le reliquat d'arrondi va au dernier taux).
 */
export function splitPaymentByRate(amountCents: number, buckets: readonly VatBucket[], franchise: boolean): { rateBps: number; amountCents: number }[] {
  if (franchise || buckets.length <= 1) return [{ rateBps: franchise ? 0 : (buckets[0]?.rateBps ?? 0), amountCents }]
  const ttc = buckets.map((b) => ({ rateBps: b.rateBps, ttc: b.baseCents + b.vatCents }))
  const total = ttc.reduce((s, b) => s + b.ttc, 0)
  let allocated = 0
  return ttc.map((b, i) => {
    const share = i === ttc.length - 1 ? amountCents - allocated : Math.round((amountCents * b.ttc) / total)
    allocated += share
    return { rateBps: b.rateBps, amountCents: share }
  })
}
