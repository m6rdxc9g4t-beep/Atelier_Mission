// Temps saisi dans Atelier Projets → facture : importer les saisies d'un projet, choisir celles à facturer,
// prévisualiser les lignes (jours ou heures, regroupement), créer le brouillon. Une saisie facturée ne l'est qu'une fois.
import { AlertTriangle, CalendarCheck, CheckCheck, Clock3, Download, Receipt } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button, Card, EmptyState, ErrorBox, Eyebrow, Field, Input, Loading, Modal, Money, Notice, PageHeader, Segmented, Select, ToneBadge } from '../components/ui.tsx'
import { api, qs } from '../lib/api.ts'
import { centsToInput, dateShort, euros, hours, num, parseEuros, parseNumber } from '../lib/format.ts'
import { UNIT_LABEL } from '../lib/labels.ts'
import { navigate, useRoute } from '../lib/router.ts'
import type { Client, Invoice, Opportunity, ProjectSummary, TimeEntry } from '../lib/types.ts'
import { useAction, useApi } from '../lib/use-api.ts'
import { useSettings } from '../lib/use-settings.ts'

type Filter = 'unbilled' | 'billed' | 'flagged' | 'all'
const FILTER_LABEL: Record<Filter, string> = { unbilled: 'Non facturé', billed: 'Facturé', flagged: 'À vérifier', all: 'Tout' }

interface PreviewLine {
  label: string
  details: string
  unit: 'DAY' | 'HOUR'
  quantityMilli: number
  unitPriceCents: number
  entryIds: number[]
}

