// Factur-X : XML CII (UN/CEFACT Cross Industry Invoice D16B), profil EN 16931, d'une facture ou d'un avoir émis.
// Fonction pure et déterministe : même facture → même XML. Le PDF/A-3 qui l'embarque est construit dans print/facturx-pdf.ts.
//
// Choix de modélisation (vérifiés avec le validateur Mustang : XSD Factur-X + schématron EN 16931) :
// - franchise en base : catégorie de TVA « E », code d'exonération VATEX-FR-FRANCHISE et motif « TVA non applicable,
//   art. 293 B du CGI » ; sans n° de TVA, le SIREN sert d'identifiant fiscal du vendeur (BT-32, schemeID « FC ») —
//   la règle BR-E-02 exige BT-31 ou BT-32 dès qu'une ligne est exonérée ;
// - avoir : TypeCode 381, montants positifs, référence à la facture annulée (BT-25 / BT-26) ;
// - le document décrit la facture telle qu'émise : les encaissements ultérieurs n'y figurent pas (montant dû = TTC).
import type { Unit } from '../db/schema.ts'
import { parseAddress, type PostalAddress } from './address.ts'
import type { VatRegime } from './invoicing.ts'
import { computeTotals, lineTotalCents } from './money.ts'

export const FACTURX_GUIDELINE = 'urn:cen.eu:en16931:2017'
export const FACTURX_CONFORMANCE_LEVEL = 'EN 16931'
export const FACTURX_FILENAME = 'factur-x.xml'
export const FRANCHISE_REASON = 'TVA non applicable, art. 293 B du CGI'

export interface FxParty {
  name: string
  siren: string | null
  siret?: string | null
  vatNumber: string | null
  email: string | null
  address: string | null
  contactName?: string | null
  phone?: string | null
}

export interface FxLine {
  label: string
  details: string
  unit: Unit
  quantityMilli: number
  unitPriceCents: number
  vatRateBps: number
}

export interface FacturxInvoice {
  kind: 'INVOICE' | 'CREDIT_NOTE'
  number: string
  issueDate: string
  dueDate: string | null
  serviceStart: string | null
  serviceEnd: string | null
  title: string
  notes: string
  vatRegime: VatRegime
  seller: FxParty & { iban: string | null; bic: string | null }
  buyer: FxParty
  lines: FxLine[]
  paymentTermsDays: number
  latePenaltyText: string
  recoveryFeeCents: number
  /** Avoir : facture annulée. */
  precedingInvoice?: { number: string; issueDate: string | null } | null
}

const UNIT_CODES: Record<Unit, string> = { DAY: 'DAY', HOUR: 'HUR', UNIT: 'C62', FLAT: 'LS' }

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }
export function xmlEscape(value: string): string {
  // Caractères de contrôle interdits en XML 1.0 retirés (saisie copiée-collée).
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c)
}

