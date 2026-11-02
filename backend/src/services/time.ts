// Temps passé : import depuis Atelier Projets, puis facture brouillon générée à partir des saisies non facturées.
// Une saisie déjà facturée n'est jamais refacturée ; si Projets la modifie ou la supprime ensuite, elle est signalée.
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import { timeEntries } from '../db/schema.ts'
import { buildTimeLines, hoursToMinutes, type TimeGrouping, type TimeUnit } from '../domain/time-billing.ts'
import { badRequest, conflict } from '../http/errors.ts'
import type { ProjetsTimeRow } from '../integrations/projets.ts'
import { requireClient } from './common.ts'
import { type Ctx, nowIso } from './context.ts'
import { emitEvent } from './events.ts'
import { createInvoice, getInvoice, writeInvoiceLines } from './invoices.ts'
import { getSettings } from './settings.ts'

export interface ImportSummary {
  projectId: number
  projectName: string
  created: number
  updated: number
  unchanged: number
  removed: number
  flagged: number
  truncated: boolean
}

function sameEntry(row: typeof timeEntries.$inferSelect, next: ReturnType<typeof fromProjets>): boolean {
  return (
    row.minutes === next.minutes &&
    row.spentOn === next.spentOn &&
    row.workItemId === next.workItemId &&
    row.workItemTitle === next.workItemTitle &&
    row.comment === next.comment &&
    row.projetsProjectName === next.projetsProjectName
  )
}

function fromProjets(row: ProjetsTimeRow, projectId: number) {
  return {
    projetsEntryId: Number(row.id),
    projetsProjectId: projectId,
    projetsProjectName: row.projet,
    workItemId: Number(row.element_id),
    workItemTitle: row.element,
    workItemType: row.type,
    spentOn: row.date,
    minutes: hoursToMinutes(Number(row.heures)),
    comment: row.commentaire ?? '',
  }
}

/** Applique un instantané des saisies d'un projet (pur côté réseau : testable sans Projets). */
export function applyTimeSnapshot(ctx: Ctx, projectId: number, rows: readonly ProjetsTimeRow[], truncated: boolean): ImportSummary {
  const at = nowIso(ctx)
  const summary: ImportSummary = { projectId, projectName: rows[0]?.projet ?? '', created: 0, updated: 0, unchanged: 0, removed: 0, flagged: 0, truncated }
  ctx.db.transaction((tx) => {
    const existing = new Map(
      tx.select().from(timeEntries).where(eq(timeEntries.projetsProjectId, projectId)).all().map((row) => [row.projetsEntryId, row]),
    )
    const seen = new Set<number>()
    for (const raw of rows) {
      const next = fromProjets(raw, projectId)
      if (!Number.isFinite(next.minutes) || next.minutes <= 0) continue
      seen.add(next.projetsEntryId)
      const current = existing.get(next.projetsEntryId)
      if (!current) {
        tx.insert(timeEntries).values({ ...next, createdAt: at, updatedAt: at }).run()
        summary.created += 1
      } else if (sameEntry(current, next) && !current.removedInProjets) {
        summary.unchanged += 1
      } else {
        const billed = current.invoiceLineId !== null
        tx.update(timeEntries)
          .set({ ...next, removedInProjets: false, changedAfterBilling: billed || current.changedAfterBilling, updatedAt: at })
          .where(eq(timeEntries.id, current.id))
          .run()
        summary.updated += 1
        if (billed) summary.flagged += 1
      }
    }
    // Saisies disparues de Projets (seulement si l'instantané est complet) : supprimées, ou signalées si facturées.
    if (!truncated) {
      for (const [entryId, row] of existing) {
        if (seen.has(entryId) || row.removedInProjets) continue
        if (row.invoiceLineId === null) {
          tx.delete(timeEntries).where(eq(timeEntries.id, row.id)).run()
        } else {
          tx.update(timeEntries).set({ removedInProjets: true, updatedAt: at }).where(eq(timeEntries.id, row.id)).run()
          summary.flagged += 1
        }
        summary.removed += 1
      }
    }
    if (!summary.projectName) {
      summary.projectName = tx.select({ name: timeEntries.projetsProjectName }).from(timeEntries).where(eq(timeEntries.projetsProjectId, projectId)).get()?.name ?? ''
    }
    emitEvent(tx, {
      type: 'mission.time.imported',
      at,
      subject: { kind: 'projets_project', id: projectId, label: summary.projectName },
      data: { created: summary.created, updated: summary.updated, removed: summary.removed, flagged: summary.flagged },
    })
  })
  return summary
}

