// Facture : brouillon modifiable → émission (numéro légal, coordonnées figées) → encaissements (→ Trésorerie)
// → relances (→ Brevo). Une facture émise ne se modifie plus : on l'annule par un avoir.
import { AlertTriangle, ArrowLeft, Ban, Banknote, Clock3, FileCode2, FileDown, Landmark, Mail, Printer, RefreshCw, Save, Send, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { emptyLine, fromDrafts, LinesEditor, previewTotals, toDraft, TotalsBox, type DraftLine } from '../components/LinesEditor.tsx'
import { Button, Card, ChannelBadge, ErrorBox, Eyebrow, Field, Input, InvoiceBadge, Loading, Modal, Money, Notice, PageHeader, Select, TextArea, Toggle, ToneBadge } from '../components/ui.tsx'
import { api } from '../lib/api.ts'
import { centsToInput, date, dateShort, euros, hours, parseEuros, todayIso } from '../lib/format.ts'
import { PAYMENT_METHOD_LABEL, SYNC_LABEL, SYNC_TONE } from '../lib/labels.ts'
import { href, navigate } from '../lib/router.ts'
import type { Invoice, PaymentMethod } from '../lib/types.ts'
import { useAction, useApi } from '../lib/use-api.ts'
import { useSettings } from '../lib/use-settings.ts'
import { useUi } from '../store/ui.ts'

const REMINDER_LABEL: Record<number, string> = { 1: 'Rappel amical', 2: 'Relance', 3: 'Dernière relance' }
const REMINDER_STATE: Record<string, string> = { PLANNED: 'Prévue', SENT: 'Envoyée', FAILED: 'Échec', CANCELLED: 'Annulée' }

function PaymentDialog({ invoice, open, onClose }: { invoice: Invoice; open: boolean; onClose: () => void }) {
  const { run, busy } = useAction()
  const [amount, setAmount] = useState('')
  const [receivedOn, setReceivedOn] = useState(todayIso())
  const [method, setMethod] = useState<PaymentMethod>('TRANSFER')
  const [note, setNote] = useState('')
  useEffect(() => {
    if (!open) return
    setAmount(centsToInput(invoice.balanceCents))
    setReceivedOn(todayIso())
    setMethod(invoice.channel === 'MALT' ? 'MALT' : 'TRANSFER')
    setNote('')
  }, [open, invoice])
  const cents = parseEuros(amount)
  const save = async () => {
    if (cents === null) return
    const ok = await run('pay', () => api.post<Invoice>(`/invoices/${invoice.id}/payments`, { amountCents: cents, receivedOn, method, note }), 'Encaissement enregistré')
    if (ok) onClose()
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Enregistrer un encaissement"
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" icon={<Banknote className="size-4" />} busy={busy === 'pay'} disabled={cents === null || cents <= 0} onClick={() => void save()}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Montant reçu (€ TTC)" hint={`Reste à payer : ${euros(invoice.balanceCents)}`}>
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Reçu le">
          <Input type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
        </Field>
        <Field label="Moyen">
          <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABEL[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      {invoice.malt && (
        <div className="mt-4">
          <Notice>
            Mission Malt : le montant facturé ({euros(invoice.totalTtcCents)}) part en revenu dans Trésorerie et les frais Malt ({euros(invoice.malt.feeTtcCents)} TTC) en dépense — le net correspond au virement reçu ({euros(invoice.malt.netPayoutCents)}).
          </Notice>
        </div>
      )}
    </Modal>
  )
}

export function InvoiceView({ id }: { id: number }) {
  const { data, error, loading, reload } = useApi(() => api.get<Invoice>(`/invoices/${id}`), [id])
  const { franchise, defaultVat } = useSettings()
  const { run, busy } = useAction()
  const notify = useUi((s) => s.notify)
  const [lines, setLines] = useState<DraftLine[]>([])
  const [meta, setMeta] = useState({ title: '', paymentTermsDays: '30', notes: '', serviceStart: '', serviceEnd: '' })
  const [dirty, setDirty] = useState(false)
  const [paying, setPaying] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [issueDate, setIssueDate] = useState(todayIso())
  const [externalRef, setExternalRef] = useState('')

  useEffect(() => {
    if (!data) return
    setLines(data.lines.length ? data.lines.map(toDraft) : [emptyLine(defaultVat)])
    setMeta({ title: data.title, paymentTermsDays: String(data.paymentTermsDays), notes: data.notes, serviceStart: data.serviceStart ?? '', serviceEnd: data.serviceEnd ?? '' })
    setExternalRef(data.externalRef ?? '')
    setDirty(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (loading && !data) return <Loading />
  if (!data) return null
  const draft = data.rawStatus === 'DRAFT'
  const open = data.rawStatus === 'ISSUED' || data.rawStatus === 'PARTIALLY_PAID'
  const totals = previewTotals(lines)

  const save = async (): Promise<boolean> => {
    const parsed = fromDrafts(lines)
    if ('error' in parsed) {
      notify(parsed.error, 'error')
      return false
    }
    const saved = await run(
      'save',
      () =>
        api.patch<Invoice>(`/invoices/${id}`, {
          title: meta.title,
          paymentTermsDays: Number(meta.paymentTermsDays) || 0,
          notes: meta.notes,
          serviceStart: meta.serviceStart || null,
          serviceEnd: meta.serviceEnd || null,
          lines: parsed.lines,
        }),
      'Brouillon enregistré',
    )
    if (saved) setDirty(false)
    return Boolean(saved)
  }

  const issue = async () => {
    if (dirty && !(await save())) return
    const done = await run('issue', () => api.post<Invoice>(`/invoices/${id}/issue`, { issueDate, ...(data.channel === 'MALT' ? { externalRef: externalRef || null } : {}) }), (i) => `Facture ${i.displayNumber} émise`)
    if (done) setIssuing(false)
  }

  return (
    <>
      <a href={href('/factures')} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Factures
      </a>
      <PageHeader
        title={data.kind === 'CREDIT_NOTE' ? `Avoir ${data.displayNumber}` : data.displayNumber}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <InvoiceBadge status={data.status} />
            <a className="hover:underline" href={href(`/clients/${data.client.id}`)}>
              {data.clientName}
            </a>
            <ChannelBadge channel={data.channel} />
            {data.issueDate && <span>· émise le {date(data.issueDate)}</span>}
            {data.dueDate && data.kind === 'INVOICE' && <span>· échéance {date(data.dueDate)}</span>}
          </span>
        }
        actions={
          <>
            <a className="ds-btn" href={`/api/invoices/${id}/print`} target="_blank" rel="noreferrer">
              <Printer className="size-4" /> {draft ? 'Aperçu' : 'Imprimer'}
            </a>
            {!draft && data.channel === 'DIRECT' && (
              <>
                <a className="ds-btn" href={`/api/invoices/${id}/facturx.pdf`} download title="PDF/A-3 avec les données EN 16931 embarquées (factur-x.xml) : à envoyer au client ou à déposer sur votre plateforme agréée">
                  <FileDown className="size-4" /> Factur-X
                </a>
                <a className="ds-btn" data-variant="ghost" data-icon-only="" href={`/api/invoices/${id}/facturx.xml`} download aria-label="Télécharger le XML Factur-X seul" title="XML CII EN 16931 seul">
                  <FileCode2 className="size-4" />
                </a>
              </>
            )}
            {draft && (
              <>
                <Button variant="danger" icon={<Trash2 className="size-4" />} busy={busy === 'delete'} onClick={async () => {
                  if (!window.confirm('Supprimer ce brouillon ? Les saisies de temps liées redeviendront facturables.')) return
                  await run('delete', () => api.delete(`/invoices/${id}`), 'Brouillon supprimé')
                  navigate('/factures')
                }}>
                  Supprimer
                </Button>
                <Button icon={<Save className="size-4" />} busy={busy === 'save'} disabled={!dirty} onClick={() => void save()}>
                  Enregistrer
                </Button>
                <Button variant="primary" icon={<Send className="size-4" />} onClick={() => setIssuing(true)}>
                  Émettre
                </Button>
              </>
            )}
            {open && (
              <>
                {data.paidCents === 0 && (
                  <Button variant="danger" icon={<Ban className="size-4" />} busy={busy === 'cancel'} onClick={async () => {
                    const reason = window.prompt(data.channel === 'MALT' ? 'Annuler cette facture Malt ? (motif facultatif)' : 'Annuler par un avoir ? Motif (facultatif) :', '')
                    if (reason === null) return
                    const result = await run('cancel', () => api.post<{ creditNoteId: number | null }>(`/invoices/${id}/cancel`, { reason }), (r) => (r.creditNoteId ? 'Avoir émis, facture annulée' : 'Facture annulée'))
                    if (result?.creditNoteId) navigate(`/factures/${result.creditNoteId}`)
                  }}>
                    Annuler (avoir)
                  </Button>
                )}
                <Button variant="primary" icon={<Banknote className="size-4" />} onClick={() => setPaying(true)}>
                  Encaissement
                </Button>
              </>
            )}
          </>
        }
      />

      {data.time.flagged > 0 && (
        <div className="mb-4">
          <Notice tone="warn">
            {data.time.flagged} saisie{data.time.flagged > 1 ? 's' : ''} de temps facturée{data.time.flagged > 1 ? 's' : ''} {data.time.flagged > 1 ? 'ont' : 'a'} changé dans Atelier Projets depuis. <a className="underline" href={href('/temps?filtre=flagged')}>Vérifier</a>
          </Notice>
        </div>
      )}
      {draft && data.channel === 'MALT' && (
        <div className="mb-4">
          <Notice>Mission Malt : Malt émet la facture officielle et encaisse le client. Saisissez ici le numéro de la facture Malt à l’émission pour suivre le versement et les frais.</Notice>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <Card className="p-5">
          <div className="mb-5 grid gap-4 md:grid-cols-4">
            <Field label="Intitulé" className="md:col-span-2">
              <Input value={meta.title} disabled={!draft} onChange={(e) => { setMeta({ ...meta, title: e.target.value }); setDirty(true) }} />
            </Field>
            <Field label="Prestation du">
              <Input type="date" value={meta.serviceStart} disabled={!draft} onChange={(e) => { setMeta({ ...meta, serviceStart: e.target.value }); setDirty(true) }} />
            </Field>
            <Field label="au">
              <Input type="date" value={meta.serviceEnd} disabled={!draft} onChange={(e) => { setMeta({ ...meta, serviceEnd: e.target.value }); setDirty(true) }} />
            </Field>
          </div>
          <Eyebrow className="mb-2">Lignes</Eyebrow>
          <LinesEditor lines={lines} readOnly={!draft} defaultVat={defaultVat} franchise={franchise} onChange={(next) => { setLines(next); setDirty(true) }} />
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-4">
              {draft && (
                <Field label="Délai de paiement (jours)">
                  <Input className="max-w-32" inputMode="numeric" value={meta.paymentTermsDays} onChange={(e) => { setMeta({ ...meta, paymentTermsDays: e.target.value.replace(/\D/g, '') }); setDirty(true) }} />
                </Field>
              )}
              <Field label="Notes (imprimées)">
                <TextArea rows={3} value={meta.notes} onChange={(e) => { setMeta({ ...meta, notes: e.target.value }); setDirty(true) }} />
              </Field>
              {!draft && dirty && (
                <Button size="sm" className="self-start" icon={<Save className="size-4" />} busy={busy === 'notes'} onClick={async () => {
                  const ok = await run('notes', () => api.patch(`/invoices/${id}`, { notes: meta.notes }), 'Notes enregistrées')
                  if (ok) setDirty(false)
                }}>
                  Enregistrer les notes
                </Button>
              )}
            </div>
            <TotalsBox ht={draft ? totals.ht : data.totalHtCents} vat={draft ? totals.vat : data.totalVatCents} ttc={draft ? totals.ttc : data.totalTtcCents} vatByRate={draft ? undefined : data.vatByRate} franchise={franchise} paid={data.paidCents} />
          </div>
          {data.legalMentions.length > 0 && !draft && (
            <div className="mt-6 border-t border-line pt-3 text-xs text-muted">
              {data.legalMentions.map((m) => (
                <p key={m}>{m}</p>
              ))}
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          {data.malt && (
            <Card className="p-4 text-sm">
              <Eyebrow className="mb-2">Versement Malt</Eyebrow>
              <dl className="ms-num grid grid-cols-[1fr_auto] gap-y-1">
                <dt className="text-muted">Facturé au client</dt>
                <dd className="text-right">{euros(data.totalTtcCents)}</dd>
                <dt className="text-muted">Frais Malt {data.malt.feeBps / 100} % HT + TVA</dt>
                <dd className="text-right">− {euros(data.malt.feeTtcCents)}</dd>
                <dt className="font-semibold">Net versé</dt>
                <dd className="text-right font-semibold">{euros(data.malt.netPayoutCents)}</dd>
              </dl>
            </Card>
          )}

          {data.time.entries > 0 && (
            <Card className="flex items-center gap-3 p-4 text-sm">
              <Clock3 className="size-4 text-accent-ink" aria-hidden />
              <span>
                {data.time.entries} saisie{data.time.entries > 1 ? 's' : ''} · {hours(data.time.minutes)} depuis Atelier Projets
              </span>
            </Card>
          )}

          {!draft && data.kind === 'INVOICE' && (
            <Card className="p-4">
              <div className="mb-2 flex items-center gap-2">
                <Landmark className="size-4 text-accent-ink" aria-hidden />
                <Eyebrow>Encaissements → Trésorerie</Eyebrow>
              </div>
              {data.payments.length === 0 && <p className="text-sm text-muted">Aucun encaissement.</p>}
              <ul className="flex flex-col gap-2">
                {data.payments.map((p) => (
                  <li key={p.id} className="rounded-md border border-line p-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span>
                        <Money cents={p.amountCents} className="font-semibold" /> <span className="text-xs text-muted">{dateShort(p.receivedOn)} · {PAYMENT_METHOD_LABEL[p.method]}</span>
                      </span>
                      <ToneBadge tone={SYNC_TONE[p.tresorerieStatus]}>{SYNC_LABEL[p.tresorerieStatus]}</ToneBadge>
                    </div>
                    {p.tresorerieError && <p className="mt-1 text-xs text-muted">{p.tresorerieError}</p>}
                    <div className="mt-1 flex gap-1">
                      {(p.tresorerieStatus === 'PENDING' || p.tresorerieStatus === 'FAILED') && (
                        <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} busy={busy === `sync${p.id}`} onClick={() => void run(`sync${p.id}`, () => api.post(`/payments/${p.id}/sync`), 'Envoyé à Atelier Trésorerie')}>
                          Envoyer
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} busy={busy === `del${p.id}`} onClick={async () => {
                        if (!window.confirm('Supprimer cet encaissement ?')) return
                        const r = await run(`del${p.id}`, () => api.delete<{ warning: string | null }>(`/payments/${p.id}`), 'Encaissement supprimé')
                        if (r?.warning) notify(r.warning, 'info')
                      }}>
                        Supprimer
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {data.channel === 'DIRECT' && data.kind === 'INVOICE' && !draft && (
            <Card className="p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <Mail className="size-4 text-accent-ink" aria-hidden />
                  <Eyebrow>Relances Brevo</Eyebrow>
                </span>
                {open && (
                  <Toggle checked={data.remindersEnabled} label="Actives" onChange={(v) => void run('rem', () => api.patch(`/invoices/${id}`, { remindersEnabled: v }), v ? 'Relances réactivées' : 'Relances désactivées')} />
                )}
              </div>
              {!data.client.currentEmail && open && (
                <p className="mb-2 flex items-center gap-1 text-xs" data-money="late">
                  <AlertTriangle className="size-3.5 ds-ink" /> Pas d’e-mail client : <a className="underline" href={href(`/clients/${data.client.id}`)}>compléter la fiche</a>
                </p>
              )}
              <ol className="flex flex-col gap-1.5">
                {data.reminders.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      {REMINDER_LABEL[r.level] ?? `Niveau ${r.level}`} <span className="text-xs text-muted">· {r.sentAt ? `envoyée ${dateShort(r.sentAt)}` : dateShort(r.dueOn)}</span>
                    </span>
                    <ToneBadge tone={r.status}>{REMINDER_STATE[r.status]}</ToneBadge>
                  </li>
                ))}
              </ol>
              {data.reminders.length === 0 && <p className="text-sm text-muted">Aucune relance planifiée.</p>}
              <a href={href('/relances')} className="mt-2 inline-block text-xs text-accent-ink hover:underline">
                Gérer les relances
              </a>
            </Card>
          )}

          <Card className="p-4">
            <Eyebrow className="mb-2">Historique</Eyebrow>
            <ol className="flex flex-col gap-1.5 text-xs">
              {data.activities.map((a) => (
                <li key={a.id} className="flex gap-2">
                  <span className="w-14 shrink-0 text-muted">{dateShort(a.at)}</span>
                  <span>{a.message}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      {open && <PaymentDialog invoice={data} open={paying} onClose={() => setPaying(false)} />}
      <Modal
        open={issuing}
        onClose={() => setIssuing(false)}
        title="Émettre la facture"
        footer={
          <>
            <Button onClick={() => setIssuing(false)}>Annuler</Button>
            <Button variant="primary" icon={<Send className="size-4" />} busy={busy === 'issue' || busy === 'save'} onClick={() => void issue()}>
              Émettre
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          {data.channel === 'DIRECT' ? (
            <Notice>
              L’émission attribue le prochain numéro chronologique et fige vos coordonnées et celles du client. Ensuite, la facture ne se modifie plus : une erreur se corrige par un avoir. {data.remindersEnabled && 'Les relances sont planifiées après l’échéance.'}
            </Notice>
          ) : (
            <Field label="Numéro de la facture Malt" hint="Visible dans votre espace Malt › Factures">
              <Input value={externalRef} onChange={(e) => setExternalRef(e.target.value)} placeholder="ex. 2026-48213" />
            </Field>
          )}
          <Field label="Date d’émission">
            <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </>
  )
}
