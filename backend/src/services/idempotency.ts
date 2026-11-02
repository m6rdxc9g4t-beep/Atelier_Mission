// Idempotence des écritures (Suite Atelier §7.4) : même clé + même route + même corps → même réponse rejouée ;
// même clé sur une autre route ou avec un autre corps → 409 IDEMPOTENCY_KEY_REUSED. Rétention : 30 jours.
import { createHash } from 'node:crypto'
import { eq, lt } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import { idempotencyRecords } from '../db/schema.ts'
import { conflict } from '../http/errors.ts'

/** JSON canonique (clés triées) : l'ordre des clés du corps n'a pas d'importance. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

export interface IdempotentResult<T> {
  statusCode: number
  body: T
  replayed: boolean
}

export async function withIdempotency<T>(
  db: Db,
  input: { key: string | undefined; scope: string; body: unknown; now: Date },
  run: () => Promise<{ statusCode: number; body: T }> | { statusCode: number; body: T },
): Promise<IdempotentResult<T>> {
  if (!input.key) return { ...(await run()), replayed: false }
  if (input.key.length > 200) throw conflict('Idempotency-Key trop longue (200 caractères au plus)', 'VALIDATION')
  db.delete(idempotencyRecords).where(lt(idempotencyRecords.createdAt, new Date(input.now.getTime() - 30 * 86_400_000).toISOString())).run()
  const bodyHash = createHash('sha256').update(canonicalJson(input.body)).digest('hex')
  const existing = db.select().from(idempotencyRecords).where(eq(idempotencyRecords.key, input.key)).get()
  if (existing) {
    if (existing.scope !== input.scope || existing.bodyHash !== bodyHash) {
      throw conflict('Cette Idempotency-Key a déjà servi pour une autre requête', 'IDEMPOTENCY_KEY_REUSED')
    }
    return { statusCode: existing.statusCode, body: JSON.parse(existing.response) as T, replayed: true }
  }
  const result = await run()
  db.insert(idempotencyRecords)
    .values({ key: input.key, scope: input.scope, bodyHash, statusCode: result.statusCode, response: JSON.stringify(result.body), createdAt: input.now.toISOString() })
    .run()
  return { ...result, replayed: false }
}
