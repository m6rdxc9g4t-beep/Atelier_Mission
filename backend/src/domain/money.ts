// Calculs monétaires purs. Montants en centimes entiers, quantités en millièmes, taux en points de base.
// Aucun flottant n'est stocké : on arrondit une seule fois, au centime, à la fin de chaque calcul.

/** Arrondi au plus proche, la demie s'éloignant de zéro (symétrique pour les avoirs négatifs). */
export function roundHalfAwayFromZero(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value))
}

/** Montant HT d'une ligne : quantité (millièmes) × prix unitaire (centimes). */
export function lineTotalCents(quantityMilli: number, unitPriceCents: number): number {
  return roundHalfAwayFromZero((quantityMilli * unitPriceCents) / 1000)
}

/** Montant × taux (points de base) arrondi au centime. */
export function applyRate(amountCents: number, rateBps: number): number {
  return roundHalfAwayFromZero((amountCents * rateBps) / 10_000)
}

export interface PricedLine {
  quantityMilli: number
  unitPriceCents: number
  vatRateBps: number
}

export interface VatBucket {
  rateBps: number
  baseCents: number
  vatCents: number
}

export interface Totals {
  htCents: number
  vatCents: number
  ttcCents: number
  /** TVA par taux : calculée sur la base HT de chaque taux (pas ligne par ligne). */
  byRate: VatBucket[]
}

export function computeTotals(lines: readonly PricedLine[]): Totals {
  const bases = new Map<number, number>()
  let htCents = 0
  for (const line of lines) {
    const ht = lineTotalCents(line.quantityMilli, line.unitPriceCents)
    htCents += ht
    bases.set(line.vatRateBps, (bases.get(line.vatRateBps) ?? 0) + ht)
  }
  const byRate = [...bases.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rateBps, baseCents]) => ({ rateBps, baseCents, vatCents: applyRate(baseCents, rateBps) }))
  const vatCents = byRate.reduce((sum, bucket) => sum + bucket.vatCents, 0)
  return { htCents, vatCents, ttcCents: htCents + vatCents, byRate }
}

/** Quantité saisie (2,5 · « 2,5 » · 2.5) → millièmes. */
export function toMilli(quantity: number): number {
  return Math.round(quantity * 1000)
}

export function fromMilli(milli: number): number {
  return milli / 1000
}

const EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
const NUMBER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 })

/** 123456 → « 1 234,56 € » (espaces insécables du format français). */
export function formatEuros(cents: number): string {
  return EUR.format(cents / 100)
}

export function formatQuantity(milli: number): string {
  return NUMBER.format(milli / 1000)
}

export function formatRate(bps: number): string {
  return `${NUMBER.format(bps / 100)} %`
}
