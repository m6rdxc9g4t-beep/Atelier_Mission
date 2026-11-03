// Factur-X d'une facture directe émise (ou d'un avoir) : données figées à l'émission → XML CII + PDF/A-3.
import type { FacturxInvoice } from '../domain/facturx.ts'
import { conflict } from '../http/errors.ts'
import { buildFacturxPdf } from '../print/facturx-pdf.ts'
import type { Ctx } from './context.ts'
import { getInvoice, requireInvoice } from './invoices.ts'
import { getSettings } from './settings.ts'

export function facturxData(ctx: Ctx, invoiceId: number): { data: FacturxInvoice; createdAt: string } {
  const invoice = getInvoice(ctx, invoiceId)
  if (invoice.channel === 'MALT') throw conflict('Mission Malt : la facture officielle (et sa version électronique) est émise par Malt', 'FACTURX_MALT')
  if (invoice.rawStatus === 'DRAFT' || !invoice.number || !invoice.issueDate) {
    throw conflict('Émettez la facture avant de produire sa version Factur-X (numéro et date obligatoires)', 'FACTURX_DRAFT')
  }
  const settings = getSettings(ctx.db)
  const preceding = invoice.creditedInvoiceId ? requireInvoice(ctx.db, invoice.creditedInvoiceId) : null
  const seller = invoice.seller
  return {
    createdAt: invoice.issuedAt ?? `${invoice.issueDate}T00:00:00Z`,
    data: {
      kind: invoice.kind,
      number: invoice.number,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      serviceStart: invoice.serviceStart,
      serviceEnd: invoice.serviceEnd,
      title: invoice.title,
      notes: invoice.notes,
      vatRegime: seller.vatRegime,
      seller: {
        name: seller.name,
        siren: seller.siren || null,
        siret: seller.siret || null,
        vatNumber: seller.vatNumber || null,
        email: seller.email || null,
        phone: seller.phone || null,
        address: seller.address || null,
        iban: seller.iban || null,
        bic: seller.bic || null,
      },
      buyer: {
        name: invoice.client.name,
        siren: invoice.client.siren,
        vatNumber: invoice.client.vatNumber,
        email: invoice.client.email,
        address: invoice.client.address,
        contactName: invoice.client.contactName,
      },
      lines: invoice.lines.map((l) => ({
        label: l.label,
        details: l.details,
        unit: l.unit,
        quantityMilli: Math.round(l.quantity * 1000),
        unitPriceCents: l.unitPriceCents,
        vatRateBps: l.vatRateBps,
      })),
      paymentTermsDays: invoice.paymentTermsDays,
      latePenaltyText: settings.billing.latePenaltyRateText,
      recoveryFeeCents: settings.billing.recoveryFeeCents,
      precedingInvoice: preceding?.number ? { number: preceding.number, issueDate: preceding.issueDate } : null,
    },
  }
}

export async function facturxPdf(ctx: Ctx, invoiceId: number) {
  const { data, createdAt } = facturxData(ctx, invoiceId)
  return { number: data.number, ...(await buildFacturxPdf(data, { createdAt })) }
}
