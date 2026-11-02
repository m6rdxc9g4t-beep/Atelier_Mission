// Relances : à envoyer (dues ou en échec), à venir, historique. Aperçu de l'e-mail avant envoi par Brevo.
import { CalendarClock, Eye, Mail, MailCheck, Send, Settings2, WifiOff, X } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, EmptyState, ErrorBox, Field, Input, Loading, Modal, Money, Notice, PageHeader, ToneBadge } from '../components/ui.tsx'
import { api } from '../lib/api.ts'
import { dateShort } from '../lib/format.ts'
import { href, navigate } from '../lib/router.ts'
import type { ReminderItem } from '../lib/types.ts'
import { useAction, useApi } from '../lib/use-api.ts'

type Scope = 'due' | 'upcoming' | 'history'
const SCOPE_LABEL: Record<Scope, string> = { due: 'À envoyer', upcoming: 'À venir', history: 'Historique' }
const STATE_LABEL: Record<string, string> = { DUE: 'Due', PLANNED: 'Prévue', SENT: 'Envoyée', FAILED: 'Échec', CANCELLED: 'Annulée' }

interface Preview {
  to: string | null
  subject: string
  html: string
  text: string
}

export function RemindersView() {
  const [scope, setScope] = useState<Scope>('due')
  const { data, error, loading, reload } = useApi(() => api.get<{ reminders: ReminderItem[]; blocker: { code: string; message: string } | null }>(`/reminders?scope=${scope}`), [scope])
  const { run, busy } = useAction()
  const [preview, setPreview] = useState<(Preview & { id: number }) | null>(null)
  const [reschedule, setReschedule] = useState<{ id: number; dueOn: string } | null>(null)

  const openPreview = async (id: number) => {
    const p = await run(`preview${id}`, () => api.get<Preview>(`/reminders/${id}/preview`))
    if (p) setPreview({ ...p, id })
  }

  return (
    <>
      <PageHeader
        title="Relances"
        subtitle="Factures directes impayées, relancées par e-mail via Brevo. Les missions Malt sont relancées par Malt."
        actions={
          scope === 'due' && data && data.reminders.length > 0 ? (
            <Button variant="primary" icon={<Send className="size-4" />} busy={busy === 'run'} disabled={data.blocker !== null} onClick={() => void run('run', () => api.post<{ sent: number; failed: number }>('/reminders/run'), (r) => `${r.sent} relance(s) envoyée(s)${r.failed ? `, ${r.failed} en échec` : ''}`)}>
              Tout envoyer
            </Button>
          ) : undefined
        }
      />
      {data?.blocker && (
        <div className="mb-4">
          <Notice tone="warn">
            <span className="inline-flex flex-wrap items-center gap-2">
              {data.blocker.code === 'OFFLINE' ? <WifiOff className="size-4" /> : <Settings2 className="size-4" />}
              {data.blocker.message}
              {data.blocker.code !== 'OFFLINE' && (
                <a className="underline" href={href('/parametres?onglet=connexions')}>
                  Paramètres
                </a>
              )}
            </span>
          </Notice>
        </div>
      )}
      <div className="ds-tabs mb-4" role="tablist">
        {(Object.keys(SCOPE_LABEL) as Scope[]).map((s) => (
          <button key={s} type="button" role="tab" className="ds-tab" aria-selected={scope === s} onClick={() => setScope(s)}>
            {SCOPE_LABEL[s]}
          </button>
        ))}
      </div>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && data.reminders.length === 0 && (
        <Card>
          <EmptyState icon={scope === 'due' ? <MailCheck /> : <CalendarClock />} title={scope === 'due' ? 'Aucune relance à envoyer' : 'Rien ici'}>
            {scope === 'due' ? 'Les relances sont planifiées à l’émission de chaque facture directe (par défaut 3, 15 et 30 jours après l’échéance) et annulées dès le paiement.' : null}
          </EmptyState>
        </Card>
      )}
      {data && data.reminders.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="ds-table">
            <thead>
              <tr>
                <th>Relance</th>
                <th>Facture</th>
                <th>Client</th>
                <th className="ds-num">Reste</th>
                <th>{scope === 'history' ? 'Envoyée' : 'Prévue le'}</th>
                <th>État</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {data.reminders.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.levelLabel}</td>
                  <td>
                    <a className="hover:underline" href={href(`/factures/${r.invoice.id}`)}>
                      {r.invoice.number}
                    </a>
                    <span className="block text-xs text-muted">{r.daysLate} j de retard</span>
                  </td>
                  <td>
                    {r.clientName}
                    <span className="block text-xs text-muted">{r.toEmail ?? r.clientEmail ?? 'pas d’e-mail'}</span>
                  </td>
                  <td className="ds-num">
                    <Money cents={r.invoice.balanceCents} tone={r.state === 'DUE' ? 'late' : undefined} />
                  </td>
                  <td className="whitespace-nowrap text-muted">{r.sentAt ? dateShort(r.sentAt) : dateShort(r.dueOn)}</td>
                  <td>
                    <ToneBadge tone={r.state}>{STATE_LABEL[r.state]}</ToneBadge>
                    {r.error && <span className="mt-1 block max-w-xs text-xs text-muted">{r.error}</span>}
                  </td>
                  <td>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" icon={<Eye className="size-3.5" />} busy={busy === `preview${r.id}`} onClick={() => void openPreview(r.id)}>
                        Aperçu
                      </Button>
                      {(r.state === 'DUE' || r.state === 'FAILED' || r.state === 'PLANNED') && (
                        <>
                          <Button size="sm" variant="ghost" icon={<CalendarClock className="size-3.5" />} onClick={() => setReschedule({ id: r.id, dueOn: r.dueOn })} aria-label="Reporter" />
                          <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} busy={busy === `cancel${r.id}`} aria-label="Annuler la relance" onClick={() => void run(`cancel${r.id}`, () => api.post(`/reminders/${r.id}/cancel`), 'Relance annulée')} />
                        </>
                      )}
                      {(r.state === 'DUE' || r.state === 'FAILED') && (
                        <Button size="sm" variant="primary" icon={<Mail className="size-3.5" />} busy={busy === `send${r.id}`} disabled={data.blocker !== null} onClick={() => void run(`send${r.id}`, () => api.post(`/reminders/${r.id}/send`), 'Relance envoyée par Brevo')}>
                          Envoyer
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={preview?.subject ?? ''}
        wide
        footer={
          preview && (
            <>
              <Button onClick={() => navigate('/parametres?onglet=relances')}>Régler les relances</Button>
              <Button onClick={() => setPreview(null)}>Fermer</Button>
              <Button variant="primary" icon={<Mail className="size-4" />} disabled={data?.blocker !== null} busy={busy === `send${preview.id}`} onClick={async () => {
                const ok = await run(`send${preview.id}`, () => api.post(`/reminders/${preview.id}/send`), 'Relance envoyée par Brevo')
                if (ok) setPreview(null)
              }}>
                Envoyer maintenant
              </Button>
            </>
          )
        }
      >
        {preview && (
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-muted">
              À : <strong className="text-fg">{preview.to ?? 'adresse manquante'}</strong>
            </p>
            <iframe title="Aperçu de l’e-mail" sandbox="" srcDoc={preview.html} className="h-96 w-full rounded-md border border-line bg-surface" />
          </div>
        )}
      </Modal>

      <Modal
        open={reschedule !== null}
        onClose={() => setReschedule(null)}
        title="Reporter la relance"
        footer={
          reschedule && (
            <>
              <Button onClick={() => setReschedule(null)}>Annuler</Button>
              <Button variant="primary" busy={busy === 'reschedule'} onClick={async () => {
                const ok = await run('reschedule', () => api.post(`/reminders/${reschedule.id}/reschedule`, { dueOn: reschedule.dueOn }), 'Relance reportée')
                if (ok) setReschedule(null)
              }}>
                Reporter
              </Button>
            </>
          )
        }
      >
        {reschedule && (
          <Field label="Nouvelle date">
            <Input type="date" value={reschedule.dueOn} onChange={(e) => setReschedule({ ...reschedule, dueOn: e.target.value })} />
          </Field>
        )}
      </Modal>
    </>
  )
}
