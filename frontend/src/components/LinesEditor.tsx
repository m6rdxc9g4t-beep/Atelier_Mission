// Lignes d'un devis ou d'une facture brouillon. Les champs restent du texte saisi (« 2,5 », « 550 ») tant qu'on
// tape ; le total affiché est indicatif — le backend recalcule et arrondit (TVA par taux) à l'enregistrement.
import { ArrowDown, ArrowUp, Clock3, Plus, Trash2 } from 'lucide-react'
import { centsToInput, euros, num, parseEuros, parseNumber } from '../lib/format.ts'
import { UNIT_LABEL, VAT_RATES } from '../lib/labels.ts'
import type { Line, Unit, VatBucket } from '../lib/types.ts'
import { Button, Input, Money, Select } from './ui.tsx'

export interface DraftLine {
  key: string
  id?: number
  label: string
  details: string
  unit: Unit
  quantity: string
  price: string
  vatRateBps: number
  timeEntryCount?: number
}

let seq = 0
export const toDraft = (line: Line): DraftLine => ({
  key: `l${seq++}`,
  id: line.id,
  label: line.label,
  details: line.details,
  unit: line.unit,
  quantity: String(line.quantity).replace('.', ','),
  price: centsToInput(line.unitPriceCents),
  vatRateBps: line.vatRateBps,
  timeEntryCount: line.timeEntryCount,
})

export const emptyLine = (vatRateBps: number, unit: Unit = 'DAY', price = ''): DraftLine => ({ key: `l${seq++}`, label: '', details: '', unit, quantity: '1', price, vatRateBps })

/** Lignes prêtes pour l'API, ou un message d'erreur. */
export function fromDrafts(lines: DraftLine[]): { lines: Line[] } | { error: string } {
  const out: Line[] = []
  for (const [i, line] of lines.entries()) {
    if (!line.label.trim() && !line.price && line.quantity === '1') continue
    const quantity = parseNumber(line.quantity)
    const price = parseEuros(line.price)
    if (!line.label.trim()) return { error: `Ligne ${i + 1} : désignation manquante` }
    if (quantity === null) return { error: `Ligne ${i + 1} : quantité illisible` }
    if (price === null || price < 0) return { error: `Ligne ${i + 1} : prix unitaire illisible` }
    out.push({ ...(line.id !== undefined ? { id: line.id } : {}), label: line.label.trim(), details: line.details.trim(), unit: line.unit, quantity, unitPriceCents: price, vatRateBps: line.vatRateBps })
  }
  return { lines: out }
}

export function previewTotals(lines: DraftLine[]) {
  let ht = 0
  const byRate = new Map<number, number>()
  for (const l of lines) {
    const q = parseNumber(l.quantity) ?? 0
    const p = parseEuros(l.price) ?? 0
    const t = Math.round(q * p)
    ht += t
    byRate.set(l.vatRateBps, (byRate.get(l.vatRateBps) ?? 0) + t)
  }
  const vat = [...byRate.entries()].reduce((s, [rate, base]) => s + Math.round((base * rate) / 10_000), 0)
  return { ht, vat, ttc: ht + vat }
}

