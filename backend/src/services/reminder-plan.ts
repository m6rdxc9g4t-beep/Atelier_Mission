// Planification des relances d'une facture (sans envoi) : appelée dans la transaction d'émission ou d'encaissement.
import { and, eq } from 'drizzle-orm'
import type { DbOrTx } from '../db/client.ts'
import { invoices, reminders } from '../db/schema.ts'
import { planReminders } from '../domain/reminders.ts'

/** Crée les relances manquantes (une par niveau) ; les relances déjà envoyées ne sont jamais touchées. */
export function scheduleReminders(db: DbOrTx, invoice: typeof invoices.$inferSelect, offsetsDays: readonly number[]): void {
  if (!invoice.dueDate || invoice.channel !== 'DIRECT' || !invoice.remindersEnabled) return
  for (const plan of planReminders(invoice.dueDate, offsetsDays)) {
    const existing = db
      .select()
      .from(reminders)
      .where(and(eq(reminders.invoiceId, invoice.id), eq(reminders.level, plan.level)))
      .get()
    if (!existing) {
      db.insert(reminders).values({ invoiceId: invoice.id, level: plan.level, dueOn: plan.dueOn }).run()
    } else if (existing.status === 'CANCELLED') {
      db.update(reminders).set({ status: 'PLANNED', dueOn: plan.dueOn, error: null }).where(eq(reminders.id, existing.id)).run()
    }
  }
}

/** Annule les relances encore à venir (facture payée, annulée ou relances désactivées). */
export function cancelOpenReminders(db: DbOrTx, invoiceId: number): void {
  db.update(reminders)
    .set({ status: 'CANCELLED' })
    .where(and(eq(reminders.invoiceId, invoiceId), eq(reminders.status, 'PLANNED')))
    .run()
  db.update(reminders)
    .set({ status: 'CANCELLED' })
    .where(and(eq(reminders.invoiceId, invoiceId), eq(reminders.status, 'FAILED')))
    .run()
}
