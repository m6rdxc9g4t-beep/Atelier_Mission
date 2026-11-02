// Liste des factures : filtres par statut (en retard compris) et canal, totaux de la sélection.
import { Clock3, Plus, Receipt, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Card, ChannelBadge, EmptyState, ErrorBox, Input, InvoiceBadge, Loading, Money, PageHeader } from '../components/ui.tsx'
import { api, qs } from '../lib/api.ts'
import { date } from '../lib/format.ts'
import { INVOICE_STATUS_LABEL } from '../lib/labels.ts'
import { href, navigate, useRoute } from '../lib/router.ts'
import type { Channel, InvoiceStatus, InvoiceSummary } from '../lib/types.ts'
import { useApi } from '../lib/use-api.ts'
import { NewDocumentDialog } from './QuotesView.tsx'

const FILTERS: (InvoiceStatus | '')[] = ['', 'DRAFT', 'ISSUED', 'OVERDUE', 'PARTIALLY_PAID', 'PAID', 'CANCELLED']

export function InvoicesView() {
  const { query } = useRoute()
  const [status, setStatus] = useState<InvoiceStatus | ''>('')
  const [channel, setChannel] = useState<Channel | ''>('')
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState<string | null>(null)
  const { data, error, loading, reload } = useApi(() => api.get<Required<InvoiceSummary>[]>(`/invoices${qs({ status, channel, q })}`), [status, channel, q])

  useEffect(() => {
    const client = query.get('nouvelle')
    if (client) {
      setCreating(client)
      navigate('/factures')
    }
  }, [query])

  const total = (data ?? []).reduce((s, i) => s + (i.kind === 'INVOICE' ? i.totalTtcCents : 0), 0)
  const balance = (data ?? []).reduce((s, i) => s + (i.status === 'ISSUED' || i.status === 'OVERDUE' || i.status === 'PARTIALLY_PAID' ? i.balanceCents : 0), 0)

  return (
    <>
      <PageHeader
        title="Factures"
        subtitle={data ? `${data.length} facture${data.length > 1 ? 's' : ''} · ${new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(total / 100)} TTC · reste à encaisser ${new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(balance / 100)}` : undefined}
        actions={
          <>
            <Button icon={<Clock3 className="size-4" />} onClick={() => navigate('/temps')}>
              Depuis le temps passé
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating('')}>
              Nouvelle facture
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrer par statut">
          {FILTERS.map((s) => (
            <Button key={s || 'all'} size="sm" variant={status === s ? 'primary' : 'ghost'} aria-pressed={status === s} onClick={() => setStatus(s)}>
              {s ? INVOICE_STATUS_LABEL[s] : 'Toutes'}
            </Button>
          ))}
        </div>
        <div className="flex gap-1" role="group" aria-label="Filtrer par canal">
          {(['', 'MALT', 'DIRECT'] as const).map((c) => (
            <Button key={c || 'all'} size="sm" variant={channel === c ? 'primary' : 'ghost'} aria-pressed={channel === c} onClick={() => setChannel(c)}>
              {c === '' ? 'Tous canaux' : c === 'MALT' ? 'Malt' : 'Direct'}
            </Button>
          ))}
        </div>
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input className="!pl-9" placeholder="Numéro, client, intitulé…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />
        </div>
      </div>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && data.length === 0 && (
        <Card>
          <EmptyState icon={<Receipt />} title="Aucune facture ici">
            Créez une facture à partir d’un devis accepté, du temps saisi dans Atelier Projets, ou directement.
          </EmptyState>
        </Card>
      )}
      {data && data.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="ds-table">
            <thead>
              <tr>
                <th>Numéro</th>
                <th>Client</th>
                <th>Intitulé</th>
                <th>Émise</th>
                <th>Échéance</th>
                <th className="ds-num">TTC</th>
                <th className="ds-num">Reste</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {data.map((i) => (
                <tr key={i.id} className="cursor-pointer" onClick={() => navigate(`/factures/${i.id}`)}>
                  <td>
                    <a href={href(`/factures/${i.id}`)} className="font-medium hover:underline">
                      {i.displayNumber}
                    </a>
                    {i.kind === 'CREDIT_NOTE' && <span className="ml-2 text-xs text-muted">avoir</span>}
                  </td>
                  <td>
                    <span className="flex items-center gap-2">
                      {i.clientName} {i.channel === 'MALT' && <ChannelBadge channel="MALT" />}
                    </span>
                  </td>
                  <td className="max-w-xs truncate">{i.title}</td>
                  <td className="text-muted">{i.issueDate ? date(i.issueDate) : '—'}</td>
                  <td className="text-muted">{i.dueDate ? date(i.dueDate) : '—'}</td>
                  <td className="ds-num">
                    <Money cents={i.totalTtcCents} />
                  </td>
                  <td className="ds-num">{i.balanceCents !== 0 && i.status !== 'DRAFT' && i.status !== 'CANCELLED' ? <Money cents={i.balanceCents} tone={i.status === 'OVERDUE' ? 'late' : undefined} /> : '—'}</td>
                  <td>
                    <InvoiceBadge status={i.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <NewDocumentDialog open={creating !== null} onClose={() => setCreating(null)} kind="invoice" defaultClientId={creating ?? ''} />
    </>
  )
}
