// Carte « Facture électronique » d'une facture directe émise : dépôt sur SUPER PDP, cycle de vie, actions.
import { AlertTriangle, RefreshCw, Send, Share2 } from 'lucide-react'
import { api } from '../lib/api.ts'
import { dateShort } from '../lib/format.ts'
import { href } from '../lib/router.ts'
import type { Invoice } from '../lib/types.ts'
import { useAction } from '../lib/use-api.ts'
import { Button, Card, Eyebrow, ToneBadge } from './ui.tsx'

const STATE_LABEL = { SENDING: 'Dépôt en cours', SENT: 'Déposée', REJECTED: 'Rejetée / refusée', FAILED: 'Échec du dépôt', UNKNOWN: 'Dépôt à vérifier' } as const
const STATE_TONE = { SENDING: 'PLANNED', SENT: 'SENT', REJECTED: 'FAILED', FAILED: 'FAILED', UNKNOWN: 'DUE' } as const

export function EinvoiceCard({ invoice }: { invoice: Invoice }) {
  const { run, busy } = useAction()
  const { eligibility, transmission } = invoice.einvoice
  const canSend = !eligibility && (!transmission || transmission.state === 'FAILED' || transmission.state === 'UNKNOWN')
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <Share2 className="size-4 text-accent-ink" aria-hidden />
          <Eyebrow>Facture électronique</Eyebrow>
        </span>
        {transmission && <ToneBadge tone={STATE_TONE[transmission.state]}>{STATE_LABEL[transmission.state]}</ToneBadge>}
      </div>
      {eligibility && !transmission && <p className="text-sm text-muted">{eligibility}</p>}
      {!eligibility && !transmission && <p className="text-sm text-muted">Pas encore déposée sur la plateforme agréée (SUPER PDP).</p>}
      {transmission && (
        <>
          {transmission.lastStatusLabel && (
            <p className="text-sm">
              Dernier statut : <strong>{transmission.lastStatusLabel}</strong>
              {transmission.remoteId && <span className="text-xs text-muted"> · n° SUPER PDP {transmission.remoteId}</span>}
            </p>
          )}
          {transmission.error && (
            <p className="mt-1 flex items-start gap-1 text-xs" data-money="late">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 ds-ink" /> {transmission.error}
            </p>
          )}
          {transmission.events.length > 0 && (
            <ol className="mt-2 flex flex-col gap-1 border-l border-line pl-3 text-xs">
              {transmission.events.map((e) => (
                <li key={e.id}>
                  <span className="text-muted">{dateShort(e.at)}</span> {e.statusText || e.statusCode}
                  {e.reason && <span className="block text-muted">{e.reason}</span>}
                </li>
              ))}
            </ol>
          )}
          {transmission.state === 'REJECTED' && <p className="mt-2 text-xs text-muted">Une facture émise ne se redépose pas : annulez-la par un avoir et émettez-en une nouvelle, corrigée.</p>}
        </>
      )}
      <div className="mt-3 flex flex-wrap gap-1">
        {canSend && (
          <Button size="sm" variant="primary" icon={<Send className="size-3.5" />} busy={busy === 'send'} onClick={() => void run('send', () => api.post(`/invoices/${invoice.id}/einvoice`), 'Facture déposée sur SUPER PDP')}>
            {transmission ? 'Réessayer le dépôt' : 'Déposer sur SUPER PDP'}
          </Button>
        )}
        {transmission?.state === 'SENT' && (
          <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} busy={busy === 'sync'} onClick={() => void run('sync', () => api.post<{ events: number }>('/einvoicing/sync'), (r) => (r.events ? `${r.events} nouveau(x) statut(s)` : 'Aucun nouveau statut'))}>
            Actualiser les statuts
          </Button>
        )}
        <a href={href('/parametres?onglet=connexions')} className="ml-auto self-center text-xs text-accent-ink hover:underline">
          Réglages
        </a>
      </div>
    </Card>
  )
}
