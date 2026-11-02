// Facture, avoir ou devis en HTML imprimable (A4) : « Imprimer › Enregistrer en PDF » depuis le navigateur.
// Toutes les chaînes passent par escapeHtml. Aucune ressource externe (police système, pas de CDN).
import { formatLongDate } from '../domain/dates.ts'
import { formatEuros, formatQuantity, formatRate, type VatBucket } from '../domain/money.ts'
import { escapeHtml as esc } from '../domain/reminders.ts'
import type { CompanySettings } from '../services/settings.ts'

const UNIT_LABELS: Record<string, string> = { DAY: 'jour', HOUR: 'heure', UNIT: 'unité', FLAT: 'forfait' }

export interface PrintableLine {
  label: string
  details: string
  unit: string
  quantity: number
  unitPriceCents: number
  vatRateBps: number
  totalHtCents: number
}

export interface PrintableDocument {
  kind: 'INVOICE' | 'CREDIT_NOTE' | 'QUOTE' | 'MALT_SUMMARY'
  number: string
  draft: boolean
  title: string
  issueDate: string | null
  dueDate?: string | null
  validUntil?: string | null
  serviceStart?: string | null
  serviceEnd?: string | null
  seller: CompanySettings
  client: { name: string; address: string | null; siren: string | null; vatNumber: string | null; contactName: string | null }
  lines: PrintableLine[]
  totalHtCents: number
  totalVatCents: number
  totalTtcCents: number
  vatByRate: VatBucket[]
  paidCents?: number
  notes: string
  legalMentions: string[]
  footer: string
  creditedNumber?: string | null
}

const KIND_TITLES: Record<PrintableDocument['kind'], string> = {
  INVOICE: 'Facture',
  CREDIT_NOTE: 'Avoir',
  QUOTE: 'Devis',
  MALT_SUMMARY: 'Récapitulatif de mission Malt',
}

function multiline(value: string | null | undefined): string {
  return esc(value ?? '').replace(/\n/g, '<br>')
}

