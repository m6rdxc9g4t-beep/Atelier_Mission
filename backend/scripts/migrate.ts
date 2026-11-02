// Applique les migrations de drizzle/ à la base configurée (DATABASE_PATH ou backend/data/atelier-mission.db).
import { loadEnvFile, readConfig } from '../src/config.ts'
import { openDatabase } from '../src/db/client.ts'

loadEnvFile()
const { databasePath } = readConfig()
openDatabase(databasePath).close()
console.log(`✔ Base à jour : ${databasePath}`)
