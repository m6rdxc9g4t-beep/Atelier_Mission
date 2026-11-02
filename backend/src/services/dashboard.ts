// Tableau de bord : encaissé, à encaisser, en retard, pipeline pondéré, conversion, temps non facturé, agenda du jour.
// Tout est calculé ici (le frontend n'agrège rien).
import { and, eq, gte, isNull, lte, ne, sql } from 'drizzle-orm'
import { clients, invoices, opportunities, payments, timeEntries } from '../db/schema.ts'
import { addDays, lastMonths } from '../domain/dates.ts'
import { effectiveStatus } from '../domain/invoicing.ts'
import { conversionRate, isOpenStage, STAGE_LABELS, weightedCents } from '../domain/pipeline.ts'
import { type Ctx, today } from './context.ts'
import { expiringQuotes } from './quotes.ts'
import { listReminders } from './reminders.ts'
import { getSettings } from './settings.ts'

export function dashboard(ctx: Ctx) {
  const day = today(ctx)
  const year = day.slice(0, 4)
  const month = day.slice(0, 7)
  const settings = getSettings(ctx.db)

  const paymentRows = ctx.db
    .select({ amount: payments.amountCents, receivedOn: payments.receivedOn, sync: payments.tresorerieStatus })
    .from(payments)
    .all()
  const collectedYear = paymentRows.filter((p) => p.receivedOn.startsWith(year)).reduce((s, p) => s + p.amount, 0)
  const collectedMonth = paymentRows.filter((p) => p.receivedOn.startsWith(month)).reduce((s, p) => s + p.amount, 0)

  const invoiceRows = ctx.db
    .select({ invoice: invoices, clientName: clients.name })
    .from(invoices)
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .where(and(eq(invoices.kind, 'INVOICE'), ne(invoices.status, 'DRAFT')))
    .all()
  const open = invoiceRows.filter(({ invoice }) => invoice.status === 'ISSUED' || invoice.status === 'PARTIALLY_PAID')
  const overdue = open.filter(({ invoice }) => effectiveStatus(invoice.status, invoice.dueDate, day) === 'OVERDUE')
  const billedYear = invoiceRows
    .filter(({ invoice }) => invoice.status !== 'CANCELLED' && (invoice.issueDate ?? '').startsWith(year))
    .reduce((s, { invoice }) => s + invoice.totalHtCents, 0)

  const opps = ctx.db.select().from(opportunities).all()
  const openOpps = opps.filter((o) => isOpenStage(o.stage))
  const yearAgo = addDays(day, -365)
  const recentClosed = opps.filter((o) => o.closedAt !== null && o.closedAt.slice(0, 10) >= yearAgo)

  const months = lastMonths(day, 12)
  const series = months.map((m) => ({
    month: m,
    collectedCents: paymentRows.filter((p) => p.receivedOn.startsWith(m)).reduce((s, p) => s + p.amount, 0),
    billedHtCents: invoiceRows
      .filter(({ invoice }) => invoice.status !== 'CANCELLED' && (invoice.issueDate ?? '').startsWith(m))
      .reduce((s, { invoice }) => s + invoice.totalHtCents, 0),
  }))

  const unbilled = ctx.db
    .select({ minutes: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)`, n: sql<number>`count(*)` })
    .from(timeEntries)
    .where(and(isNull(timeEntries.invoiceLineId), eq(timeEntries.removedInProjets, false)))
    .get() ?? { minutes: 0, n: 0 }
  const unbilledValue = Math.round((unbilled.minutes / (settings.billing.hoursPerDay * 60)) * settings.billing.defaultDailyRateCents)

  const nextActions = ctx.db
    .select({ opp: opportunities, clientName: clients.name })
    .from(opportunities)
    .innerJoin(clients, eq(clients.id, opportunities.clientId))
    .where(and(lte(opportunities.nextActionDate, addDays(day, 7)), gte(opportunities.nextActionDate, '0000-01-01')))
    .all()
    .filter(({ opp }) => isOpenStage(opp.stage))
    .sort((a, b) => (a.opp.nextActionDate ?? '').localeCompare(b.opp.nextActionDate ?? ''))
    .map(({ opp, clientName }) => ({
      id: opp.id,
      title: opp.title,
      clientName,
      stage: opp.stage,
      nextAction: opp.nextAction,
      nextActionDate: opp.nextActionDate,
      late: (opp.nextActionDate ?? day) < day,
    }))

  return {
    today: day,
    kpis: {
      collectedMonthCents: collectedMonth,
      collectedYearCents: collectedYear,
      billedYearHtCents: billedYear,
      outstandingCents: open.reduce((s, { invoice }) => s + invoice.totalTtcCents - invoice.paidCents, 0),
      outstandingCount: open.length,
      overdueCents: overdue.reduce((s, { invoice }) => s + invoice.totalTtcCents - invoice.paidCents, 0),
      overdueCount: overdue.length,
      pipelineCents: openOpps.reduce((s, o) => s + o.amountCents, 0),
      pipelineWeightedCents: openOpps.reduce((s, o) => s + weightedCents(o.amountCents, o.probability), 0),
      openOpportunities: openOpps.length,
      conversionRate: conversionRate(recentClosed.filter((o) => o.stage === 'WON').length, recentClosed.filter((o) => o.stage === 'LOST').length),
      unbilledMinutes: unbilled.minutes,
      unbilledEntries: unbilled.n,
      unbilledValueCents: unbilledValue,
      paymentsToSync: paymentRows.filter((p) => p.sync === 'PENDING' || p.sync === 'FAILED').length,
    },
    pipeline: (['NEW', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION'] as const).map((stage) => {
      const list = openOpps.filter((o) => o.stage === stage)
      return { stage, label: STAGE_LABELS[stage], count: list.length, amountCents: list.reduce((s, o) => s + o.amountCents, 0) }
    }),
    series,
    agenda: {
      nextActions,
      dueReminders: listReminders(ctx, { scope: 'due' }).map((r) => ({
        id: r.id,
        level: r.level,
        levelLabel: r.levelLabel,
        invoiceId: r.invoice.id,
        invoiceNumber: r.invoice.number,
        clientName: r.clientName,
        balanceCents: r.invoice.balanceCents,
        daysLate: r.daysLate,
        state: r.state,
      })),
      overdueInvoices: overdue
        .map(({ invoice, clientName }) => ({
          id: invoice.id,
          number: invoice.number ?? invoice.externalRef,
          clientName,
          channel: invoice.channel,
          dueDate: invoice.dueDate,
          balanceCents: invoice.totalTtcCents - invoice.paidCents,
        }))
        .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '')),
      expiringQuotes: expiringQuotes(ctx, 7),
    },
    onlineMode: settings.onlineMode,
  }
}
