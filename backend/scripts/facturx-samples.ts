// Produit des Factur-X d'exemple (fictifs) pour la validation : npm run facturx:samples -- <dossier>
// Cas couverts : franchise en base, assujetti à la TVA (20 % + 10 %, longue facture sur plusieurs pages), avoir.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { FacturxInvoice } from '../src/domain/facturx.ts'
import { buildFacturxPdf } from '../src/print/facturx-pdf.ts'

const out = path.resolve(process.argv[2] ?? 'facturx-samples')
mkdirSync(out, { recursive: true })

const seller = {
  name: 'Camille Martin EI',
  siren: '912345678',
  siret: '91234567800017',
  vatNumber: null,
  email: 'contact@camille-martin.example',
  phone: '06 12 34 56 78',
  address: '12 rue des Artisans\n69002 Lyon',
  iban: 'FR76 3000 6000 0112 3456 7890 189',
  bic: 'AGRIFRPP',
}
const buyer = { name: 'Studio Pixel & Co', siren: '834567890', vatNumber: 'FR12834567890', email: 'compta@pixelco.example', address: '3 place du Marché\n44000 Nantes', contactName: 'Hugo Lambert' }
const base = {
  issueDate: '2026-11-03',
  dueDate: '2026-12-03',
  serviceStart: '2026-10-01',
  serviceEnd: '2026-10-31',
  notes: '',
  paymentTermsDays: 30,
  latePenaltyText: 'pénalités au taux de trois fois le taux d’intérêt légal, exigibles dès le lendemain de l’échéance',
  recoveryFeeCents: 4000,
}

const samples: Record<string, FacturxInvoice> = {
  'franchise-F-2026-0001': {
    ...base,
    kind: 'INVOICE',
    number: 'F-2026-0001',
    title: 'Audit SEO et performance — octobre',
    vatRegime: 'FRANCHISE',
    seller,
    buyer,
    lines: [
      { label: 'Audit SEO technique', details: 'Crawl, Core Web Vitals, recommandations <priorisées> & chiffrées', unit: 'DAY', quantityMilli: 2500, unitPriceCents: 55_000, vatRateBps: 0 },
      { label: 'Atelier de restitution', details: '', unit: 'FLAT', quantityMilli: 1000, unitPriceCents: 30_000, vatRateBps: 0 },
    ],
  },
  'reel-F-2026-0002': {
    ...base,
    kind: 'INVOICE',
    number: 'F-2026-0002',
    title: 'Portail transporteurs — sprint 4',
    notes: 'Bon de commande client : BC-2026-118',
    vatRegime: 'REEL',
    seller: { ...seller, vatNumber: 'FR40912345678' },
    buyer,
    lines: [
      ...Array.from({ length: 34 }, (_, i) => ({
        label: `#${100 + i} Évolution du module de suivi des expéditions, lot ${i + 1}`,
        details: `${7 + (i % 3)} h du 0${(i % 9) + 1}/10/2026 au 1${i % 9}/10/2026`,
        unit: 'HOUR' as const,
        quantityMilli: 7250 + i * 125,
        unitPriceCents: 7_857,
        vatRateBps: 2000,
      })),
      { label: 'Formation des équipes (prestation éligible au taux réduit fictif)', details: '', unit: 'UNIT', quantityMilli: 3000, unitPriceCents: 33_333, vatRateBps: 1000 },
    ],
  },
  'avoir-A-2026-0001': {
    ...base,
    kind: 'CREDIT_NOTE',
    number: 'A-2026-0001',
    dueDate: '2026-11-03',
    title: 'Avoir sur la facture F-2026-0001',
    notes: 'Motif : erreur de taux journalier',
    vatRegime: 'FRANCHISE',
    seller,
    buyer,
    lines: [{ label: 'Audit SEO technique', details: '', unit: 'DAY', quantityMilli: -2500, unitPriceCents: 55_000, vatRateBps: 0 }],
    precedingInvoice: { number: 'F-2026-0001', issueDate: '2026-11-03' },
  },
}

for (const [name, invoice] of Object.entries(samples)) {
  const { pdf, xml } = await buildFacturxPdf(invoice, { createdAt: '2026-11-03T09:00:00Z' })
  writeFileSync(path.join(out, `${name}.pdf`), pdf)
  writeFileSync(path.join(out, `${name}.xml`), xml)
  console.log(`✔ ${name}.pdf (${Math.round(pdf.length / 1024)} Ko)`)
}

// Même chemin que l'application : facture créée, émise puis téléchargée par l'API (base en mémoire).
{
  const { buildApp } = await import('../src/app.ts')
  const { openDatabase } = await import('../src/db/client.ts')
  const { db, close } = openDatabase(':memory:')
  const app = await buildApp({ db, now: () => new Date('2026-11-03T09:00:00Z') })
  const call = async (method: 'GET' | 'POST' | 'PATCH', url: string, body?: object) =>
    app.inject({ method, url, payload: body, headers: { host: '127.0.0.1:3001' } })
  await call('PATCH', '/api/settings', { company: { name: seller.name, siren: seller.siren, siret: seller.siret, address: seller.address, email: seller.email, iban: seller.iban, bic: seller.bic } })
  const client = JSON.parse((await call('POST', '/api/clients', { name: buyer.name, address: buyer.address, siren: buyer.siren, email: buyer.email, contactName: buyer.contactName })).body)
  const invoice = JSON.parse(
    (await call('POST', '/api/invoices', { clientId: client.id, title: 'Prestations d’octobre', serviceStart: '2026-10-01', serviceEnd: '2026-10-31', lines: [{ label: 'Développement', details: '10 h 30 du 01/10/2026 au 02/10/2026', unit: 'DAY', quantity: 1.5, unitPriceCents: 55_000, vatRateBps: 0 }] })).body,
  )
  await call('POST', `/api/invoices/${invoice.id}/issue`)
  const cancel = JSON.parse((await call('POST', `/api/invoices/${invoice.id}/cancel`, { reason: 'Erreur de client' })).body)
  for (const [name, id] of [['api-F-2026-0001', invoice.id], ['api-A-2026-0001', cancel.creditNoteId]] as const) {
    const res = await call('GET', `/api/invoices/${id}/facturx.pdf`)
    if (res.statusCode !== 200) throw new Error(`${name} : HTTP ${res.statusCode} ${res.body}`)
    writeFileSync(path.join(out, `${name}.pdf`), res.rawPayload)
    console.log(`✔ ${name}.pdf (API)`)
  }
  await app.close()
  close()
}
