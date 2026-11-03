// Point d'entrée : ouvre la base (migrations appliquées), écoute sur 127.0.0.1:3001 et lance le planificateur de relances.
import { buildApp } from './app.ts'
import { loadEnvFile, readConfig } from './config.ts'
import { openDatabase } from './db/client.ts'
import { syncEinvoicing } from './services/einvoicing.ts'
import { runDueReminders } from './services/reminders.ts'

loadEnvFile()
const config = readConfig()
const database = openDatabase(config.databasePath)
const app = await buildApp({
  db: database.db,
  logger: { level: config.logLevel },
  brevoApiKey: config.brevoApiKey,
  superpdp: config.superpdp,
  allowedHosts: config.allowedHosts,
})

let timer: NodeJS.Timeout | undefined
if (config.reminderTickMinutes > 0) {
  // Sans « force » : rien ne part si l'envoi automatique est désactivé ou si l'app est hors ligne.
  // Relances dues, puis statuts de la plateforme agréée (rien ne part hors ligne).
  const tick = () =>
    runDueReminders(app.ctx)
      .then((summary) => {
        if (summary.sent || summary.failed) app.log.info({ summary }, 'Relances automatiques')
      })
      .catch((error: unknown) => app.log.error({ err: error }, 'Planificateur de relances'))
      .then(() => syncEinvoicing(app.ctx))
      .then((sync) => {
        if (sync.events || sync.reports) app.log.info({ sync }, 'Facture électronique : statuts synchronisés')
      })
      .catch((error: unknown) => app.log.warn({ err: error }, 'Synchronisation SUPER PDP'))
  timer = setInterval(tick, config.reminderTickMinutes * 60_000)
  timer.unref()
  setTimeout(tick, 5_000).unref()
}

const shutdown = async () => {
  if (timer) clearInterval(timer)
  await app.close()
  database.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

await app.listen({ host: config.host, port: config.port })
app.log.info(`Atelier Mission → http://${config.host}:${config.port}/api (Brevo ${config.brevoApiKey ? 'configuré' : 'non configuré'}, SUPER PDP ${config.superpdp ? 'configuré' : 'non configuré'})`)
