import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from 'typebox'
import { INVOICE_STATUSES } from '../db/schema.ts'
import { renderDocumentHtml } from '../print/document-html.ts'
import { cancelInvoice, createInvoice, deleteDraftInvoice, getInvoice, issueInvoice, listInvoices, requireInvoice, updateInvoice } from '../services/invoices.ts'
import { deletePayment, recordPayment, skipPaymentSync, syncPayment } from '../services/payments.ts'
import { buildFacturxXml } from '../domain/facturx.ts'
import { facturxData, facturxPdf } from '../services/facturx.ts'
import { createInvoiceFromTime, previewInvoiceFromTime } from '../services/time.ts'
import { ChannelSchema, Id, IdParams, IsoDate, LinesSchema, Nullable, PaymentMethodSchema, RateBps, Strict, Text } from './schemas.ts'

const Fields = {
  channel: Type.Optional(ChannelSchema),
  opportunityId: Type.Optional(Nullable(Id)),
  quoteId: Type.Optional(Nullable(Id)),
  serviceStart: Type.Optional(Nullable(IsoDate)),
  serviceEnd: Type.Optional(Nullable(IsoDate)),
  paymentTermsDays: Type.Optional(Type.Integer({ minimum: 0, maximum: 120 })),
  notes: Type.Optional(Text(5000)),
  remindersEnabled: Type.Optional(Type.Boolean()),
  maltFeeBps: Type.Optional(RateBps),
  lines: Type.Optional(LinesSchema),
}

const FromTimeBody = Strict({
  clientId: Id,
  projectId: Id,
  from: Type.Optional(IsoDate),
  to: Type.Optional(IsoDate),
  entryIds: Type.Optional(Type.Array(Id, { maxItems: 5000 })),
  unit: Type.Union([Type.Literal('DAY'), Type.Literal('HOUR')]),
  rateCents: Type.Optional(Type.Integer({ minimum: 0, maximum: 1_000_000_00 })),
  hoursPerDay: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 24 })),
  vatRateBps: Type.Optional(RateBps),
  grouping: Type.Optional(Type.Union([Type.Literal('WORK_ITEM'), Type.Literal('PROJECT'), Type.Literal('ENTRY')])),
  title: Type.Optional(Type.String({ maxLength: 200 })),
  opportunityId: Type.Optional(Nullable(Id)),
})

const StatusFilter = Type.Union([...INVOICE_STATUSES, 'OVERDUE' as const].map((s) => Type.Literal(s)))

