// Construction de l'application Fastify, sans écoute réseau (testable avec app.inject()).
import fastifyStatic from '@fastify/static'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import Fastify, { type FastifyServerOptions } from 'fastify'
import { BACKEND_ROOT } from './config.ts'
import type { Db } from './db/client.ts'
import { DEFAULT_TIME_ZONE } from './domain/dates.ts'
import { errorBody, errorHandler } from './http/errors.ts'
import { allowedHosts, createLocalOnlyGuard } from './http/local-only.ts'
import { createValidatorCompiler } from './http/validation.ts'
import { createBrevoClient } from './integrations/brevo.ts'
import { createProjetsClient } from './integrations/projets.ts'
import { createTresorerieClient } from './integrations/tresorerie.ts'
import { atelierRoutes } from './routes/atelier.ts'
import { clientRoutes } from './routes/clients.ts'
import { invoiceRoutes } from './routes/invoices.ts'
import { opportunityRoutes } from './routes/opportunities.ts'
import { quoteRoutes } from './routes/quotes.ts'
import { reminderRoutes } from './routes/reminders.ts'
import { settingsRoutes } from './routes/settings.ts'
import { timeRoutes } from './routes/time.ts'
import type { Ctx, Integrations } from './services/context.ts'

declare module 'fastify' {
  interface FastifyInstance {
    ctx: Ctx
  }
}

export interface BuildAppOptions {
  db: Db
  logger?: FastifyServerOptions['logger']
  now?: () => Date
  timeZone?: string
  brevoApiKey?: string
  integrations?: Partial<Integrations>
  allowedHosts?: readonly string[]
  /** Interface compilée à servir sur « / » (déploiement serveur) ; absent en développement (Vite s'en charge). */
  staticDir?: string
}

const { version } = JSON.parse(readFileSync(path.join(BACKEND_ROOT, 'package.json'), 'utf8')) as { version: string }

export async function buildApp(options: BuildAppOptions) {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 2 * 1024 * 1024 }).withTypeProvider<TypeBoxTypeProvider>()
  app.setValidatorCompiler(createValidatorCompiler())

  const integrations: Integrations = {
    projets: options.integrations?.projets ?? ((url) => createProjetsClient(url)),
    tresorerie: options.integrations?.tresorerie ?? ((url) => createTresorerieClient(url)),
    brevo: options.integrations?.brevo !== undefined ? options.integrations.brevo : options.brevoApiKey ? createBrevoClient(options.brevoApiKey) : null,
  }
  const ctx: Ctx = { db: options.db, now: options.now ?? (() => new Date()), timeZone: options.timeZone ?? DEFAULT_TIME_ZONE, integrations }
  app.decorate('ctx', ctx)

  app.setErrorHandler(errorHandler)
  // Une action POST sans corps (« Émettre », « Accepter ») vaut un corps vide : les schémas facultatifs s'appliquent.
  app.addHook('preValidation', async (request) => {
    if (request.body === undefined && (request.method === 'POST' || request.method === 'PUT')) request.body = {}
  })
  app.addHook('onRequest', createLocalOnlyGuard(allowedHosts(undefined, options.allowedHosts ?? [])))
  app.setNotFoundHandler((request, reply) => reply.status(404).send(errorBody(404, 'NOT_FOUND', `Route ${request.method} ${request.url} introuvable`)))

  await app.register(
    async (api) => {
      api.get('/health', async () => ({ status: 'ok', app: 'atelier-mission', version }))
      await api.register(settingsRoutes)
      await api.register(clientRoutes)
      await api.register(opportunityRoutes)
      await api.register(quoteRoutes)
      await api.register(invoiceRoutes)
      await api.register(timeRoutes)
      await api.register(reminderRoutes)
      await api.register(atelierRoutes, { prefix: '/atelier' })
    },
    { prefix: '/api' },
  )

  if (options.staticDir) {
    // Routeur par fragment (#/factures…) : seuls index.html et les fichiers compilés sont demandés, sans repli SPA.
    // Un fichier absent (y compris sous /api) aboutit au gestionnaire 404 JSON ci-dessus.
    await app.register(fastifyStatic, {
      root: options.staticDir,
      prefix: '/',
      index: ['index.html'],
      cacheControl: false,
      setHeaders: (res, filePath) => {
        const immutable = filePath.includes(`${path.sep}assets${path.sep}`)
        res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
      },
    })
  }
  return app
}

export type App = Awaited<ReturnType<typeof buildApp>>
