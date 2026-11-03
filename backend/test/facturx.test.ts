// Factur-X : XML CII EN 16931 (structure et montants) et PDF/A-3 avec factur-x.xml associé.
// La conformité complète (XSD, schématron EN 16931, PDF/A-3b via veraPDF) est vérifiée par scripts/validate-facturx.sh.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PDFDict, PDFDocument, PDFName, PDFArray } from 'pdf-lib'
import { parseAddress } from '../src/domain/address.ts'
import { amount, buildFacturxXml, type FacturxInvoice } from '../src/domain/facturx.ts'
import { COMPANY, testApp } from './helpers.ts'

const invoice: FacturxInvoice = {
  kind: 'INVOICE',
  number: 'F-2026-0007',
  issueDate: '2026-11-03',
  dueDate: '2026-12-03',
  serviceStart: '2026-10-01',
  serviceEnd: '2026-10-31',
  title: 'Audit & <recommandations>',
  notes: '',
  vatRegime: 'FRANCHISE',
  seller: { name: 'Camille Martin EI', siren: '912 345 678', siret: '91234567800017', vatNumber: null, email: 'c@example.com', address: '12 rue des Artisans\n69002 Lyon', iban: 'FR76 3000 6000 0112 3456 7890 189', bic: null },
  buyer: { name: 'Pixel', siren: '834567890', vatNumber: null, email: null, address: '3 place du Marché\n44000 Nantes' },
  lines: [
    { label: 'Audit', details: '', unit: 'DAY', quantityMilli: 2500, unitPriceCents: 55_000, vatRateBps: 0 },
    { label: 'Atelier', details: '', unit: 'FLAT', quantityMilli: 1000, unitPriceCents: 30_000, vatRateBps: 0 },
  ],
  paymentTermsDays: 30,
  latePenaltyText: 'trois fois le taux légal',
  recoveryFeeCents: 4000,
}

describe('adresse', () => {
  it('sépare lignes, code postal, ville et pays', () => {
    assert.deepEqual(parseAddress('12 rue des Artisans\n69002 Lyon'), { lines: ['12 rue des Artisans'], postcode: '69002', city: 'Lyon', countryCode: 'FR' })
    assert.deepEqual(parseAddress('Rue Haute 5\n1000 Bruxelles\nBelgique'), { lines: ['Rue Haute 5'], postcode: '1000', city: 'Bruxelles', countryCode: 'BE' })
    assert.deepEqual(parseAddress(null), { lines: [], postcode: null, city: null, countryCode: 'FR' })
  })
})

describe('XML Factur-X EN 16931', () => {
  const xml = buildFacturxXml(invoice)
  it('annonce le profil EN 16931 et le type facture', () => {
    assert.match(xml, /<ram:ID>urn:cen\.eu:en16931:2017<\/ram:ID>/)
    assert.match(xml, /<ram:TypeCode>380<\/ram:TypeCode>/)
    assert.match(xml, /<udt:DateTimeString format="102">20261103<\/udt:DateTimeString>/)
  })
  it('déclare la franchise en base (catégorie E, VATEX-FR-FRANCHISE, SIREN en identifiant fiscal)', () => {
    assert.match(xml, /<ram:ExemptionReason>TVA non applicable, art\. 293 B du CGI<\/ram:ExemptionReason><ram:BasisAmount>1675\.00<\/ram:BasisAmount><ram:CategoryCode>E<\/ram:CategoryCode><ram:ExemptionReasonCode>VATEX-FR-FRANCHISE<\/ram:ExemptionReasonCode>/)
    assert.match(xml, /<ram:ID schemeID="FC">912345678<\/ram:ID>/)
    assert.match(xml, /<ram:ID schemeID="0002">912345678<\/ram:ID>/)
  })
  it('totalise sans TVA et structure l’adresse', () => {
    assert.match(xml, /<ram:LineTotalAmount>1375\.00<\/ram:LineTotalAmount>/)
    assert.match(xml, /<ram:TaxTotalAmount currencyID="EUR">0\.00<\/ram:TaxTotalAmount><ram:GrandTotalAmount>1675\.00<\/ram:GrandTotalAmount><ram:DuePayableAmount>1675\.00/)
    assert.match(xml, /<ram:PostcodeCode>69002<\/ram:PostcodeCode><ram:LineOne>12 rue des Artisans<\/ram:LineOne><ram:CityName>Lyon<\/ram:CityName><ram:CountryID>FR<\/ram:CountryID>/)
    assert.match(xml, /<ram:BilledQuantity unitCode="DAY">2\.500<\/ram:BilledQuantity>/)
    assert.match(xml, /<ram:IBANID>FR7630006000011234567890189<\/ram:IBANID>/)
  })
  it('échappe les données et ne laisse aucun caractère de contrôle', () => {
    assert.match(xml, /Audit &amp; &lt;recommandations&gt;/)
    assert.ok(!buildFacturxXml({ ...invoice, title: 'a\u0001b' }).includes('\u0001'))
  })
  it('calcule la TVA par taux pour un assujetti', () => {
    const reel = buildFacturxXml({ ...invoice, vatRegime: 'REEL', seller: { ...invoice.seller, vatNumber: 'FR40912345678' }, lines: invoice.lines.map((l) => ({ ...l, vatRateBps: 2000 })) })
    assert.match(reel, /<ram:CalculatedAmount>335\.00<\/ram:CalculatedAmount><ram:TypeCode>VAT<\/ram:TypeCode><ram:BasisAmount>1675\.00<\/ram:BasisAmount><ram:CategoryCode>S<\/ram:CategoryCode><ram:RateApplicablePercent>20\.00/)
    assert.match(reel, /<ram:GrandTotalAmount>2010\.00<\/ram:GrandTotalAmount>/)
    assert.match(reel, /<ram:ID schemeID="VA">FR40912345678<\/ram:ID>/)
  })
  it('produit un avoir 381 en montants positifs, lié à la facture annulée', () => {
    const credit = buildFacturxXml({ ...invoice, kind: 'CREDIT_NOTE', number: 'A-2026-0001', lines: [{ ...invoice.lines[0]!, quantityMilli: -2500 }], precedingInvoice: { number: 'F-2026-0007', issueDate: '2026-11-03' } })
    assert.match(credit, /<ram:TypeCode>381<\/ram:TypeCode>/)
    assert.match(credit, /<ram:GrandTotalAmount>1375\.00<\/ram:GrandTotalAmount>/)
    assert.match(credit, /<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>F-2026-0007<\/ram:IssuerAssignedID>/)
    assert.equal(amount(-5), '-0.05')
  })
})

