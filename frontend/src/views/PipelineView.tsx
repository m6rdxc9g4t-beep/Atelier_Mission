// Pipeline en colonnes : glisser-déposer entre étapes (souris) ou menu « Déplacer vers » (clavier, mobile).
import { CalendarClock, ExternalLink, KanbanSquare, Plus } from 'lucide-react'
import { useEffect, useMemo, useState, type DragEvent } from 'react'
import { OpportunityForm } from '../components/OpportunityForm.tsx'
import { Button, Card, ChannelBadge, EmptyState, ErrorBox, Loading, Money, PageHeader, StageBadge } from '../components/ui.tsx'
import { api } from '../lib/api.ts'
import { eurosRound, relativeDays, todayIso } from '../lib/format.ts'
import { SOURCE_LABEL, STAGE_LABEL, STAGES } from '../lib/labels.ts'
import { navigate, useRoute } from '../lib/router.ts'
import type { Opportunity, Stage } from '../lib/types.ts'
import { useAction, useApi } from '../lib/use-api.ts'

export function PipelineView() {
  const { query } = useRoute()
  const { data, error, loading, reload, setData } = useApi(() => api.get<Opportunity[]>('/opportunities'))
  const { run } = useAction()
  const [editing, setEditing] = useState<Opportunity | null>(null)
  const [creating, setCreating] = useState<Stage | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  const [over, setOver] = useState<Stage | null>(null)
  const [showClosed, setShowClosed] = useState(false)
  const today = todayIso()

  useEffect(() => {
    if (query.get('nouveau') === '1') {
      setCreating('NEW')
      navigate('/pipeline')
    }
  }, [query])

  const columns = useMemo(() => {
    const byStage = new Map<Stage, Opportunity[]>(STAGES.map((s) => [s, []]))
    for (const opp of data ?? []) byStage.get(opp.stage)?.push(opp)
    for (const list of byStage.values()) list.sort((a, b) => a.position - b.position)
    return byStage
  }, [data])

  const move = async (opp: Opportunity, stage: Stage, position?: number) => {
    if (opp.stage === stage && position === undefined) return
    // Mise à jour optimiste : la carte change de colonne tout de suite.
    setData((list) => list?.map((o) => (o.id === opp.id ? { ...o, stage } : o)) ?? null)
    await run('move', () => api.post<Opportunity>(`/opportunities/${opp.id}/move`, { stage, ...(position !== undefined ? { position } : {}) }), `« ${opp.title} » → ${STAGE_LABEL[stage]}`)
  }

  const onDrop = (stage: Stage) => (event: DragEvent) => {
    event.preventDefault()
    setOver(null)
    const opp = data?.find((o) => o.id === dragId)
    if (opp) void move(opp, stage)
    setDragId(null)
  }

  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (loading && !data) return <Loading />

  const visible = showClosed ? STAGES : STAGES.filter((s) => s !== 'WON' && s !== 'LOST')
  const open = (data ?? []).filter((o) => o.stage !== 'WON' && o.stage !== 'LOST')

  return (
    <>
      <PageHeader
        title="Pipeline"
        subtitle={`${open.length} opportunité${open.length > 1 ? 's' : ''} en cours · ${eurosRound(open.reduce((s, o) => s + o.amountCents, 0))} HT · pondéré ${eurosRound(open.reduce((s, o) => s + o.weightedCents, 0))}`}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => setShowClosed((v) => !v)}>
              {showClosed ? 'Masquer gagnés / perdus' : 'Afficher gagnés / perdus'}
            </Button>
            <Button variant="primary" icon={<Plus />} onClick={() => setCreating('NEW')}>
              Nouveau prospect
            </Button>
          </>
        }
      />

      {data && data.length === 0 ? (
        <Card>
          <EmptyState icon={<KanbanSquare />} title="Aucun prospect pour l’instant" action={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating('NEW')}>Ajouter un prospect Malt</Button>}>
            Ajoutez une demande reçue sur Malt ou un contact direct : elle avancera de « Nouveau » à « Gagné » au fil des devis.
          </EmptyState>
        </Card>
      ) : (
        <div className="-mx-4 flex snap-x gap-2.5 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
          {visible.map((stage) => {
            const list = columns.get(stage) ?? []
            const total = list.reduce((s, o) => s + o.amountCents, 0)
            return (
              <section
                key={stage}
                aria-label={STAGE_LABEL[stage]}
                className="ms-column flex w-72 shrink-0 snap-start flex-col rounded-lg border border-line bg-sidebar p-1.5 xl:w-auto xl:min-w-56 xl:flex-1"
                data-drop={over === stage ? 'over' : undefined}
                onDragOver={(e) => {
                  e.preventDefault()
                  setOver(stage)
                }}
                onDragLeave={() => setOver((o) => (o === stage ? null : o))}
                onDrop={onDrop(stage)}
              >
                <header className="mb-1.5 flex min-h-8 items-center justify-between gap-2 px-1.5">
                  <StageBadge stage={stage} />
                  <span className="ms-num text-xs text-muted">
                    {list.length} · {eurosRound(total)}
                  </span>
                </header>
                <div className="flex min-h-24 flex-1 flex-col gap-1.5">
                  {list.map((opp) => (
                    <article
                      key={opp.id}
                      draggable
                      onDragStart={(e) => {
                        setDragId(opp.id)
                        e.dataTransfer.effectAllowed = 'move'
                      }}
                      onDragEnd={() => setDragId(null)}
                      data-dragging={dragId === opp.id}
                      className="ms-card ds-card cursor-grab p-2.5 transition-colors hover:border-line-soft active:cursor-grabbing"
                    >
                      <button type="button" className="block w-full text-left" onClick={() => setEditing(opp)}>
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-semibold leading-snug">{opp.title}</h3>
                          {opp.clientChannel && <ChannelBadge channel={opp.clientChannel} />}
                        </div>
                        <p className="mt-0.5 text-xs text-muted">
                          {opp.clientName} · {SOURCE_LABEL[opp.source]}
                        </p>
                        <div className="mt-2 flex items-center justify-between text-sm">
                          <Money cents={opp.amountCents} className="font-semibold" />
                          <span className="ms-num text-xs text-muted">{opp.probability} %</span>
                        </div>
                        {opp.nextAction && (
                          <p className="mt-2 flex items-center gap-1.5 text-xs" data-money={opp.nextActionDate && opp.nextActionDate < today ? 'late' : undefined}>
                            <CalendarClock className={`size-3.5 shrink-0 ${opp.nextActionDate && opp.nextActionDate < today ? 'ds-ink' : 'text-faint'}`} aria-hidden />
                            <span className="truncate">
                              {opp.nextAction}
                              {opp.nextActionDate ? ` · ${relativeDays(opp.nextActionDate, today)}` : ''}
                            </span>
                          </p>
                        )}
                        {opp.stage === 'LOST' && opp.lostReason && <p className="mt-2 text-xs text-muted">Motif : {opp.lostReason}</p>}
                      </button>
                      <div className="mt-2 flex items-center gap-1 border-t border-line pt-2">
                        <label className="sr-only" htmlFor={`move-${opp.id}`}>
                          Déplacer vers
                        </label>
                        <select id={`move-${opp.id}`} className="ds-select !min-h-7 flex-1 !py-0.5 !text-xs" value={opp.stage} onChange={(e) => void move(opp, e.target.value as Stage)}>
                          {STAGES.map((s) => (
                            <option key={s} value={s}>
                              {STAGE_LABEL[s]}
                            </option>
                          ))}
                        </select>
                        {opp.maltUrl && (
                          <a className="ds-btn" data-size="sm" data-icon-only="" href={opp.maltUrl} target="_blank" rel="noreferrer" aria-label="Ouvrir sur Malt" title="Ouvrir sur Malt">
                            <ExternalLink className="size-3.5" />
                          </a>
                        )}
                      </div>
                    </article>
                  ))}
                  <button type="button" className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted hover:bg-hover hover:text-fg" onClick={() => setCreating(stage)}>
                    <Plus className="size-3.5" aria-hidden /> Ajouter
                  </button>
                </div>
              </section>
            )
          })}
        </div>
      )}

      <OpportunityForm open={editing !== null || creating !== null} opportunity={editing} defaultStage={creating ?? 'NEW'} onClose={() => { setEditing(null); setCreating(null) }} />
    </>
  )
}
