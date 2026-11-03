import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { forbidden } from '../http/errors.ts'
import { checkConnection, einvoiceView, einvoicingBlocker, reportPayment, sendEinvoice, syncEinvoicing } from '../services/einvoicing.ts'
import { getSettings } from '../services/settings.ts'
import { IdParams } from './schemas.ts'

export const einvoicingRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/einvoicing/status', async () => ({
    platform: 'SUPERPDP',
    configured: app.ctx.integrations.superpdp !== null,
    blocker: einvoicingBlocker(app.ctx),
    settings: getSettings(app.ctx.db).einvoicing,
  }))
  app.post('/einvoicing/check', async () => checkConnection(app.ctx))
  app.post('/einvoicing/sync', async () => {
    const blocker = einvoicingBlocker(app.ctx)
    if (blocker) throw forbidden(blocker.code, blocker.message)
    return syncEinvoicing(app.ctx)
  })
  app.post('/invoices/:id/einvoice', { schema: { params: IdParams } }, async (req) => {
    await sendEinvoice(app.ctx, req.params.id)
    return einvoiceView(app.ctx, req.params.id)
  })
  app.post('/payments/:id/einvoice-report', { schema: { params: IdParams } }, async (req) => reportPayment(app.ctx, req.params.id))
}
