import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from 'typebox'
import { createClient, deleteClient, getClient, listClients, updateClient } from '../services/clients.ts'
import { ChannelSchema, IdParams, Nullable, RateBps, Strict, Text } from './schemas.ts'

const ClientFields = {
  siren: Type.Optional(Nullable(Type.String({ maxLength: 20 }))),
  vatNumber: Type.Optional(Nullable(Type.String({ maxLength: 30 }))),
  email: Type.Optional(Nullable(Type.String({ maxLength: 200 }))),
  contactName: Type.Optional(Nullable(Type.String({ maxLength: 200 }))),
  phone: Type.Optional(Nullable(Type.String({ maxLength: 50 }))),
  address: Type.Optional(Nullable(Type.String({ maxLength: 500 }))),
  channel: Type.Optional(ChannelSchema),
  maltFeeBps: Type.Optional(Nullable(RateBps)),
  paymentTermsDays: Type.Optional(Nullable(Type.Integer({ minimum: 0, maximum: 120 }))),
  notes: Type.Optional(Text(5000)),
}

export const clientRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/clients', { schema: { querystring: Strict({ q: Type.Optional(Text(100)), includeArchived: Type.Optional(Type.Boolean()) }) } }, async (req) =>
    listClients(app.ctx, req.query),
  )
  app.get('/clients/:id', { schema: { params: IdParams } }, async (req) => getClient(app.ctx, req.params.id))
  app.post('/clients', { schema: { body: Strict({ name: Type.String({ minLength: 1, maxLength: 200 }), ...ClientFields }) } }, async (req, reply) =>
    reply.code(201).send(createClient(app.ctx, req.body)),
  )
  app.patch(
    '/clients/:id',
    { schema: { params: IdParams, body: Strict({ name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })), archived: Type.Optional(Type.Boolean()), ...ClientFields }) } },
    async (req) => updateClient(app.ctx, req.params.id, req.body),
  )
  app.delete('/clients/:id', { schema: { params: IdParams } }, async (req, reply) => {
    deleteClient(app.ctx, req.params.id)
    return reply.code(204).send()
  })
}
