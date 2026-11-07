// Facture Factur-X : PDF/A-3b lisible + XML CII EN 16931 embarqué (factur-x.xml, /AFRelationship /Data).
// Exigences PDF/A-3 couvertes ici : polices incorporées (DejaVu Sans, en sous-ensemble), profil sRGB en OutputIntent,
// métadonnées XMP (pdfaid + schéma d'extension Factur-X) cohérentes avec le dictionnaire Info, identifiant de fichier,
// fichier associé déclaré dans /AF du catalogue. Contrôle : scripts/validate-facturx.sh (validateur Mustang / veraPDF).
// Sortie déterministe : mêmes données → mêmes octets (dates tirées de l'émission, identifiant dérivé du contenu).
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, PDFHexString, PDFName, PDFString, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { BACKEND_ROOT } from '../config.ts'
import { formatLongDate } from '../domain/dates.ts'
import { buildFacturxXml, FACTURX_CONFORMANCE_LEVEL, FACTURX_FILENAME, facturxTotals, FRANCHISE_REASON, type FacturxInvoice } from '../domain/facturx.ts'
import { formatEuros, formatQuantity, formatRate, lineTotalCents } from '../domain/money.ts'

const ASSETS = path.join(BACKEND_ROOT, 'assets')
let assets: { regular: Uint8Array; bold: Uint8Array; icc: Uint8Array } | null = null
function loadAssets() {
  assets ??= {
    regular: readFileSync(path.join(ASSETS, 'fonts', 'DejaVuSans.ttf')),
    bold: readFileSync(path.join(ASSETS, 'fonts', 'DejaVuSans-Bold.ttf')),
    icc: readFileSync(path.join(ASSETS, 'icc', 'sRGB-lcms.icc')),
  }
  return assets
}

const PRODUCER = 'Atelier Mission (pdf-lib)'
const UNIT_LABELS: Record<string, [string, string]> = { DAY: ['jour', 'jours'], HOUR: ['heure', 'heures'], UNIT: ['unité', 'unités'], FLAT: ['forfait', 'forfaits'] }

// Encre, gris et traits de la structure crème de la suite (#1f1b16, #5f574b, #e4dac8) ; la page reste blanche.
const INK = rgb(0.122, 0.106, 0.086)
const MUTED = rgb(0.373, 0.341, 0.294)
const LINE = rgb(0.894, 0.855, 0.784)
const AMBER = rgb(0.961, 0.624, 0)
const AMBER_SOFT = rgb(1, 0.973, 0.902)

const xmlText = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

function xmpPacket(meta: { title: string; author: string; subject: string; created: string }) {
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
   <pdfaid:part>3</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:format>application/pdf</dc:format>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlText(meta.title)}</rdf:li></rdf:Alt></dc:title>
   <dc:creator><rdf:Seq><rdf:li>${xmlText(meta.author)}</rdf:li></rdf:Seq></dc:creator>
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlText(meta.subject)}</rdf:li></rdf:Alt></dc:description>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdf:Producer>${PRODUCER}</pdf:Producer>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <xmp:CreatorTool>${PRODUCER}</xmp:CreatorTool>
   <xmp:CreateDate>${meta.created}</xmp:CreateDate>
   <xmp:ModifyDate>${meta.created}</xmp:ModifyDate>
   <xmp:MetadataDate>${meta.created}</xmp:MetadataDate>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
   <fx:DocumentType>INVOICE</fx:DocumentType>
   <fx:DocumentFileName>${FACTURX_FILENAME}</fx:DocumentFileName>
   <fx:Version>1.0</fx:Version>
   <fx:ConformanceLevel>${FACTURX_CONFORMANCE_LEVEL}</fx:ConformanceLevel>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
   <pdfaExtension:schemas>
    <rdf:Bag>
     <rdf:li rdf:parseType="Resource">
      <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
      <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
      <pdfaSchema:prefix>fx</pdfaSchema:prefix>
      <pdfaSchema:property>
       <rdf:Seq>
        <rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentFileName</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>name of the embedded XML invoice file</pdfaProperty:description></rdf:li>
        <rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentType</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>INVOICE</pdfaProperty:description></rdf:li>
        <rdf:li rdf:parseType="Resource"><pdfaProperty:name>Version</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The actual version of the Factur-X XML schema</pdfaProperty:description></rdf:li>
        <rdf:li rdf:parseType="Resource"><pdfaProperty:name>ConformanceLevel</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The conformance level of the embedded Factur-X data</pdfaProperty:description></rdf:li>
       </rdf:Seq>
      </pdfaSchema:property>
     </rdf:li>
    </rdf:Bag>
   </pdfaExtension:schemas>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
}

