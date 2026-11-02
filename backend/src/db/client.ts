// Connexion SQLite (better-sqlite3) + Drizzle. Les migrations de drizzle/ sont appliquées à l'ouverture.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { BACKEND_ROOT } from '../config.ts'
import * as schema from './schema.ts'

export type Db = BetterSQLite3Database<typeof schema>
/** Client ou transaction en cours (les transactions better-sqlite3 sont synchrones). */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export type DbOrTx = Db | Tx

export const MIGRATIONS_DIR = path.join(BACKEND_ROOT, 'drizzle')

export interface OpenedDatabase {
  db: Db
  sqlite: Database.Database
  close: () => void
}

export function openDatabase(databasePath: string): OpenedDatabase {
  if (databasePath !== ':memory:') mkdirSync(path.dirname(databasePath), { recursive: true })
  const sqlite = new Database(databasePath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })
  return { db, sqlite, close: () => sqlite.close() }
}
