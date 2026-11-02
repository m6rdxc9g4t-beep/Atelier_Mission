import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from 'typebox'
import { acknowledgeTimeFlags, importTimeFromProjets, listProjetsProjects, listTimeEntries, projectSummaries } from '../services/time.ts'
import { Id, IsoDate, Strict } from './schemas.ts'

export const timeRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/time/projects', async () => listProjetsProjects(app.ctx))
  app.get('/time/summary', async () => projectSummaries(app.ctx))
  app.get(
    '/time/entries',
    {
      schema: {
        querystring: Strict({
          projectId: Type.Optional(Id),
          billed: Type.Optional(Type.Union([Type.Literal('all'), Type.Literal('unbilled'), Type.Literal('billed'), Type.Literal('flagged')])),
          from: Type.Optional(IsoDate),
          to: Type.Optional(IsoDate),
        }),
      },
    },
    async (req) => listTimeEntries(app.ctx, req.query),
  )
  app.post('/time/import', { schema: { body: Strict({ projectId: Id }) } }, async (req) => importTimeFromProjets(app.ctx, req.body.projectId))
  app.post('/time/acknowledge', { schema: { body: Strict({ entryIds: Type.Array(Id, { maxItems: 5000 }) }) } }, async (req) => acknowledgeTimeFlags(app.ctx, req.body.entryIds))
}