describe('PDF Factur-X depuis l’API', () => {
  it('sert un PDF/A-3 avec factur-x.xml en fichier associé (/AF, /Data) ; refuse brouillon et Malt', async () => {
    const t = await testApp()
    try {
      await t.api('PATCH', '/api/settings', COMPANY)
      const client = (await t.api('POST', '/api/clients', { name: 'Pixel', address: '3 place du Marché\n44000 Nantes' })).body
      const draft = (await t.api('POST', '/api/invoices', { clientId: client.id, title: 'Audit', lines: [{ label: 'Audit', unit: 'DAY', quantity: 2, unitPriceCents: 50_000, vatRateBps: 0 }] })).body
      const tooEarly = await t.api('GET', `/api/invoices/${draft.id}/facturx.xml`)
      assert.equal(tooEarly.status, 409)
      assert.equal(tooEarly.body.code, 'FACTURX_DRAFT')
      await t.api('POST', `/api/invoices/${draft.id}/issue`)

      const res = await t.app.inject({ method: 'GET', url: `/api/invoices/${draft.id}/facturx.pdf`, headers: { host: '127.0.0.1:3001' } })
      assert.equal(res.statusCode, 200)
      assert.equal(res.headers['content-type'], 'application/pdf')
      assert.match(String(res.headers['content-disposition']), /F-2026-0001\.pdf/)
      const pdf = await PDFDocument.load(res.rawPayload, { updateMetadata: false })
      const af = pdf.catalog.lookup(PDFName.of('AF'), PDFArray)
      const spec = af.lookup(0, PDFDict)
      assert.equal(spec.get(PDFName.of('AFRelationship'))?.toString(), '/Data')
      assert.ok(pdf.catalog.get(PDFName.of('OutputIntents')))
      assert.ok(pdf.catalog.get(PDFName.of('Metadata')))
      assert.equal(pdf.getTitle(), 'Facture F-2026-0001')
      // Déterministe : deux téléchargements identiques.
      const again = await t.app.inject({ method: 'GET', url: `/api/invoices/${draft.id}/facturx.pdf`, headers: { host: '127.0.0.1:3001' } })
      assert.deepEqual(again.rawPayload, res.rawPayload)

      const xml = await t.app.inject({ method: 'GET', url: `/api/invoices/${draft.id}/facturx.xml`, headers: { host: '127.0.0.1:3001' } })
      assert.match(xml.body, /<ram:ID>F-2026-0001<\/ram:ID>/)

      const malt = (await t.api('POST', '/api/clients', { name: 'Bellevue', channel: 'MALT' })).body
      const maltInvoice = (await t.api('POST', '/api/invoices', { clientId: malt.id, title: 'Sprint', lines: [{ label: 'Jour', unit: 'DAY', quantity: 1, unitPriceCents: 50_000, vatRateBps: 0 }] })).body
      await t.api('POST', `/api/invoices/${maltInvoice.id}/issue`, { externalRef: 'M-1' })
      assert.equal((await t.api('GET', `/api/invoices/${maltInvoice.id}/facturx.xml`)).body.code, 'FACTURX_MALT')
    } finally {
      await t.close()
    }
  })

  it('refuse d’émettre une ligne taxée quand le vendeur est en franchise', async () => {
    const t = await testApp()
    try {
      await t.api('PATCH', '/api/settings', COMPANY)
      const client = (await t.api('POST', '/api/clients', { name: 'Pixel', address: 'Nantes' })).body
      const draft = (await t.api('POST', '/api/invoices', { clientId: client.id, title: 'X', lines: [{ label: 'Jour', unit: 'DAY', quantity: 1, unitPriceCents: 50_000, vatRateBps: 2000 }] })).body
      const res = await t.api('POST', `/api/invoices/${draft.id}/issue`)
      assert.equal(res.status, 400)
      assert.match(res.body.detail, /franchise en base/)
    } finally {
      await t.close()
    }
  })
})
