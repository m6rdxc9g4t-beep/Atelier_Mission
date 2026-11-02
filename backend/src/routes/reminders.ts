import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from 'typebox'
import { cancelReminder, listReminders, previewReminder, rescheduleReminder, runDueReminders, sendBlocker, sendReminder } from '../services/reminders.ts'
import { IdParams, IsoDate, Strict } from './schemas.ts'

export const reminderRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/reminders',
    { schema: { querystring: Strict({ scope: Type.Optional(Type.Union([Type.Literal('due'), Type.Literal('upcoming'), Type.Literal('history'), Type.Literal('all')])) }) } },
    async (req) => ({ reminders: listReminders(app.ctx, req.query), blocker: sendBlocker(app.ctx) }),
  )
  app.get('/reminders/:id/preview', { schema: { params: IdParams } }, async (req) => previewReminder(app.ctx, req.params.id))
  app.post('/reminders/:id/send', { schema: { params: IdParams } }, async (req) => sendReminder(app.ctx, req.params.id))
  app.post('/reminders/:id/cancel', { schema: { params: IdParams } }, async (req) => cancelReminder(app.ctx, req.params.id))
  app.post('/reminders/:id/reschedule', { schema: { params: IdParams, body: Strict({ dueOn: IsoDate }) } }, async (req) =>
    rescheduleReminder(app.ctx, req.params.id, req.body.dueOn),
  )
  app.post('/reminders/run', async () => runDueReminders(app.ctx, { force: true }))
}