export async function importTimeFromProjets(ctx: Ctx, projectId: number): Promise<ImportSummary> {
  const { integrations } = getSettings(ctx.db)
  const projets = ctx.integrations.projets(integrations.projetsUrl)
  const { rows, truncated } = await projets.timeEntries(projectId)
  return applyTimeSnapshot(ctx, projectId, rows, truncated)
}

export async function listProjetsProjects(ctx: Ctx) {
  const { integrations } = getSettings(ctx.db)
  const local = projectSummaries(ctx)
  try {
    const remote = await ctx.integrations.projets(integrations.projetsUrl).listProjects()
    return {
      online: true,
      projects: remote.map((p) => ({ ...p, ...(local.find((l) => l.projectId === p.id) ?? emptySummary(p.id)) })),
    }
  } catch {
    return {
      online: false,
      projects: local.map((l) => ({ id: l.projectId, name: l.projectName, ...l })),
    }
  }
}

function emptySummary(projectId: number) {
  return { projectId, projectName: '', unbilledMinutes: 0, unbilledEntries: 0, billedMinutes: 0, flagged: 0, firstUnbilled: null as string | null, lastUnbilled: null as string | null }
}

/** Temps non facturé / facturé par projet (tableau de bord, écran Temps). */
export function projectSummaries(ctx: Ctx) {
  return ctx.db
    .select({
      projectId: timeEntries.projetsProjectId,
      projectName: sql<string>`max(${timeEntries.projetsProjectName})`,
      unbilledMinutes: sql<number>`coalesce(sum(case when ${timeEntries.invoiceLineId} is null then ${timeEntries.minutes} end), 0)`,
      unbilledEntries: sql<number>`coalesce(sum(case when ${timeEntries.invoiceLineId} is null then 1 end), 0)`,
      billedMinutes: sql<number>`coalesce(sum(case when ${timeEntries.invoiceLineId} is not null then ${timeEntries.minutes} end), 0)`,
      flagged: sql<number>`coalesce(sum(case when ${timeEntries.changedAfterBilling} or ${timeEntries.removedInProjets} then 1 end), 0)`,
      firstUnbilled: sql<string | null>`min(case when ${timeEntries.invoiceLineId} is null then ${timeEntries.spentOn} end)`,
      lastUnbilled: sql<string | null>`max(case when ${timeEntries.invoiceLineId} is null then ${timeEntries.spentOn} end)`,
    })
    .from(timeEntries)
    .groupBy(timeEntries.projetsProjectId)
    .orderBy(asc(sql`max(${timeEntries.projetsProjectName})`))
    .all()
}

export function listTimeEntries(ctx: Ctx, options: { projectId?: number; billed?: 'all' | 'unbilled' | 'billed' | 'flagged'; from?: string; to?: string }) {
  const filters = []
  if (options.projectId !== undefined) filters.push(eq(timeEntries.projetsProjectId, options.projectId))
  if (options.from) filters.push(gte(timeEntries.spentOn, options.from))
  if (options.to) filters.push(lte(timeEntries.spentOn, options.to))
  if (options.billed === 'unbilled') filters.push(isNull(timeEntries.invoiceLineId))
  if (options.billed === 'billed') filters.push(isNotNull(timeEntries.invoiceLineId))
  if (options.billed === 'flagged') filters.push(sql`(${timeEntries.changedAfterBilling} or ${timeEntries.removedInProjets})`)
  return ctx.db
    .select()
    .from(timeEntries)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(asc(timeEntries.spentOn), asc(timeEntries.id))
    .all()
}

export function acknowledgeTimeFlags(ctx: Ctx, entryIds: readonly number[]) {
  if (entryIds.length === 0) return { updated: 0 }
  ctx.db.update(timeEntries).set({ changedAfterBilling: false }).where(inArray(timeEntries.id, [...entryIds])).run()
  const removed = ctx.db.select().from(timeEntries).where(and(inArray(timeEntries.id, [...entryIds]), eq(timeEntries.removedInProjets, true))).all()
  return { updated: entryIds.length, stillRemovedInProjets: removed.length }
}

