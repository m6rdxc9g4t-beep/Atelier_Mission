// Liste des devis + création rapide (client, intitulé) qui ouvre l'éditeur.
import { FileText, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Card, ChannelBadge, EmptyState, ErrorBox, Field, Input, Loading, Modal, Money, PageHeader, QuoteBadge, Select } from '../components/ui.tsx'
import { api, qs } from '../lib/api.ts'
import { date } from '../lib/format.ts'
import { QUOTE_STATUS_LABEL } from '../lib/labels.ts'
import { href, navigate, useRoute } from '../lib/router.ts'
import type { Client, Quote, QuoteStatus, QuoteSummary } from '../lib/types.ts'
import { useAction, useApi } from '../lib/use-api.ts'

export function QuotesView() {
  const { query } = useRoute()
  const clientFilter = query.get('client') ?? ''
  const [status, setStatus] = useState<QuoteStatus | ''>('')
  const { data, error, loading, reload } = useApi(() => api.get<QuoteSummary[]>(`/quotes${qs({ status, clientId: clientFilter })}`), [status, clientFilter])
  const [creating, setCreating] = useState(false)
  useEffect(() => {
    if (clientFilter) setCreating(false)
  }, [clientFilter])

  return (
    <>
      <PageHeader
        title="Devis"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            Nouveau devis
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filtrer par statut">
        {(['', 'DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED'] as const).map((s) => (
          <Button key={s || 'all'} size="sm" variant={status === s ? 'primary' : 'ghost'} aria-pressed={status === s} onClick={() => setStatus(s)}>
            {s ? QUOTE_STATUS_LABEL[s] : 'Tous'}
          </Button>
        ))}
      </div>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && data.length === 0 && (
        <Card>
          <EmptyState icon={<FileText />} title="Aucun devis" action={<Button variant="primary" onClick={() => setCreating(true)}>Créer un devis</Button>}>
            Un devis se crée aussi depuis une opportunité du pipeline (bouton « Créer le devis »).
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
                <th>Date</th>
                <th>Validité</th>
                <th className="ds-num">Total HT</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {data.map((q) => (
                <tr key={q.id} className="cursor-pointer" onClick={() => navigate(`/devis/${q.id}`)}>
                  <td>
                    <a href={href(`/devis/${q.id}`)} className="font-medium hover:underline">
                      {q.number}
                    </a>
                  </td>
                  <td>
                    <span className="flex items-center gap-2">
                      {q.clientName} {q.channel === 'MALT' && <ChannelBadge channel="MALT" />}
                    </span>
                  </td>
                  <td className="max-w-xs truncate">{q.title}</td>
                  <td className="text-muted">{date(q.issueDate)}</td>
                  <td className="text-muted">{date(q.validUntil)}</td>
                  <td className="ds-num">
                    <Money cents={q.totalHtCents} />
                  </td>
                  <td>
                    <QuoteBadge status={q.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <NewDocumentDialog open={creating} onClose={() => setCreating(false)} kind="quote" defaultClientId={clientFilter} />
    </>
  )
}

/** Création rapide d'un devis ou d'une facture brouillon : client + intitulé, puis l'éditeur. */
export function NewDocumentDialog({ open, onClose, kind, defaultClientId = '' }: { open: boolean; onClose: () => void; kind: 'quote' | 'invoice'; defaultClientId?: string }) {
  const clients = useApi(() => api.get<Client[]>('/clients'), [open])
  const { run, busy } = useAction()
  const [clientId, setClientId] = useState(defaultClientId)
  const [title, setTitle] = useState('')
  useEffect(() => {
    if (open) {
      setClientId(defaultClientId)
      setTitle('')
    }
  }, [open, defaultClientId])
  const create = async () => {
    const path = kind === 'quote' ? '/quotes' : '/invoices'
    const created = await run('create', () => api.post<Quote | { id: number }>(path, { clientId: Number(clientId), title }), kind === 'quote' ? 'Devis créé' : 'Brouillon de facture créé')
    if (created) {
      onClose()
      navigate(`/${kind === 'quote' ? 'devis' : 'factures'}/${created.id}`)
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={kind === 'quote' ? 'Nouveau devis' : 'Nouvelle facture'}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" busy={busy === 'create'} disabled={!clientId || !title.trim()} onClick={() => void create()}>
            Créer et ouvrir
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Client">
          <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">— Choisir —</option>
            {(clients.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.channel === 'MALT' ? '· Malt' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Intitulé">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'quote' ? 'Refonte du site — phase 1' : 'Prestations d’octobre'} />
        </Field>
      </div>
    </Modal>
  )
}