export const invoiceRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/invoices',
    { schema: { querystring: Strict({ clientId: Type.Optional(Id), status: Type.Optional(StatusFilter), channel: Type.Optional(ChannelSchema), q: Type.Optional(Text(100)) }) } },
    async (req) => listInvoices(app.ctx, req.query),
  )
  app.get('/invoices/:id', { schema: { params: IdParams } }, async (req) => getInvoice(app.ctx, req.params.id))
  app.post('/invoices', { schema: { body: Strict({ clientId: Id, title: Type.String({ minLength: 1, maxLength: 200 }), ...Fields }) } }, async (req, reply) =>
    reply.code(201).send(getInvoice(app.ctx, createInvoice(app.ctx, req.body))),
  )
  app.patch(
    '/invoices/:id',
    {
      schema: {
        params: IdParams,
        body: Strict({ clientId: Type.Optional(Id), title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })), externalRef: Type.Optional(Nullable(Type.String({ maxLength: 100 }))), ...Fields }),
      },
    },
    async (req) => updateInvoice(app.ctx, req.params.id, req.body),
  )
  app.delete('/invoices/:id', { schema: { params: IdParams } }, async (req, reply) => {
    deleteDraftInvoice(app.ctx, req.params.id)
    return reply.code(204).send()
  })
  app.post(
    '/invoices/:id/issue',
    { schema: { params: IdParams, body: Strict({ issueDate: Type.Optional(IsoDate), externalRef: Type.Optional(Nullable(Type.String({ maxLength: 100 }))) }) } },
    async (req) => issueInvoice(app.ctx, req.params.id, req.body ?? {}),
  )
  app.post(
    '/invoices/:id/cancel',
    { schema: { params: IdParams, body: Strict({ reason: Type.Optional(Text(500)) }) } },
    async (req) => cancelInvoice(app.ctx, req.params.id, req.body ?? {}),
  )

  // Temps d'Atelier Projets → facture
  app.post('/invoices/from-time/preview', { schema: { body: FromTimeBody } }, async (req) => {
    const preview = previewInvoiceFromTime(app.ctx, req.body)
    return { ...preview, entries: preview.entries.map((e) => ({ id: e.id, spentOn: e.spentOn, minutes: e.minutes, workItemId: e.workItemId, workItemTitle: e.workItemTitle })) }
  })
  app.post('/invoices/from-time', { schema: { body: FromTimeBody } }, async (req, reply) => reply.code(201).send(createInvoiceFromTime(app.ctx, req.body)))

  // Encaissements → Atelier Trésorerie
  app.post(
    '/invoices/:id/payments',
    {
      schema: {
        params: IdParams,
        body: Strict({ amountCents: Type.Integer({ minimum: 1, maximum: 1_000_000_000_00 }), receivedOn: IsoDate, method: Type.Optional(PaymentMethodSchema), note: Type.Optional(Text(500)) }),
      },
    },
    async (req, reply) => {
      await recordPayment(app.ctx, req.params.id, req.body)
      return reply.code(201).send(getInvoice(app.ctx, req.params.id))
    },
  )
  app.delete('/payments/:id', { schema: { params: IdParams } }, async (req) => deletePayment(app.ctx, req.params.id))
  app.post('/payments/:id/sync', { schema: { params: IdParams } }, async (req) => syncPayment(app.ctx, req.params.id))
  app.post('/payments/:id/skip-sync', { schema: { params: IdParams } }, async (req) => skipPaymentSync(app.ctx, req.params.id))

  // Factur-X (PDF/A-3 + XML CII EN 16931) : factures directes émises et avoirs.
  app.get('/invoices/:id/facturx.pdf', { schema: { params: IdParams } }, async (req, reply) => {
    const { number, pdf } = await facturxPdf(app.ctx, req.params.id)
    return reply
      .type('application/pdf')
      .header('content-disposition', `attachment; filename="${number}.pdf"`)
      .send(Buffer.from(pdf))
  })
  app.get('/invoices/:id/facturx.xml', { schema: { params: IdParams } }, async (req, reply) => {
    const { data } = facturxData(app.ctx, req.params.id)
    return reply
      .type('application/xml; charset=utf-8')
      .header('content-disposition', `attachment; filename="${data.number}-factur-x.xml"`)
      .send(buildFacturxXml(data))
  })

  app.get('/invoices/:id/print', { schema: { params: IdParams } }, async (req, reply) => {
    const invoice = getInvoice(app.ctx, req.params.id)
    const credited = invoice.creditedInvoiceId ? requireInvoice(app.ctx.db, invoice.creditedInvoiceId) : null
    const html = renderDocumentHtml({
      kind: invoice.kind === 'CREDIT_NOTE' ? 'CREDIT_NOTE' : invoice.channel === 'MALT' ? 'MALT_SUMMARY' : 'INVOICE',
      number: invoice.displayNumber,
      draft: invoice.rawStatus === 'DRAFT',
      title: invoice.title,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      serviceStart: invoice.serviceStart,
      serviceEnd: invoice.serviceEnd,
      seller: invoice.seller,
      client: invoice.client,
      lines: invoice.lines,
      totalHtCents: invoice.totalHtCents,
      totalVatCents: invoice.totalVatCents,
      totalTtcCents: invoice.totalTtcCents,
      vatByRate: invoice.vatByRate,
      paidCents: invoice.paidCents,
      notes: invoice.notes,
      legalMentions:
        invoice.channel === 'MALT'
          ? ['Document interne : la facture officielle de cette mission est émise par Malt au nom du freelance (mandat de facturation).']
          : invoice.legalMentions,
      footer: invoice.footer,
      creditedNumber: credited?.number ?? null,
    })
    return reply.type('text/html; charset=utf-8').send(html)
  })
}