/** Centimes → « 1925.00 » (point décimal, deux décimales, jamais « -0.00 »). */
export function amount(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(Math.round(cents))
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

function quantity(milli: number): string {
  const abs = Math.abs(milli)
  return `${milli < 0 ? '-' : ''}${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, '0')}`
}

function rate(bps: number): string {
  return (bps / 100).toFixed(2)
}

const date102 = (iso: string) => iso.replaceAll('-', '')

export interface VatCategory {
  code: 'S' | 'E' | 'Z'
  exemptionReason: string | null
  exemptionCode: string | null
}

export function vatCategory(regime: VatRegime, rateBps: number): VatCategory {
  if (regime === 'FRANCHISE') return { code: 'E', exemptionReason: FRANCHISE_REASON, exemptionCode: 'VATEX-FR-FRANCHISE' }
  return rateBps > 0 ? { code: 'S', exemptionReason: null, exemptionCode: null } : { code: 'Z', exemptionReason: null, exemptionCode: null }
}

function el(name: string, value: string | null | undefined, attrs = ''): string {
  if (value === null || value === undefined || value === '') return ''
  return `<${name}${attrs}>${xmlEscape(value)}</${name}>`
}

function addressXml(a: PostalAddress): string {
  return (
    '<ram:PostalTradeAddress>' +
    el('ram:PostcodeCode', a.postcode) +
    el('ram:LineOne', a.lines[0]) +
    el('ram:LineTwo', a.lines[1]) +
    el('ram:LineThree', a.lines[2]) +
    el('ram:CityName', a.city) +
    `<ram:CountryID>${a.countryCode}</ram:CountryID>` +
    '</ram:PostalTradeAddress>'
  )
}

const digits = (v: string | null | undefined) => (v ?? '').replace(/\s+/g, '') || null

function partyXml(tag: 'SellerTradeParty' | 'BuyerTradeParty', party: FxParty, taxRegistration: string): string {
  const siren = digits(party.siren) ?? (digits(party.siret)?.slice(0, 9) || null)
  const siret = digits(party.siret)
  const contact =
    party.contactName || party.phone
      ? '<ram:DefinedTradeContact>' +
        el('ram:PersonName', party.contactName) +
        (party.phone ? `<ram:TelephoneUniversalCommunication>${el('ram:CompleteNumber', party.phone)}</ram:TelephoneUniversalCommunication>` : '') +
        '</ram:DefinedTradeContact>'
      : ''
  return (
    `<ram:${tag}>` +
    (siret ? `<ram:GlobalID schemeID="0009">${xmlEscape(siret)}</ram:GlobalID>` : '') +
    el('ram:Name', party.name) +
    (siren ? `<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${xmlEscape(siren)}</ram:ID></ram:SpecifiedLegalOrganization>` : '') +
    contact +
    addressXml(parseAddress(party.address)) +
    (party.email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${xmlEscape(party.email)}</ram:URIID></ram:URIUniversalCommunication>` : '') +
    taxRegistration +
    `</ram:${tag}>`
  )
}

/** Montants du document (positifs, y compris pour un avoir) et ventilation de TVA. */
export function facturxTotals(invoice: Pick<FacturxInvoice, 'lines' | 'vatRegime'>) {
  // En franchise, aucune TVA n'est due : les lignes sont ramenées à 0 % (l'émission refuse déjà toute ligne taxée).
  const lines = invoice.lines.map((l) => ({ ...l, quantityMilli: Math.abs(l.quantityMilli), vatRateBps: invoice.vatRegime === 'FRANCHISE' ? 0 : l.vatRateBps }))
  return { lines, totals: computeTotals(lines) }
}

export function buildFacturxXml(invoice: FacturxInvoice): string {
  const { lines, totals } = facturxTotals(invoice)
  const sellerVat = digits(invoice.seller.vatNumber)
  const sellerSiren = digits(invoice.seller.siren) ?? (digits(invoice.seller.siret)?.slice(0, 9) || null)
  const sellerTax = sellerVat
    ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${xmlEscape(sellerVat)}</ram:ID></ram:SpecifiedTaxRegistration>`
    : sellerSiren
      ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${xmlEscape(sellerSiren)}</ram:ID></ram:SpecifiedTaxRegistration>`
      : ''
  const buyerVat = digits(invoice.buyer.vatNumber)
  const buyerTax = buyerVat ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${xmlEscape(buyerVat)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''

  const notes: { content: string; subject?: string }[] = []
  if (invoice.title.trim()) notes.push({ content: invoice.title.trim() })
  if (invoice.notes.trim()) notes.push({ content: invoice.notes.trim() })
  if (invoice.kind === 'INVOICE') {
    notes.push({ content: `En cas de retard de paiement : ${invoice.latePenaltyText}`, subject: 'PMD' })
    notes.push({
      content: `Indemnité forfaitaire pour frais de recouvrement en cas de retard : ${(invoice.recoveryFeeCents / 100).toLocaleString('fr-FR')} € (art. L441-10 du Code de commerce).`,
      subject: 'PMT',
    })
    notes.push({ content: 'Pas d’escompte pour paiement anticipé.', subject: 'AAB' })
  }

  const lineItems = lines
    .map((line, index) => {
      const category = vatCategory(invoice.vatRegime, line.vatRateBps)
      const lineTotal = lineTotalCents(line.quantityMilli, line.unitPriceCents)
      return (
        '<ram:IncludedSupplyChainTradeLineItem>' +
        `<ram:AssociatedDocumentLineDocument><ram:LineID>${index + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>` +
        `<ram:SpecifiedTradeProduct>${el('ram:Name', line.label)}${el('ram:Description', line.details)}</ram:SpecifiedTradeProduct>` +
        `<ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${amount(line.unitPriceCents)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>` +
        `<ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${UNIT_CODES[line.unit]}">${quantity(line.quantityMilli)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>` +
        '<ram:SpecifiedLineTradeSettlement>' +
        `<ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${category.code}</ram:CategoryCode><ram:RateApplicablePercent>${rate(category.code === 'E' ? 0 : line.vatRateBps)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>` +
        `<ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${amount(lineTotal)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>` +
        '</ram:SpecifiedLineTradeSettlement>' +
        '</ram:IncludedSupplyChainTradeLineItem>'
      )
    })
    .join('')

  const taxes = totals.byRate
    .map((bucket) => {
      const category = vatCategory(invoice.vatRegime, bucket.rateBps)
      return (
        '<ram:ApplicableTradeTax>' +
        `<ram:CalculatedAmount>${amount(category.code === 'E' ? 0 : bucket.vatCents)}</ram:CalculatedAmount>` +
        '<ram:TypeCode>VAT</ram:TypeCode>' +
        el('ram:ExemptionReason', category.exemptionReason) +
        `<ram:BasisAmount>${amount(bucket.baseCents)}</ram:BasisAmount>` +
        `<ram:CategoryCode>${category.code}</ram:CategoryCode>` +
        el('ram:ExemptionReasonCode', category.exemptionCode) +
        `<ram:RateApplicablePercent>${rate(category.code === 'E' ? 0 : bucket.rateBps)}</ram:RateApplicablePercent>` +
        '</ram:ApplicableTradeTax>'
      )
    })
    .join('')
  const vatTotal = invoice.vatRegime === 'FRANCHISE' ? 0 : totals.vatCents
  const grandTotal = totals.htCents + vatTotal

  const iban = digits(invoice.seller.iban)
  const paymentMeans = iban
    ? '<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode><ram:Information>Virement SEPA</ram:Information>' +
      `<ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${xmlEscape(iban)}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>` +
      (invoice.seller.bic ? `<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${xmlEscape(digits(invoice.seller.bic)!)}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : '') +
      '</ram:SpecifiedTradeSettlementPaymentMeans>'
    : ''
  const period =
    invoice.serviceStart && invoice.serviceEnd
      ? `<ram:BillingSpecifiedPeriod><ram:StartDateTime><udt:DateTimeString format="102">${date102(invoice.serviceStart)}</udt:DateTimeString></ram:StartDateTime><ram:EndDateTime><udt:DateTimeString format="102">${date102(invoice.serviceEnd)}</udt:DateTimeString></ram:EndDateTime></ram:BillingSpecifiedPeriod>`
      : ''
  // BR-CO-25 : un montant dû positif exige une échéance ou des conditions de paiement (y compris pour un avoir).
  const terms =
    invoice.kind === 'INVOICE'
      ? '<ram:SpecifiedTradePaymentTerms>' +
        el('ram:Description', invoice.paymentTermsDays > 0 ? `Paiement à ${invoice.paymentTermsDays} jours${iban ? ', par virement' : ''}` : `Paiement à réception${iban ? ', par virement' : ''}`) +
        (invoice.dueDate ? `<ram:DueDateDateTime><udt:DateTimeString format="102">${date102(invoice.dueDate)}</udt:DateTimeString></ram:DueDateDateTime>` : '') +
        '</ram:SpecifiedTradePaymentTerms>'
      : '<ram:SpecifiedTradePaymentTerms>' +
        el('ram:Description', invoice.precedingInvoice ? `Avoir à déduire de la facture ${invoice.precedingInvoice.number}` : 'Avoir à déduire du prochain règlement') +
        '</ram:SpecifiedTradePaymentTerms>'
  // BT-72 : date de réalisation de la prestation (fin de période, sinon date de facture) — mention obligatoire en France.
  const deliveryDate = invoice.serviceEnd ?? invoice.issueDate
  const preceding = invoice.precedingInvoice
    ? '<ram:InvoiceReferencedDocument>' +
      el('ram:IssuerAssignedID', invoice.precedingInvoice.number) +
      (invoice.precedingInvoice.issueDate
        ? `<ram:FormattedIssueDateTime><qdt:DateTimeString format="102">${date102(invoice.precedingInvoice.issueDate)}</qdt:DateTimeString></ram:FormattedIssueDateTime>`
        : '') +
      '</ram:InvoiceReferencedDocument>'
    : ''

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">' +
    '<rsm:ExchangedDocumentContext>' +
    '<ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>S1</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>' +
    `<ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${FACTURX_GUIDELINE}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>` +
    '</rsm:ExchangedDocumentContext>' +
    '<rsm:ExchangedDocument>' +
    el('ram:ID', invoice.number) +
    `<ram:TypeCode>${invoice.kind === 'CREDIT_NOTE' ? '381' : '380'}</ram:TypeCode>` +
    `<ram:IssueDateTime><udt:DateTimeString format="102">${date102(invoice.issueDate)}</udt:DateTimeString></ram:IssueDateTime>` +
    notes.map((n) => `<ram:IncludedNote>${el('ram:Content', n.content)}${el('ram:SubjectCode', n.subject)}</ram:IncludedNote>`).join('') +
    '</rsm:ExchangedDocument>' +
    '<rsm:SupplyChainTradeTransaction>' +
    lineItems +
    '<ram:ApplicableHeaderTradeAgreement>' +
    partyXml('SellerTradeParty', invoice.seller, sellerTax) +
    partyXml('BuyerTradeParty', invoice.buyer, buyerTax) +
    '</ram:ApplicableHeaderTradeAgreement>' +
    `<ram:ApplicableHeaderTradeDelivery><ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${date102(deliveryDate)}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent></ram:ApplicableHeaderTradeDelivery>` +
    '<ram:ApplicableHeaderTradeSettlement>' +
    el('ram:PaymentReference', invoice.number) +
    '<ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>' +
    paymentMeans +
    taxes +
    period +
    terms +
    '<ram:SpecifiedTradeSettlementHeaderMonetarySummation>' +
    `<ram:LineTotalAmount>${amount(totals.htCents)}</ram:LineTotalAmount>` +
    `<ram:TaxBasisTotalAmount>${amount(totals.htCents)}</ram:TaxBasisTotalAmount>` +
    `<ram:TaxTotalAmount currencyID="EUR">${amount(vatTotal)}</ram:TaxTotalAmount>` +
    `<ram:GrandTotalAmount>${amount(grandTotal)}</ram:GrandTotalAmount>` +
    `<ram:DuePayableAmount>${amount(grandTotal)}</ram:DuePayableAmount>` +
    '</ram:SpecifiedTradeSettlementHeaderMonetarySummation>' +
    preceding +
    '</ram:ApplicableHeaderTradeSettlement>' +
    '</rsm:SupplyChainTradeTransaction>' +
    '</rsm:CrossIndustryInvoice>\n'
  )
}
