import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from 'typebox'
import { createOpportunity, deleteOpportunity, getOpportunity, listOpportunities, moveOpportunity, updateOpportunity } from '../services/opportunities.ts'
import { Id, IdParams, IsoDate, Nullable, PositiveCents, SourceSchema, StageSchema, Strict, Text } from './schemas.ts'

const Fields = {
  source: Type.Optional(SourceSchema),
  maltUrl: Type.Optional(Nullable(Type.String({ maxLength: 500 }))),
  amountCents: Type.Optional(PositiveCents),
  dailyRateCents: Type.Optional(Nullable(PositiveCents)),
  days: Type.Optional(Nullable(Type.Number({ minimum: 0, maximum: 1000 }))),
  probability: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
  expectedCloseDate: Type.Optional(Nullable(IsoDate)),
  nextAction: Type.Optional(Text(300)),
  nextActionDate: Type.Optional(Nullable(IsoDate)),
  projetsProjectId: Type.Optional(Nullable(Id)),
  notes: Type.Optional(Text(5000)),
}

export const opportunityRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/opportunities', { schema: { querystring: Strict({ clientId: Type.Optional(Id), includeClosed: Type.Optional(Type.Boolean()) }) } }, async (req) =>
    listOpportunities(app.ctx, req.query),
  )
  app.get('/opportunities/:id', { schema: { params: IdParams } }, async (req) => getOpportunity(app.ctx, req.params.id))
  app.post(
    '/opportunities',
    { schema: { body: Strict({ clientId: Id, title: Type.String({ minLength: 1, maxLength: 200 }), stage: Type.Optional(StageSchema), ...Fields }) } },
    async (req, reply) => reply.code(201).send(createOpportunity(app.ctx, req.body)),
  )
  app.patch(
    '/opportunities/:id',
    {
      schema: {
        params: IdParams,
        body: Strict({ clientId: Type.Optional(Id), title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })), lostReason: Type.Optional(Nullable(Type.String({ maxLength: 500 }))), ...Fields }),
      },
    },
    async (req) => updateOpportunity(app.ctx, req.params.id, req.body),
  )
  app.post(
    '/opportunities/:id/move',
    { schema: { params: IdParams, body: Strict({ stage: StageSchema, position: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000 })), lostReason: Type.Optional(Nullable(Type.String({ maxLength: 500 }))) }) } },
    async (req) => moveOpportunity(app.ctx, req.params.id, req.body),
  )
  app.delete('/opportunities/:id', { schema: { params: IdParams } }, async (req, reply) => {
    deleteOpportunity(app.ctx, req.params.id)
    return reply.code(204).send()
  })
}
