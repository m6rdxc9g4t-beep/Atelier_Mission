import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from 'typebox'
import { QUOTE_STATUSES } from '../db/schema.ts'
import { legalMentions } from '../domain/invoicing.ts'
import { renderDocumentHtml } from '../print/document-html.ts'
import { createInvoiceFromQuote } from '../services/invoices.ts'
import { acceptQuote, createQuote, declineQuote, deleteQuote, duplicateQuote, getQuote, listQuotes, sendQuote, updateQuote } from '../services/quotes.ts'
import { getSettings } from '../services/settings.ts'
import { ChannelSchema, Id, IdParams, IsoDate, LinesSchema, Nullable, Strict, Text } from './schemas.ts'

const Fields = {
  opportunityId: Type.Optional(Nullable(Id)),
  channel: Type.Optional(ChannelSchema),
  issueDate: Type.Optional(IsoDate),
  validUntil: Type.Optional(IsoDate),
  notes: Type.Optional(Text(5000)),
  lines: Type.Optional(LinesSchema),
}

export const quoteRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/quotes',
    { schema: { querystring: Strict({ clientId: Type.Optional(Id), status: Type.Optional(Type.Union(QUOTE_STATUSES.map((s) => Type.Literal(s)))) }) } },
    async (req) => listQuotes(app.ctx, req.query),
  )
  app.get('/quotes/:id', { schema: { params: IdParams } }, async (req) => getQuote(app.ctx, req.params.id))
  app.post('/quotes', { schema: { body: Strict({ clientId: Id, title: Type.String({ minLength: 1, maxLength: 200 }), ...Fields }) } }, async (req, reply) =>
    reply.code(201).send(createQuote(app.ctx, req.body)),
  )
  app.patch(
    '/quotes/:id',
    { schema: { params: IdParams, body: Strict({ clientId: Type.Optional(Id), title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })), ...Fields }) } },
    async (req) => updateQuote(app.ctx, req.params.id, req.body),
  )
  app.delete('/quotes/:id', { schema: { params: IdParams } }, async (req, reply) => {
    deleteQuote(app.ctx, req.params.id)
    return reply.code(204).send()
  })
  app.post('/quotes/:id/send', { schema: { params: IdParams } }, async (req) => sendQuote(app.ctx, req.params.id))
  app.post('/quotes/:id/accept', { schema: { params: IdParams } }, async (req) => acceptQuote(app.ctx, req.params.id))
  app.post(
    '/quotes/:id/decline',
    { schema: { params: IdParams, body: Strict({ markOpportunityLost: Type.Optional(Type.Boolean()) }) } },
    async (req) => declineQuote(app.ctx, req.params.id, req.body ?? {}),
  )
  app.post('/quotes/:id/duplicate', { schema: { params: IdParams } }, async (req, reply) => reply.code(201).send(duplicateQuote(app.ctx, req.params.id)))
  app.post('/quotes/:id/invoice', { schema: { params: IdParams } }, async (req, reply) => reply.code(201).send(createInvoiceFromQuote(app.ctx, req.params.id)))

  app.get('/quotes/:id/print', { schema: { params: IdParams } }, async (req, reply) => {
    const quote = getQuote(app.ctx, req.params.id)
    const settings = getSettings(app.ctx.db)
    const html = renderDocumentHtml({
      kind: 'QUOTE',
      number: quote.number,
      draft: quote.status === 'DRAFT',
      title: quote.title,
      issueDate: quote.issueDate,
      validUntil: quote.validUntil,
      seller: settings.company,
      client: quote.client,
      lines: quote.lines,
      totalHtCents: quote.totalHtCents,
      totalVatCents: quote.totalVatCents,
      totalTtcCents: quote.totalTtcCents,
      vatByRate: quote.vatByRate,
      notes: quote.notes,
      legalMentions: [
        ...legalMentions({ vatRegime: settings.company.vatRegime, latePenaltyRateText: settings.billing.latePenaltyRateText, recoveryFeeCents: settings.billing.recoveryFeeCents, isB2B: true }).slice(0, 1),
        'Devis gratuit. Bon pour accord : date, signature et mention « Bon pour accord ».',
      ],
      footer: settings.billing.footer,
    })
    return reply.type('text/html; charset=utf-8').send(html)
  })
}