export function LinesEditor({ lines, onChange, readOnly, defaultVat, franchise }: { lines: DraftLine[]; onChange: (lines: DraftLine[]) => void; readOnly?: boolean; defaultVat: number; franchise: boolean }) {
  const update = (key: string, patch: Partial<DraftLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const move = (index: number, delta: number) => {
    const next = [...lines]
    const [item] = next.splice(index, 1)
    if (item) next.splice(index + delta, 0, item)
    onChange(next)
  }
  return (
    <div className="overflow-x-auto">
      <table className="ds-table min-w-[44rem]">
        <thead>
          <tr>
            <th className="w-[40%]">Désignation</th>
            <th className="ds-num">Quantité</th>
            <th>Unité</th>
            <th className="ds-num">Prix unit. HT</th>
            {!franchise && <th>TVA</th>}
            <th className="ds-num">Total HT</th>
            {!readOnly && <th className="w-24" aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => {
            const total = Math.round((parseNumber(line.quantity) ?? 0) * (parseEuros(line.price) ?? 0))
            if (readOnly) {
              return (
                <tr key={line.key}>
                  <td>
                    <div className="font-medium">{line.label}</div>
                    {line.details && <div className="whitespace-pre-line text-xs text-muted">{line.details}</div>}
                    {!!line.timeEntryCount && (
                      <div className="mt-1 inline-flex items-center gap-1 text-xs text-muted">
                        <Clock3 className="size-3" /> {line.timeEntryCount} saisie{line.timeEntryCount > 1 ? 's' : ''} Atelier Projets
                      </div>
                    )}
                  </td>
                  <td className="ds-num">{num(parseNumber(line.quantity) ?? 0)}</td>
                  <td>{UNIT_LABEL[line.unit]}</td>
                  <td className="ds-num">{euros(parseEuros(line.price) ?? 0)}</td>
                  {!franchise && <td>{line.vatRateBps / 100} %</td>}
                  <td className="ds-num">
                    <Money cents={total} />
                  </td>
                </tr>
              )
            }
            return (
              <tr key={line.key}>
                <td>
                  <Input aria-label={`Désignation ligne ${index + 1}`} value={line.label} onChange={(e) => update(line.key, { label: e.target.value })} placeholder="Développement, atelier, forfait…" />
                  <Input aria-label={`Détail ligne ${index + 1}`} className="mt-1 !min-h-8 text-xs" value={line.details} onChange={(e) => update(line.key, { details: e.target.value })} placeholder="Détail (facultatif)" />
                  {!!line.timeEntryCount && (
                    <div className="mt-1 inline-flex items-center gap-1 text-xs text-muted">
                      <Clock3 className="size-3" /> liée à {line.timeEntryCount} saisie{line.timeEntryCount > 1 ? 's' : ''} de temps
                    </div>
                  )}
                </td>
                <td className="ds-num">
                  <Input aria-label={`Quantité ligne ${index + 1}`} className="w-20 text-right" inputMode="decimal" value={line.quantity} onChange={(e) => update(line.key, { quantity: e.target.value })} />
                </td>
                <td>
                  <Select aria-label={`Unité ligne ${index + 1}`} value={line.unit} onChange={(e) => update(line.key, { unit: e.target.value as Unit })}>
                    {(Object.keys(UNIT_LABEL) as Unit[]).map((u) => (
                      <option key={u} value={u}>
                        {UNIT_LABEL[u]}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="ds-num">
                  <Input aria-label={`Prix unitaire ligne ${index + 1}`} className="w-28 text-right" inputMode="decimal" value={line.price} onChange={(e) => update(line.key, { price: e.target.value })} placeholder="0,00" />
                </td>
                {!franchise && (
                  <td>
                    <Select aria-label={`TVA ligne ${index + 1}`} value={line.vatRateBps} onChange={(e) => update(line.key, { vatRateBps: Number(e.target.value) })}>
                      {VAT_RATES.map((r) => (
                        <option key={r} value={r}>
                          {r / 100} %
                        </option>
                      ))}
                    </Select>
                  </td>
                )}
                <td className="ds-num">
                  <Money cents={total} />
                </td>
                <td>
                  <div className="flex justify-end gap-0.5">
                    <Button size="sm" variant="ghost" icon={<ArrowUp className="size-3.5" />} aria-label="Monter" disabled={index === 0} onClick={() => move(index, -1)} />
                    <Button size="sm" variant="ghost" icon={<ArrowDown className="size-3.5" />} aria-label="Descendre" disabled={index === lines.length - 1} onClick={() => move(index, 1)} />
                    <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} aria-label="Supprimer la ligne" onClick={() => onChange(lines.filter((l) => l.key !== line.key))} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {!readOnly && (
        <Button size="sm" className="mt-2" icon={<Plus className="size-4" />} onClick={() => onChange([...lines, emptyLine(defaultVat)])}>
          Ajouter une ligne
        </Button>
      )}
    </div>
  )
}

export function TotalsBox({ ht, vat, ttc, vatByRate, franchise, paid }: { ht: number; vat: number; ttc: number; vatByRate?: VatBucket[]; franchise: boolean; paid?: number }) {
  return (
    <dl className="ms-num ml-auto grid h-fit w-full max-w-xs grid-cols-[1fr_auto] content-start gap-y-1.5 text-sm">
      <dt className="text-muted">Total HT</dt>
      <dd className="pl-6 text-right">{euros(ht)}</dd>
      {franchise && vat === 0 ? (
        <>
          <dt className="text-muted">TVA</dt>
          <dd className="text-right">non applicable</dd>
        </>
      ) : vatByRate && vatByRate.length > 0 ? (
        vatByRate.map((b) => (
          <div key={b.rateBps} className="contents">
            <dt className="text-muted">TVA {b.rateBps / 100} %</dt>
            <dd className="text-right">{euros(b.vatCents)}</dd>
          </div>
        ))
      ) : (
        <>
          <dt className="text-muted">TVA</dt>
          <dd className="text-right">{euros(vat)}</dd>
        </>
      )}
      <dt className="mt-0.5 border-t border-line pt-2 font-semibold">Total TTC</dt>
      <dd className="mt-0.5 border-t border-line pl-6 pt-2 text-right text-base font-semibold">{euros(ttc)}</dd>
      {paid !== undefined && paid !== 0 && (
        <>
          <dt className="text-muted">Encaissé</dt>
          <dd className="text-right">{euros(paid)}</dd>
          <dt className="font-semibold">Reste à payer</dt>
          <dd className="text-right font-semibold">{euros(ttc - paid)}</dd>
        </>
      )}
    </dl>
  )
}