/** Découpe un texte en lignes tenant dans `width` points (mots, puis caractères pour un mot trop long). */
export function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate
        continue
      }
      if (line) out.push(line)
      line = word
      while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
        let cut = line.length - 1
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut -= 1
        out.push(line.slice(0, cut))
        line = line.slice(cut)
      }
    }
    out.push(line)
  }
  return out
}

export interface FacturxDocument {
  pdf: Uint8Array
  xml: string
}

export async function buildFacturxPdf(invoice: FacturxInvoice, options: { createdAt: string }): Promise<FacturxDocument> {
  const xml = buildFacturxXml(invoice)
  const { regular, bold, icc } = loadAssets()
  const doc = await PDFDocument.create({ updateMetadata: false })
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(regular, { subset: true })
  const fontBold = await doc.embedFont(bold, { subset: true })

  const W = 595.28
  const H = 841.89
  const M = 48
  const CONTENT = W - 2 * M
  let page: PDFPage = doc.addPage([W, H])
  let y = H - M
  const pages: PDFPage[] = [page]

  const text = (value: string, x: number, yy: number, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: 'left' | 'right'; p?: PDFPage } = {}) => {
    const size = opts.size ?? 9
    const f = opts.bold ? fontBold : font
    const dx = opts.align === 'right' ? f.widthOfTextAtSize(value, size) : 0
    ;(opts.p ?? page).drawText(value, { x: x - dx, y: yy, size, font: f, color: opts.color ?? INK })
  }
  const newPage = () => {
    page = doc.addPage([W, H])
    pages.push(page)
    y = H - M
  }
  const ensure = (needed: number) => {
    if (y - needed < M + 24) newPage()
  }

  const docTitle = invoice.kind === 'CREDIT_NOTE' ? 'Avoir' : 'Facture'
  const seller = invoice.seller

  // Bandeau ambre + en-tête
  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: AMBER })
  text(docTitle, M, y - 18, { size: 22, bold: true })
  text(invoice.number, M, y - 34, { size: 10, color: MUTED })
  if (invoice.precedingInvoice) text(`Annule la facture ${invoice.precedingInvoice.number}`, M, y - 48, { size: 9, color: MUTED })
  const sellerIds = [seller.siret ? `SIRET ${seller.siret}` : seller.siren ? `SIREN ${seller.siren}` : '', seller.vatNumber ? `TVA ${seller.vatNumber}` : ''].filter(Boolean).join(' · ')
  const sellerLines = [...(seller.address ?? '').split(/\r?\n/).filter(Boolean), sellerIds, [seller.email, seller.phone].filter(Boolean).join(' · ')].filter(Boolean)
  text(seller.name, W - M, y - 10, { bold: true, size: 10, align: 'right' })
  sellerLines.forEach((l, i) => text(l, W - M, y - 24 - i * 12, { size: 8.5, color: MUTED, align: 'right' }))
  y -= Math.max(64, 30 + sellerLines.length * 12)

  // Client et références
  const boxTop = y - 8
  const boxW = (CONTENT - 16) / 2
  const buyer = invoice.buyer
  const buyerLines = [
    ...(buyer.contactName ? [`À l’attention de ${buyer.contactName}`] : []),
    ...(buyer.address ?? '').split(/\r?\n/).filter(Boolean),
    ...(buyer.siren ? [`SIREN ${buyer.siren}`] : []),
    ...(buyer.vatNumber ? [`TVA ${buyer.vatNumber}`] : []),
  ]
  const refs: [string, string][] = [['Date', formatLongDate(invoice.issueDate)]]
  if (invoice.serviceStart && invoice.serviceEnd) {
    refs.push(['Prestation', invoice.serviceStart === invoice.serviceEnd ? formatLongDate(invoice.serviceStart) : `du ${formatLongDate(invoice.serviceStart)} au ${formatLongDate(invoice.serviceEnd)}`])
  }
  if (invoice.dueDate && invoice.kind === 'INVOICE') refs.push(['Échéance', formatLongDate(invoice.dueDate)])
  const boxH = Math.max(32 + buyerLines.length * 11, 22 + refs.length * 22)
  for (const x of [M, M + boxW + 16]) page.drawRectangle({ x, y: boxTop - boxH, width: boxW, height: boxH, borderColor: LINE, borderWidth: 1 })
  text('CLIENT', M + 10, boxTop - 14, { size: 7, color: MUTED, bold: true })
  text(buyer.name, M + 10, boxTop - 27, { size: 9.5, bold: true })
  buyerLines.forEach((l, i) => text(l, M + 10, boxTop - 40 - i * 11, { size: 8.5, color: MUTED }))
  text('RÉFÉRENCES', M + boxW + 26, boxTop - 14, { size: 7, color: MUTED, bold: true })
  refs.forEach(([label, value], i) => {
    text(label, M + boxW + 26, boxTop - 27 - i * 22, { size: 7.5, color: MUTED })
    const v = wrapText(value, fontBold, 8.5, boxW - 20)[0] ?? ''
    text(v, M + boxW + 26, boxTop - 38 - i * 22, { size: 8.5, bold: true })
  })
  y = boxTop - boxH - 22

  // Objet
  for (const l of wrapText(invoice.title, fontBold, 11, CONTENT)) {
    text(l, M, y, { size: 11, bold: true })
    y -= 15
  }
  y -= 4

  // Tableau des lignes
  const cols = { label: M + 4, qty: M + CONTENT * 0.66, price: M + CONTENT * 0.82, total: W - M - 4 }
  const labelWidth = CONTENT * 0.5
  const tableHeader = () => {
    text('DÉSIGNATION', cols.label, y, { size: 7, bold: true, color: MUTED })
    text('QUANTITÉ', cols.qty, y, { size: 7, bold: true, color: MUTED, align: 'right' })
    text('PRIX UNIT. HT', cols.price, y, { size: 7, bold: true, color: MUTED, align: 'right' })
    text('TOTAL HT', cols.total, y, { size: 7, bold: true, color: MUTED, align: 'right' })
    y -= 6
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.2, color: INK })
    y -= 14
  }
  tableHeader()
  const { lines, totals } = facturxTotals(invoice)
  for (const line of lines) {
    const labelLines = wrapText(line.label, fontBold, 9, labelWidth)
    const detailLines = line.details ? wrapText(line.details, font, 8, labelWidth) : []
    const height = labelLines.length * 12 + detailLines.length * 10 + 10
    if (y - height < M + 24) {
      newPage()
      tableHeader()
    }
    const [one, many] = UNIT_LABELS[line.unit] ?? ['', '']
    text(`${formatQuantity(line.quantityMilli)} ${line.quantityMilli > 1000 ? many : one}`, cols.qty, y, { size: 9, align: 'right' })
    text(formatEuros(line.unitPriceCents), cols.price, y, { size: 9, align: 'right' })
    text(formatEuros(lineTotalCents(line.quantityMilli, line.unitPriceCents)), cols.total, y, { size: 9, align: 'right' })
    for (const l of labelLines) {
      text(l, cols.label, y, { size: 9, bold: true })
      y -= 12
    }
    for (const l of detailLines) {
      text(l, cols.label, y + 1, { size: 8, color: MUTED })
      y -= 10
    }
    y -= 2
    page.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 0.6, color: LINE })
    y -= 8
  }

  // Totaux
  const franchise = invoice.vatRegime === 'FRANCHISE'
  const totalRows: [string, string, boolean][] = [['Total HT', formatEuros(totals.htCents), false]]
  if (franchise) totalRows.push(['TVA', '0,00 €', false])
  else for (const b of totals.byRate) totalRows.push([`TVA ${formatRate(b.rateBps)} sur ${formatEuros(b.baseCents)}`, formatEuros(b.vatCents), false])
  totalRows.push([invoice.kind === 'CREDIT_NOTE' ? 'Total TTC de l’avoir' : 'Total TTC', formatEuros(totals.htCents + (franchise ? 0 : totals.vatCents)), true])
  ensure(totalRows.length * 16 + 20)
  const tx = W - M - 220
  for (const [label, value, strong] of totalRows) {
    if (strong) {
      page.drawLine({ start: { x: tx, y: y + 11 }, end: { x: W - M, y: y + 11 }, thickness: 1.2, color: INK })
      y -= 4
    }
    text(label, tx, y, { size: strong ? 11 : 9, bold: strong })
    text(value, W - M - 4, y, { size: strong ? 11 : 9, bold: strong, align: 'right' })
    y -= strong ? 20 : 15
  }

  // Règlement
  if (invoice.kind === 'INVOICE' && seller.iban) {
    ensure(52)
    y -= 6
    page.drawRectangle({ x: M, y: y - 34, width: CONTENT, height: 46, color: AMBER_SOFT })
    text('RÈGLEMENT', M + 10, y, { size: 7, bold: true, color: MUTED })
    text(`Par virement : IBAN ${seller.iban}${seller.bic ? ` · BIC ${seller.bic}` : ''}`, M + 10, y - 13, { size: 9 })
    text(`Référence à rappeler : ${invoice.number}`, M + 10, y - 26, { size: 9 })
    y -= 54
  }

  // Notes et mentions légales
  const mentions: string[] = []
  if (invoice.notes.trim()) mentions.push(invoice.notes.trim())
  if (franchise) mentions.push(`${FRANCHISE_REASON}.`)
  mentions.push('Catégorie de l’opération : prestation de services.')
  if (invoice.kind === 'INVOICE') {
    mentions.push('Pas d’escompte pour paiement anticipé.')
    mentions.push(`En cas de retard de paiement : ${invoice.latePenaltyText}`)
    mentions.push(`Indemnité forfaitaire pour frais de recouvrement due au créancier en cas de retard : ${(invoice.recoveryFeeCents / 100).toLocaleString('fr-FR')} € (art. L441-10 du Code de commerce).`)
  }
  const mentionLines = mentions.flatMap((m) => wrapText(m, font, 7.5, CONTENT))
  ensure(mentionLines.length * 10 + 16)
  y -= 4
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: LINE })
  y -= 12
  for (const l of mentionLines) {
    text(l, M, y, { size: 7.5, color: MUTED })
    y -= 10
  }

  // Pied de page : numérotation et format
  pages.forEach((p, i) => {
    text(`${invoice.number} · Factur-X EN 16931`, M, 24, { size: 7, color: MUTED, p })
    text(`Page ${i + 1} / ${pages.length}`, W - M, 24, { size: 7, color: MUTED, align: 'right', p })
  })

  // --- PDF/A-3 : métadonnées, profil couleur, identifiant, fichier associé -----------------------------------
  const created = new Date(options.createdAt)
  const createdIso = created.toISOString().replace(/\.\d{3}Z$/, 'Z')
  const title = `${docTitle} ${invoice.number}`
  const subject = `${docTitle} ${invoice.number} — ${invoice.buyer.name}`
  doc.setTitle(title, { showInWindowTitleBar: true })
  doc.setAuthor(seller.name)
  doc.setSubject(subject)
  doc.setCreator(PRODUCER)
  doc.setProducer(PRODUCER)
  doc.setCreationDate(created)
  doc.setModificationDate(created)
  doc.setLanguage('fr-FR')

  const { context, catalog } = doc
  const metadata = context.stream(new TextEncoder().encode(xmpPacket({ title, author: seller.name, subject, created: createdIso })), { Type: 'Metadata', Subtype: 'XML' })
  catalog.set(PDFName.of('Metadata'), context.register(metadata))

  const iccRef = context.register(context.flateStream(icc, { N: 3 }))
  catalog.set(
    PDFName.of('OutputIntents'),
    context.obj([
      {
        Type: 'OutputIntent',
        S: 'GTS_PDFA1',
        OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
        Info: PDFString.of('sRGB IEC61966-2.1'),
        DestOutputProfile: iccRef,
      },
    ]),
  )

  const xmlBytes = new TextEncoder().encode(xml)
  const embedded = context.flateStream(xmlBytes, {
    Type: 'EmbeddedFile',
    Subtype: 'text/xml',
    Params: { Size: xmlBytes.length, ModDate: PDFString.fromDate(created) },
  })
  const embeddedRef = context.register(embedded)
  const fileSpec = context.register(
    context.obj({
      Type: 'Filespec',
      F: PDFString.of(FACTURX_FILENAME),
      UF: PDFHexString.fromText(FACTURX_FILENAME),
      EF: { F: embeddedRef, UF: embeddedRef },
      Desc: PDFString.of('Factur-X invoice (EN 16931)'),
      AFRelationship: 'Data',
    }),
  )
  catalog.set(PDFName.of('Names'), context.obj({ EmbeddedFiles: { Names: [PDFString.of(FACTURX_FILENAME), fileSpec] } }))
  catalog.set(PDFName.of('AF'), context.obj([fileSpec]))

  const id = createHash('md5').update(xml).digest('hex').toUpperCase()
  context.trailerInfo.ID = context.obj([PDFHexString.of(id), PDFHexString.of(id)])

  const pdf = await doc.save({ useObjectStreams: false })
  return { pdf, xml }
}
