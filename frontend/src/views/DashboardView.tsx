// Tableau de bord : où en est l'argent (encaissé, à encaisser, en retard), le pipeline, le temps non facturé,
// et ce qu'il faut faire aujourd'hui (prochaines actions, relances dues, devis qui expirent).
import { AlarmClock, ArrowRight, Banknote, CalendarClock, Clock3, FileWarning, Hourglass, Mail, Plus, Target, TrendingUp, Wallet } from 'lucide-react'
import { api } from '../lib/api.ts'
import { date, euros, eurosRound, hours, monthLabel, relativeDays } from '../lib/format.ts'
import { href, navigate } from '../lib/router.ts'
import type { Dashboard } from '../lib/types.ts'
import { useApi } from '../lib/use-api.ts'
import { Button, Card, ChannelBadge, EmptyState, ErrorBox, Eyebrow, Kpi, Loading, Money, PageHeader, StageBadge } from '../components/ui.tsx'

function MonthlyChart({ series }: { series: Dashboard['series'] }) {
  const max = Math.max(1, ...series.flatMap((m) => [m.collectedCents, m.billedHtCents]))
  return (
    <Card className="p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>12 derniers mois</Eyebrow>
        <div className="flex items-center gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="ms-legend size-2 rounded-xs" data-series="collected" /> Encaissé
          </span>
          <span className="flex items-center gap-1.5">
            <span className="ms-legend size-2 rounded-xs" data-series="billed" /> Facturé HT
          </span>
        </div>
      </div>
      <div className="flex h-44 items-end gap-1.5" role="img" aria-label="Encaissé et facturé par mois">
        {series.map((m) => (
          <div key={m.month} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${monthLabel(m.month)} : encaissé ${euros(m.collectedCents)}, facturé ${euros(m.billedHtCents)} HT`}>
            <div className="flex h-full w-full items-end justify-center gap-0.5 border-b border-line">
              <div className="ms-bar w-1/2 max-w-3" data-series="collected" style={{ height: `${(m.collectedCents / max) * 100}%` }} />
              <div className="ms-bar w-1/2 max-w-3" data-series="billed" data-empty={m.billedHtCents === 0 || undefined} style={{ height: `${(m.billedHtCents / max) * 100}%` }} />
            </div>
            <span className="pt-1 text-[11px] text-faint">{monthLabel(m.month)}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

function AgendaRow({ to, icon, title, meta, right, tone }: { to: string; icon: React.ReactNode; title: React.ReactNode; meta: React.ReactNode; right?: React.ReactNode; tone?: 'late' }) {
  return (
    <a href={href(to)} className="-mx-2 flex min-h-12 items-center gap-3 rounded-md px-2 py-1.5 no-underline hover:bg-hover" data-money={tone}>
      <span className={`shrink-0 [&>svg]:size-4 ${tone ? 'ds-ink' : 'text-faint'}`} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted">{meta}</span>
      </span>
      <span className="shrink-0 text-sm">{right}</span>
    </a>
  )
}

export function DashboardView() {
  const { data, error, loading, reload } = useApi(() => api.get<Dashboard>('/dashboard'))
  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (loading && !data) return <Loading />
  if (!data) return null
  const { kpis, agenda } = data
  const agendaEmpty = agenda.nextActions.length + agenda.dueReminders.length + agenda.overdueInvoices.length + agenda.expiringQuotes.length === 0

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        subtitle={`Aujourd’hui, ${date(data.today)}`}
        actions={
          <>
            <Button icon={<Plus />} onClick={() => navigate('/pipeline?nouveau=1')}>
              Prospect
            </Button>
            <Button variant="primary" icon={<Clock3 />} onClick={() => navigate('/temps')}>
              Facturer le temps
            </Button>
          </>
        }
      />

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Indicateurs">
        <Kpi label="Encaissé ce mois" value={eurosRound(kpis.collectedMonthCents)} hint={`${eurosRound(kpis.collectedYearCents)} depuis janvier`} icon={<Banknote />} tone="in" />
        <Kpi label="À encaisser" value={eurosRound(kpis.outstandingCents)} hint={`${kpis.outstandingCount} facture${kpis.outstandingCount > 1 ? 's' : ''} ouverte${kpis.outstandingCount > 1 ? 's' : ''}`} icon={<Wallet />} />
        <Kpi
          label="En retard"
          value={eurosRound(kpis.overdueCents)}
          hint={kpis.overdueCount ? `${kpis.overdueCount} facture${kpis.overdueCount > 1 ? 's' : ''} échue${kpis.overdueCount > 1 ? 's' : ''}` : 'Aucun retard'}
          icon={<AlarmClock />}
          tone={kpis.overdueCount ? 'late' : undefined}
        />
        <Kpi
          label="Pipeline pondéré"
          value={eurosRound(kpis.pipelineWeightedCents)}
          hint={`${kpis.openOpportunities} en cours · conversion ${kpis.conversionRate === null ? '—' : `${kpis.conversionRate} %`} sur 12 mois`}
          icon={<Target />}
        />
      </section>

      {(kpis.unbilledMinutes > 0 || kpis.paymentsToSync > 0) && (
        <section className="mt-3 grid gap-3 md:grid-cols-2">
          {kpis.unbilledMinutes > 0 && (
            <Card className="flex items-center gap-3 px-4 py-3">
              <Hourglass className="size-4 shrink-0 text-faint" aria-hidden />
              <div className="flex-1 text-sm">
                <strong className="font-semibold">{hours(kpis.unbilledMinutes)} non facturées</strong> dans Atelier Projets
                <span className="text-muted"> · environ {eurosRound(kpis.unbilledValueCents)} au TJM par défaut</span>
              </div>
              <Button size="sm" icon={<ArrowRight />} onClick={() => navigate('/temps')}>
                Facturer
              </Button>
            </Card>
          )}
          {kpis.paymentsToSync > 0 && (
            <Card className="flex items-center gap-3 px-4 py-3">
              <Banknote className="size-4 shrink-0 text-faint" aria-hidden />
              <div className="flex-1 text-sm">
                <strong className="font-semibold">{kpis.paymentsToSync} encaissement{kpis.paymentsToSync > 1 ? 's' : ''}</strong> pas encore dans Atelier Trésorerie
              </div>
              <Button size="sm" onClick={() => navigate('/parametres?onglet=connexions')}>
                Voir
              </Button>
            </Card>
          )}
        </section>
      )}

      <section className="mt-3 grid gap-3 xl:grid-cols-[1.4fr_1fr]">
        <div className="flex min-w-0 flex-col gap-3">
          <MonthlyChart series={data.series} />
          {/* Montants par étape : une rangée de cartes de chiffres (.atelier-kpi), espacées */}
          <section className="flex flex-col gap-2" aria-label="Pipeline en cours">
            <div className="flex items-center justify-between">
              <Eyebrow>Pipeline en cours</Eyebrow>
              <a href={href('/pipeline')} className="text-xs font-medium text-accent-ink hover:underline">
                Ouvrir le pipeline
              </a>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {data.pipeline.map((col) => (
                <a key={col.stage} href={href('/pipeline')} className="atelier-kpi no-underline">
                  <span className="atelier-kpi__label">
                    <StageBadge stage={col.stage} />
                  </span>
                  <span className="atelier-kpi__value">{eurosRound(col.amountCents)}</span>
                  <span className="atelier-kpi__note">
                    {col.count} opportunité{col.count > 1 ? 's' : ''}
                  </span>
                </a>
              ))}
            </div>
          </section>
        </div>

        <Card className="min-w-0 p-4">
          <div className="mb-2 flex items-center gap-2">
            <TrendingUp className="size-4 text-faint" aria-hidden />
            <Eyebrow>À faire</Eyebrow>
          </div>
          {agendaEmpty ? (
            <EmptyState icon={<CalendarClock />} title="Rien d’urgent">
              Aucune relance due, aucun retard, aucune action prévue cette semaine.
            </EmptyState>
          ) : (
            <div className="flex flex-col">
              {agenda.dueReminders.map((r) => (
                <AgendaRow
                  key={`r${r.id}`}
                  to="/relances"
                  icon={<Mail />}
                  tone="late"
                  title={`${r.levelLabel} · ${r.clientName}`}
                  meta={`${r.invoiceNumber ?? 'Facture'} · ${r.daysLate} j de retard${r.state === 'FAILED' ? ' · échec du dernier envoi' : ''}`}
                  right={<Money cents={r.balanceCents} />}
                />
              ))}
              {agenda.overdueInvoices
                .filter((i) => !agenda.dueReminders.some((r) => r.invoiceId === i.id))
                .map((i) => (
                  <AgendaRow
                    key={`i${i.id}`}
                    to={`/factures/${i.id}`}
                    icon={<FileWarning />}
                    tone="late"
                    title={`${i.number ?? 'Facture'} · ${i.clientName}`}
                    meta={<>Échue {i.dueDate ? relativeDays(i.dueDate, data.today) : ''} {i.channel === 'MALT' && <ChannelBadge channel="MALT" />}</>}
                    right={<Money cents={i.balanceCents} tone="late" />}
                  />
                ))}
              {agenda.nextActions.map((o) => (
                <AgendaRow
                  key={`o${o.id}`}
                  to="/pipeline"
                  icon={<Target />}
                  tone={o.late ? 'late' : undefined}
                  title={o.nextAction || o.title}
                  meta={`${o.clientName} · ${o.title} · ${o.nextActionDate ? relativeDays(o.nextActionDate, data.today) : ''}`}
                  right={<StageBadge stage={o.stage} />}
                />
              ))}
              {agenda.expiringQuotes.map((q) => (
                <AgendaRow key={`q${q.id}`} to={`/devis/${q.id}`} icon={<CalendarClock />} title={`Devis ${q.number} expire ${relativeDays(q.validUntil, data.today)}`} meta={`${q.clientName} · ${q.title}`} right={<Money cents={q.totalHtCents} />} />
              ))}
            </div>
          )}
        </Card>
      </section>
    </>
  )
}