function BillDialog({ open, onClose, project, entryIds }: { open: boolean; onClose: () => void; project: ProjectSummary; entryIds: number[] }) {
  const { settings } = useSettings()
  const clients = useApi(() => api.get<Client[]>('/clients'), [open])
  const opps = useApi(() => api.get<Opportunity[]>('/opportunities'), [open])
  const { run, busy } = useAction()
  const linked = (opps.data ?? []).find((o) => o.projetsProjectId === project.id)
  const [form, setForm] = useState({ clientId: '', unit: 'DAY' as 'DAY' | 'HOUR', rate: '', hoursPerDay: '', grouping: 'WORK_ITEM', title: '' })
  const [preview, setPreview] = useState<{ lines: PreviewLine[]; serviceStart: string | null; serviceEnd: string | null } | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !settings) return
    setForm({
      clientId: linked ? String(linked.clientId) : '',
      unit: 'DAY',
      rate: centsToInput(linked?.dailyRateCents ?? settings.billing.defaultDailyRateCents),
      hoursPerDay: String(settings.billing.hoursPerDay).replace('.', ','),
      grouping: 'WORK_ITEM',
      title: '',
    })
  }, [open, settings, linked])

  const body = useMemo(
    () => ({
      clientId: Number(form.clientId),
      projectId: project.id,
      entryIds,
      unit: form.unit,
      rateCents: parseEuros(form.rate) ?? undefined,
      hoursPerDay: parseNumber(form.hoursPerDay) ?? undefined,
      grouping: form.grouping,
      ...(form.title.trim() ? { title: form.title.trim() } : {}),
      ...(linked ? { opportunityId: linked.id } : {}),
    }),
    [form, project.id, entryIds, linked],
  )

  useEffect(() => {
    if (!open || !form.clientId) return
    let cancelled = false
    api
      .post<{ lines: PreviewLine[]; serviceStart: string | null; serviceEnd: string | null }>('/invoices/from-time/preview', body)
      .then((p) => !cancelled && (setPreview(p), setPreviewError(null)))
      .catch((e: Error) => !cancelled && setPreviewError(e.message))
    return () => {
      cancelled = true
    }
  }, [open, body, form.clientId])

  const totalHt = (preview?.lines ?? []).reduce((s, l) => s + Math.round((l.quantityMilli * l.unitPriceCents) / 1000), 0)
  const create = async () => {
    const invoice = await run('create', () => api.post<Invoice>('/invoices/from-time', body), (i) => `Brouillon créé : ${euros(i.totalHtCents)} HT`)
    if (invoice) {
      onClose()
      navigate(`/factures/${invoice.id}`)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={`Facturer ${entryIds.length} saisie${entryIds.length > 1 ? 's' : ''} · ${project.name}`}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" icon={<Receipt className="size-4" />} busy={busy === 'create'} disabled={!form.clientId || !preview || preview.lines.length === 0} onClick={() => void create()}>
            Créer le brouillon
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Client facturé" className="md:col-span-2" hint={linked ? `Opportunité liée : ${linked.title}` : 'Liez le projet à une opportunité pour le préremplir'}>
          <Select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
            <option value="">— Choisir —</option>
            {(clients.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.channel === 'MALT' ? '· Malt' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Facturer en">
          <Select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value as 'DAY' | 'HOUR' })}>
            <option value="DAY">Jours (TJM)</option>
            <option value="HOUR">Heures</option>
          </Select>
        </Field>
        <Field label={form.unit === 'DAY' ? 'TJM (€ HT)' : 'Taux horaire (€ HT)'}>
          <Input inputMode="decimal" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
        </Field>
        {form.unit === 'DAY' && (
          <Field label="Heures par jour">
            <Input inputMode="decimal" value={form.hoursPerDay} onChange={(e) => setForm({ ...form, hoursPerDay: e.target.value })} />
          </Field>
        )}
        <Field label="Une ligne par">
          <Select value={form.grouping} onChange={(e) => setForm({ ...form, grouping: e.target.value })}>
            <option value="WORK_ITEM">Élément de travail</option>
            <option value="PROJECT">Projet (une seule ligne)</option>
            <option value="ENTRY">Saisie</option>
          </Select>
        </Field>
        <Field label="Intitulé de la facture" className="md:col-span-3">
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={`${project.name} — période`} />
        </Field>
      </div>
      <div className="mt-5">
        <Eyebrow className="mb-2">Aperçu des lignes</Eyebrow>
        {!form.clientId && <p className="text-sm text-muted">Choisissez le client pour voir l’aperçu.</p>}
        {previewError && <Notice tone="warn">{previewError}</Notice>}
        {preview && form.clientId && (
          <table className="ds-table">
            <tbody>
              {preview.lines.map((l) => (
                <tr key={l.entryIds.join('-')}>
                  <td>
                    <div className="font-medium">{l.label}</div>
                    <div className="text-xs text-muted">{l.details}</div>
                  </td>
                  <td className="ds-num">
                    {num(l.quantityMilli / 1000)} {UNIT_LABEL[l.unit]}
                    {l.quantityMilli > 1000 ? 's' : ''}
                  </td>
                  <td className="ds-num">{euros(l.unitPriceCents)}</td>
                  <td className="ds-num">
                    <Money cents={Math.round((l.quantityMilli * l.unitPriceCents) / 1000)} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Total HT</td>
                <td className="ds-num">{euros(totalHt)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </Modal>
  )
}

export function TimeView() {
  const { query } = useRoute()
  const projects = useApi(() => api.get<{ online: boolean; projects: ProjectSummary[] }>('/time/projects'))
  const [projectId, setProjectId] = useState<number | null>(null)
  const [filter, setFilter] = useState<Filter>((query.get('filtre') as Filter) || 'unbilled')
  const entries = useApi(() => (projectId || filter === 'flagged' ? api.get<TimeEntry[]>(`/time/entries${qs({ projectId: filter === 'flagged' ? undefined : projectId, billed: filter })}`) : Promise.resolve([] as TimeEntry[])), [projectId, filter])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [billing, setBilling] = useState(false)
  const { run, busy } = useAction()

  useEffect(() => {
    if (projectId === null && projects.data?.projects.length) {
      const withTime = projects.data.projects.find((p) => p.unbilledMinutes > 0) ?? projects.data.projects[0]
      if (withTime) setProjectId(withTime.id)
    }
  }, [projects.data, projectId])
  useEffect(() => {
    setSelected(new Set((entries.data ?? []).filter((e) => e.invoiceLineId === null && !e.removedInProjets).map((e) => e.id)))
  }, [entries.data])

  const project = projects.data?.projects.find((p) => p.id === projectId) ?? null
  const selectedMinutes = (entries.data ?? []).filter((e) => selected.has(e.id)).reduce((s, e) => s + e.minutes, 0)

  return (
    <>
      <PageHeader title="Temps passé" subtitle="Les saisies d’Atelier Projets deviennent des lignes de facture — chacune n’est facturée qu’une fois." />
      {projects.data && !projects.data.online && (
        <div className="mb-4">
          <Notice tone="warn">
            Atelier Projets ne répond pas (http://127.0.0.1:3000). Vous voyez les saisies déjà importées ; lancez Projets pour réimporter.
          </Notice>
        </div>
      )}
      {projects.error && <ErrorBox error={projects.error} onRetry={projects.reload} />}
      {projects.loading && !projects.data && <Loading />}
      {projects.data && projects.data.projects.length === 0 && (
        <Card>
          <EmptyState icon={<CalendarCheck />} title="Aucun projet">
            Créez un projet et saisissez du temps dans Atelier Projets, puis revenez ici pour l’importer.
          </EmptyState>
        </Card>
      )}
      {projects.data && projects.data.projects.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <Card className="h-fit p-1.5">
            <Eyebrow className="px-2 pb-1 pt-1.5">Projets</Eyebrow>
            <ul className="flex flex-col gap-px">
              {projects.data.projects.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => { setProjectId(p.id); if (filter === 'flagged') setFilter('unbilled') }} aria-current={p.id === projectId ? 'true' : undefined} className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm ${p.id === projectId ? 'bg-selected' : 'hover:bg-hover'}`}>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="block text-xs text-muted">{p.unbilledMinutes ? `${hours(p.unbilledMinutes)} à facturer` : p.billedMinutes ? 'Tout est facturé' : 'Pas encore importé'}</span>
                    </span>
                    {p.flagged > 0 && <AlertTriangle className="size-4 shrink-0 ds-ink" data-money="late" aria-label="Saisies à vérifier" />}
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <div className="flex min-w-0 flex-col gap-3">
            {project && (
              <Card className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{project.name}</div>
                  <div className="text-xs text-muted">
                    {hours(project.unbilledMinutes)} non facturées{project.firstUnbilled ? ` · du ${dateShort(project.firstUnbilled)} au ${dateShort(project.lastUnbilled)}` : ''} · {hours(project.billedMinutes)} déjà facturées
                  </div>
                </div>
                <Button icon={<Download />} busy={busy === 'import'} disabled={!projects.data.online} onClick={() => void run('import', () => api.post<{ created: number; updated: number; removed: number; flagged: number }>('/time/import', { projectId: project.id }), (r) => `Import : ${r.created} nouvelle(s), ${r.updated} modifiée(s), ${r.removed} retirée(s)${r.flagged ? ` · ${r.flagged} à vérifier` : ''}`)}>
                  Importer depuis Projets
                </Button>
                <Button variant="primary" icon={<Receipt />} disabled={selected.size === 0} onClick={() => setBilling(true)}>
                  Facturer {selected.size > 0 ? `${hours(selectedMinutes)}` : ''}
                </Button>
              </Card>
            )}

            <Segmented label="Filtrer les saisies" options={(Object.keys(FILTER_LABEL) as Filter[]).map((f) => ({ value: f, label: FILTER_LABEL[f] }))} value={filter} onChange={setFilter} />

            {entries.loading && !entries.data && <Loading />}
            {entries.data && entries.data.length === 0 && (
              <Card>
                <EmptyState icon={<Clock3 />} title={filter === 'unbilled' ? 'Rien à facturer' : 'Aucune saisie'}>
                  {filter === 'unbilled' ? 'Toutes les saisies importées sont facturées. Importez à nouveau après avoir saisi du temps dans Projets.' : null}
                </EmptyState>
              </Card>
            )}
            {entries.data && entries.data.length > 0 && (
              <Card className="overflow-x-auto">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th className="w-8">
                        <input
                          type="checkbox"
                          aria-label="Tout sélectionner"
                          className="size-4 accent-[var(--accent)]"
                          checked={entries.data.filter((e) => e.invoiceLineId === null).every((e) => selected.has(e.id))}
                          onChange={(e) => setSelected(new Set(e.target.checked ? entries.data!.filter((x) => x.invoiceLineId === null && !x.removedInProjets).map((x) => x.id) : []))}
                        />
                      </th>
                      <th>Date</th>
                      <th>Élément</th>
                      <th>Commentaire</th>
                      <th className="ds-num">Durée</th>
                      <th>État</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.data.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Sélectionner ${e.workItemTitle} du ${dateShort(e.spentOn)}`}
                            className="size-4 accent-[var(--accent)]"
                            disabled={e.invoiceLineId !== null || e.removedInProjets}
                            checked={selected.has(e.id)}
                            onChange={(ev) => {
                              const next = new Set(selected)
                              if (ev.target.checked) next.add(e.id)
                              else next.delete(e.id)
                              setSelected(next)
                            }}
                          />
                        </td>
                        <td className="whitespace-nowrap text-muted">{dateShort(e.spentOn)}</td>
                        <td>
                          <span className="text-muted">#{e.workItemId}</span> {e.workItemTitle}
                          {filter === 'flagged' && <span className="block text-xs text-muted">{e.projetsProjectName}</span>}
                        </td>
                        <td className="max-w-xs truncate text-muted">{e.comment || '—'}</td>
                        <td className="ds-num">{hours(e.minutes)}</td>
                        <td>
                          {e.removedInProjets ? (
                            <ToneBadge tone="FAILED">Supprimée dans Projets</ToneBadge>
                          ) : e.changedAfterBilling ? (
                            <ToneBadge tone="DUE">Modifiée après facturation</ToneBadge>
                          ) : e.invoiceLineId ? (
                            <ToneBadge tone="SENT">Facturée</ToneBadge>
                          ) : (
                            <ToneBadge tone="PLANNED">À facturer</ToneBadge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filter === 'flagged' && (
                  <div className="flex justify-end border-t border-line p-3">
                    <Button size="sm" icon={<CheckCheck className="size-4" />} busy={busy === 'ack'} onClick={() => void run('ack', () => api.post('/time/acknowledge', { entryIds: entries.data!.map((e) => e.id) }), 'Écarts marqués comme vérifiés')}>
                      Marquer comme vérifié
                    </Button>
                  </div>
                )}
              </Card>
            )}
          </div>
        </div>
      )}
      {project && <BillDialog open={billing} onClose={() => setBilling(false)} project={project} entryIds={[...selected]} />}
    </>
  )
}