export interface InvoiceFromTimeInput {
  clientId: number
  projectId: number
  from?: string
  to?: string
  /** Saisies précises (sinon : toutes les saisies non facturées du projet dans la période). */
  entryIds?: number[]
  unit: TimeUnit
  rateCents?: number
  hoursPerDay?: number
  vatRateBps?: number
  grouping?: TimeGrouping
  title?: string
  opportunityId?: number | null
}

/** Aperçu des lignes (sans rien écrire) : même calcul que la création. */
export function previewInvoiceFromTime(ctx: Ctx, input: InvoiceFromTimeInput) {
  const settings = getSettings(ctx.db)
  const entries = selectEntries(ctx, input)
  const hoursPerDay = input.hoursPerDay ?? settings.billing.hoursPerDay
  const rateCents = input.rateCents ?? (input.unit === 'DAY' ? settings.billing.defaultDailyRateCents : Math.round(settings.billing.defaultDailyRateCents / hoursPerDay))
  const lines = buildTimeLines(entries, {
    unit: input.unit,
    hoursPerDay,
    rateCents,
    vatRateBps: input.vatRateBps ?? settings.billing.defaultVatRateBps,
    grouping: input.grouping ?? 'WORK_ITEM',
  })
  const days = entries.map((e) => e.spentOn).sort()
  return { entries, lines, hoursPerDay, rateCents, serviceStart: days[0] ?? null, serviceEnd: days[days.length - 1] ?? null }
}

function selectEntries(ctx: Ctx, input: InvoiceFromTimeInput) {
  const filters = [eq(timeEntries.projetsProjectId, input.projectId), isNull(timeEntries.invoiceLineId), eq(timeEntries.removedInProjets, false)]
  if (input.from) filters.push(gte(timeEntries.spentOn, input.from))
  if (input.to) filters.push(lte(timeEntries.spentOn, input.to))
  if (input.entryIds) {
    if (input.entryIds.length === 0) throw badRequest('Sélectionnez au moins une saisie de temps')
    filters.push(inArray(timeEntries.id, input.entryIds))
  }
  const entries = ctx.db.select().from(timeEntries).where(and(...filters)).orderBy(asc(timeEntries.spentOn), asc(timeEntries.id)).all()
  if (input.entryIds && entries.length !== new Set(input.entryIds).size) {
    throw conflict('Certaines saisies sont déjà facturées, supprimées dans Projets ou d’un autre projet : réimportez le temps')
  }
  return entries
}

export function createInvoiceFromTime(ctx: Ctx, input: InvoiceFromTimeInput) {
  requireClient(ctx.db, input.clientId)
  const preview = previewInvoiceFromTime(ctx, input)
  if (preview.entries.length === 0) throw badRequest('Aucune saisie de temps non facturée pour ce projet et cette période')
  const projectName = preview.entries[0]!.projetsProjectName
  const id = ctx.db.transaction((tx) => {
    const invoiceId = createInvoice(
      ctx,
      {
        clientId: input.clientId,
        title: input.title?.trim() || `${projectName} — ${preview.serviceStart === preview.serviceEnd ? preview.serviceStart : `${preview.serviceStart} au ${preview.serviceEnd}`}`,
        opportunityId: input.opportunityId ?? null,
        serviceStart: preview.serviceStart,
        serviceEnd: preview.serviceEnd,
        lines: [],
      },
      tx,
    )
    // Lignes écrites dans l'ordre de l'aperçu : lineIds[i] correspond à preview.lines[i] et à ses saisies.
    const lineIds = writeInvoiceLines(
      tx,
      invoiceId,
      preview.lines.map(({ entryIds: _ids, quantityMilli, ...line }) => ({ ...line, quantity: quantityMilli / 1000 })),
    )
    preview.lines.forEach((line, index) => {
      tx.update(timeEntries).set({ invoiceLineId: lineIds[index]! }).where(inArray(timeEntries.id, line.entryIds)).run()
    })
    return invoiceId
  })
  return getInvoice(ctx, id)
}
