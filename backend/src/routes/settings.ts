import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from 'typebox'
import { HttpError } from '../http/errors.ts'
import { dashboard } from '../services/dashboard.ts'
import { syncPendingPayments } from '../services/payments.ts'
import { getSettings, setOnlineMode, updateSettings } from '../services/settings.ts'
import { Id, Nullable, PositiveCents, RateBps, Strict } from './schemas.ts'

const Str = (max = 300) => Type.Optional(Type.String({ maxLength: max }))

const SettingsPatch = Strict({
  company: Type.Optional(
    Strict({
      name: Str(200),
      legalForm: Str(50),
      siren: Str(20),
      siret: Str(20),
      vatNumber: Str(30),
      address: Str(500),
      email: Str(200),
      phone: Str(50),
      iban: Str(50),
      bic: Str(20),
      vatRegime: Type.Optional(Type.Union([Type.Literal('FRANCHISE'), Type.Literal('REEL')])),
    }),
  ),
  billing: Type.Optional(
    Strict({
      defaultVatRateBps: Type.Optional(RateBps),
      paymentTermsDays: Type.Optional(Type.Integer({ minimum: 0, maximum: 120 })),
      quoteValidityDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 365 })),
      hoursPerDay: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 24 })),
      defaultDailyRateCents: Type.Optional(PositiveCents),
      latePenaltyRateText: Str(500),
      recoveryFeeCents: Type.Optional(PositiveCents),
      invoicePrefix: Type.Optional(Type.String({ minLength: 1, maxLength: 10, pattern: '^[A-Za-z0-9]+$' })),
      creditNotePrefix: Type.Optional(Type.String({ minLength: 1, maxLength: 10, pattern: '^[A-Za-z0-9]+$' })),
      quotePrefix: Type.Optional(Type.String({ minLength: 1, maxLength: 10, pattern: '^[A-Za-z0-9]+$' })),
      footer: Str(1000),
    }),
  ),
  malt: Type.Optional(Strict({ feeBps: Type.Optional(RateBps), feeVatBps: Type.Optional(RateBps) })),
  reminders: Type.Optional(
    Strict({
      offsetsDays: Type.Optional(Type.Array(Type.Integer({ minimum: 0, maximum: 365 }), { minItems: 1, maxItems: 3 })),
      autoSend: Type.Optional(Type.Boolean()),
      bccSelf: Type.Optional(Type.Boolean()),
    }),
  ),
  einvoicing: Type.Optional(Strict({ autoSend: Type.Optional(Type.Boolean()), reportPayments: Type.Optional(Type.Boolean()) })),
  integrations: Type.Optional(
    Strict({
      projetsUrl: Str(200),
      tresorerieUrl: Str(200),
      tresorerieAccountId: Type.Optional(Nullable(Id)),
      tresorerieRevenueCategoryId: Type.Optional(Nullable(Id)),
      tresorerieFeeCategoryId: Type.Optional(Nullable(Id)),
      tresorerieAutoSync: Type.Optional(Type.Boolean()),
      brevoSenderEmail: Str(200),
      brevoSenderName: Str(200),
    }),
  ),
})

export const settingsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const view = () => ({
    ...getSettings(app.ctx.db),
    brevoKeyConfigured: app.ctx.integrations.brevo !== null,
    superpdpConfigured: app.ctx.integrations.superpdp !== null,
  })

  app.get('/settings', async () => view())
  app.patch('/settings', { schema: { body: SettingsPatch } }, async (req) => {
    updateSettings(app.ctx.db, req.body)
    return view()
  })
  // Mode en ligne : seul l'utilisateur, depuis l'interface locale, le change (garde local-only sur toute l'API).
  app.put('/settings/online-mode', { schema: { body: Strict({ online: Type.Boolean() }) } }, async (req) => {
    setOnlineMode(app.ctx.db, req.body.online)
    return view()
  })

  app.get('/dashboard', async () => dashboard(app.ctx))

  app.get('/integrations/status', async () => {
    const settings = getSettings(app.ctx.db)
    const safePing = async (make: () => { ping(): Promise<boolean> }) => {
      try {
        return await make().ping()
      } catch {
        return false
      }
    }
    const [projets, tresorerie] = await Promise.all([
      safePing(() => app.ctx.integrations.projets(settings.integrations.projetsUrl)),
      safePing(() => app.ctx.integrations.tresorerie(settings.integrations.tresorerieUrl)),
    ])
    return {
      projets: { url: settings.integrations.projetsUrl, online: projets },
      tresorerie: {
        url: settings.integrations.tresorerieUrl,
        online: tresorerie,
        configured: settings.integrations.tresorerieAccountId !== null,
      },
      superpdp: { configured: app.ctx.integrations.superpdp !== null, onlineMode: settings.onlineMode },
      brevo: {
        keyConfigured: app.ctx.integrations.brevo !== null,
        senderConfigured: settings.integrations.brevoSenderEmail !== '',
        onlineMode: settings.onlineMode,
      },
    }
  })

  app.get('/integrations/tresorerie/options', async () => {
    const settings = getSettings(app.ctx.db)
    const client = app.ctx.integrations.tresorerie(settings.integrations.tresorerieUrl)
    const [accounts, categories] = await Promise.all([client.listAccounts(), client.listCategories()])
    return { accounts: accounts.filter((a) => !a.archived), categories }
  })
  app.post('/integrations/tresorerie/sync-pending', async () => syncPendingPayments(app.ctx))

  app.get('/integrations/brevo/account', async () => {
    const settings = getSettings(app.ctx.db)
    if (!settings.onlineMode) throw new HttpError(403, 'OFFLINE', 'Mode hors ligne : passez « En ligne » pour vérifier la connexion Brevo')
    if (!app.ctx.integrations.brevo) throw new HttpError(400, 'BREVO_NOT_CONFIGURED', 'Clé Brevo absente : renseignez BREVO_API_KEY dans backend/.env')
    return app.ctx.integrations.brevo.account()
  })
}