export function renderDocumentHtml(doc: PrintableDocument): string {
  const title = KIND_TITLES[doc.kind]
  const seller = doc.seller
  const sellerIds = [
    seller.legalForm && !seller.name.includes(seller.legalForm) ? seller.legalForm : '',
    seller.siret ? `SIRET ${seller.siret}` : seller.siren ? `SIREN ${seller.siren}` : '',
    seller.vatNumber ? `TVA ${seller.vatNumber}` : '',
  ].filter(Boolean)
  const dates: string[] = []
  if (doc.issueDate) dates.push(`<div><span>Date</span><strong>${esc(formatLongDate(doc.issueDate))}</strong></div>`)
  if (doc.serviceStart && doc.serviceEnd) {
    const period = doc.serviceStart === doc.serviceEnd ? formatLongDate(doc.serviceStart) : `du ${formatLongDate(doc.serviceStart)} au ${formatLongDate(doc.serviceEnd)}`
    dates.push(`<div><span>Prestation</span><strong>${esc(period)}</strong></div>`)
  }
  if (doc.dueDate && doc.kind === 'INVOICE') dates.push(`<div><span>Échéance</span><strong>${esc(formatLongDate(doc.dueDate))}</strong></div>`)
  if (doc.validUntil) dates.push(`<div><span>Valable jusqu’au</span><strong>${esc(formatLongDate(doc.validUntil))}</strong></div>`)

  const rows = doc.lines
    .map(
      (l) => `<tr>
  <td><strong>${esc(l.label)}</strong>${l.details ? `<div class="muted">${multiline(l.details)}</div>` : ''}</td>
  <td class="num">${esc(formatQuantity(Math.round(l.quantity * 1000)))} ${esc(UNIT_LABELS[l.unit] ?? '')}${Math.abs(l.quantity) > 1 && l.unit !== 'FLAT' ? 's' : ''}</td>
  <td class="num">${esc(formatEuros(l.unitPriceCents))}</td>
  <td class="num">${esc(formatRate(l.vatRateBps))}</td>
  <td class="num">${esc(formatEuros(l.totalHtCents))}</td>
</tr>`,
    )
    .join('\n')
  const vatRows =
    seller.vatRegime === 'FRANCHISE' && doc.totalVatCents === 0
      ? `<tr><td>TVA</td><td class="num">0,00 €</td></tr>`
      : doc.vatByRate.map((b) => `<tr><td>TVA ${esc(formatRate(b.rateBps))} sur ${esc(formatEuros(b.baseCents))}</td><td class="num">${esc(formatEuros(b.vatCents))}</td></tr>`).join('')
  const paid = doc.paidCents ?? 0
  const balance = doc.totalTtcCents - paid
  const payment =
    doc.kind === 'INVOICE' && seller.iban
      ? `<section class="pay"><h3>Règlement</h3><p>Par virement : IBAN <strong>${esc(seller.iban)}</strong>${seller.bic ? ` · BIC ${esc(seller.bic)}` : ''}<br>Référence à rappeler : <strong>${esc(doc.number)}</strong></p></section>`
      : ''

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${esc(title)} ${esc(doc.number)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1d1f24; background: #f4f1ea; }
  .sheet { max-width: 210mm; margin: 24px auto; background: #fff; padding: 18mm 16mm; box-shadow: 0 10px 40px -20px rgba(0,0,0,.35); position: relative; }
  .bar { position: absolute; inset: 0 0 auto 0; height: 6px; background: #f59f00; }
  header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; }
  h1 { font-size: 26px; margin: 0; letter-spacing: -0.02em; }
  h1 small { display: block; font-size: 13px; font-weight: 500; color: #6b6f78; letter-spacing: 0; }
  h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #6b6f78; margin: 0 0 6px; }
  .muted { color: #6b6f78; font-size: 12px; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 28px 0 18px; }
  .party { border: 1px solid #ece7dc; border-radius: 10px; padding: 12px 14px; }
  .dates { display: flex; flex-wrap: wrap; gap: 8px 28px; margin: 0 0 18px; }
  .dates span { display: block; font-size: 11px; color: #6b6f78; text-transform: uppercase; letter-spacing: .06em; }
  .subject { font-size: 15px; font-weight: 600; margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #6b6f78; border-bottom: 2px solid #1d1f24; padding: 6px 8px; }
  td { padding: 9px 8px; border-bottom: 1px solid #ece7dc; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  th.num { text-align: right; }
  .totals { margin-left: auto; width: 320px; margin-top: 14px; }
  .totals td { border: 0; padding: 4px 8px; }
  .totals tr.ttc td { border-top: 2px solid #1d1f24; font-size: 16px; font-weight: 700; padding-top: 8px; }
  .totals tr.due td { color: #b54708; font-weight: 600; }
  .pay { margin-top: 22px; padding: 12px 14px; background: #fff8e6; border-radius: 10px; }
  .pay p { margin: 0; }
  .notes { margin-top: 18px; white-space: pre-wrap; }
  .legal { margin-top: 26px; font-size: 11px; color: #555a63; border-top: 1px solid #ece7dc; padding-top: 10px; }
  .legal p { margin: 2px 0; }
  .draft { position: absolute; top: 40%; left: 0; right: 0; text-align: center; font-size: 72px; font-weight: 800; color: rgba(245,159,0,.13); transform: rotate(-18deg); pointer-events: none; }
  .toolbar { max-width: 210mm; margin: 16px auto 0; display: flex; justify-content: flex-end; gap: 8px; }
  .toolbar button { font: inherit; border: 1px solid #d8d2c4; background: #fff; border-radius: 8px; padding: 6px 12px; cursor: pointer; }
  @media print { body { background: #fff; } .sheet { margin: 0; box-shadow: none; padding: 0; } .bar, .toolbar { display: none; } }
</style>
</head>
<body>
<div class="toolbar"><button type="button" onclick="window.print()">Imprimer / PDF</button></div>
<article class="sheet">
  <div class="bar"></div>
  ${doc.draft ? '<div class="draft">BROUILLON</div>' : ''}
  <header>
    <div>
      <h1>${esc(title)}<small>${esc(doc.number)}${doc.creditedNumber ? ` · annule la facture ${esc(doc.creditedNumber)}` : ''}</small></h1>
    </div>
    <div style="text-align:right">
      <strong>${esc(seller.name || 'Votre entreprise')}</strong><br>
      <span class="muted">${multiline(seller.address)}</span><br>
      <span class="muted">${esc(sellerIds.join(' · '))}</span><br>
      <span class="muted">${esc([seller.email, seller.phone].filter(Boolean).join(' · '))}</span>
    </div>
  </header>

  <div class="parties">
    <div class="party"><h3>Client</h3><strong>${esc(doc.client.name)}</strong>${doc.client.contactName ? `<br>À l’attention de ${esc(doc.client.contactName)}` : ''}<br><span class="muted">${multiline(doc.client.address)}</span>${doc.client.siren ? `<br><span class="muted">SIREN ${esc(doc.client.siren)}</span>` : ''}${doc.client.vatNumber ? `<br><span class="muted">TVA ${esc(doc.client.vatNumber)}</span>` : ''}</div>
    <div class="party"><h3>Références</h3><div class="dates">${dates.join('')}</div></div>
  </div>

  <p class="subject">${esc(doc.title)}</p>
  <table>
    <thead><tr><th>Désignation</th><th class="num">Quantité</th><th class="num">Prix unit. HT</th><th class="num">TVA</th><th class="num">Total HT</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5" class="muted">Aucune ligne</td></tr>'}</tbody>
  </table>

  <table class="totals">
    <tr><td>Total HT</td><td class="num">${esc(formatEuros(doc.totalHtCents))}</td></tr>
    ${vatRows}
    <tr class="ttc"><td>Total TTC</td><td class="num">${esc(formatEuros(doc.totalTtcCents))}</td></tr>
    ${doc.kind === 'INVOICE' && paid > 0 ? `<tr><td>Déjà réglé</td><td class="num">${esc(formatEuros(paid))}</td></tr><tr class="due"><td>Reste à payer</td><td class="num">${esc(formatEuros(balance))}</td></tr>` : ''}
  </table>

  ${payment}
  ${doc.notes ? `<div class="notes">${multiline(doc.notes)}</div>` : ''}
  <div class="legal">${doc.legalMentions.map((m) => `<p>${esc(m)}</p>`).join('')}${doc.footer ? `<p>${multiline(doc.footer)}</p>` : ''}</div>
</article>
</body>
</html>`
}
