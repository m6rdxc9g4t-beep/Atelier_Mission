// Éditeur de devis : lignes (brouillon), puis Envoyé → Accepté / Refusé, et « Transformer en facture ».
import { Check, Copy, Printer, Receipt, Save, Send, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { fromDrafts, LinesEditor, previewTotals, toDraft, TotalsBox, emptyLine, type DraftLine } from '../components/LinesEditor.tsx'
import { Button, Card, ChannelBadge, ErrorBox, Eyebrow, Field, Input, Loading, Notice, PageHeader, QuoteBadge, TextArea } from '../components/ui.tsx'
import { api } from '../lib/api.ts'
import { date } from '../lib/format.ts'
import { href, navigate } from '../lib/router.ts'
import type { Invoice, Quote } from '../lib/types.ts'
import { useAction, useApi } from '../lib/use-api.ts'
import { useSettings } from '../lib/use-settings.ts'
import { useUi } from '../store/ui.ts'

export function QuoteView({ id }: { id: number }) {
  const { data, error, loading, reload } = useApi(() => api.get<Quote>(`/quotes/${id}`), [id])
  const { franchise, defaultVat, settings } = useSettings()
  const { run, busy } = useAction()
  const notify = useUi((s) => s.notify)
  const [lines, setLines] = useState<DraftLine[]>([])
  const [meta, setMeta] = useState({ title: '', validUntil: '', notes: '' })
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!data) return
    setLines(data.lines.length ? data.lines.map(toDraft) : [emptyLine(defaultVat, 'DAY', settings ? String(settings.billing.defaultDailyRateCents / 100) : '')])
    setMeta({ title: data.title, validUntil: data.validUntil, notes: data.notes })
    setDirty(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (loading && !data) return <Loading />
  if (!data) return null
  const draft = data.status === 'DRAFT'
  const totals = previewTotals(lines)

  const save = async () => {
    const parsed = fromDrafts(lines)
    if ('error' in parsed) return notify(parsed.error, 'error')
    const saved = await run('save', () => api.patch<Quote>(`/quotes/${id}`, { ...meta, lines: parsed.lines }), 'Devis enregistré')
    if (saved) setDirty(false)
  }
  const act = async (action: string, label: string, body?: unknown) => {
    if (dirty && draft) await save()
    await run(action, () => api.post<Quote>(`/quotes/${id}/${action}`, body), label)
  }

  return (
    <>
      <PageHeader
        parent={{ to: '/devis', label: 'Devis' }}
        title={`Devis ${data.number}`}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <QuoteBadge status={data.status} /> <a className="hover:underline" href={href(`/clients/${data.clientId}`)}>{data.client.name}</a> <ChannelBadge channel={data.channel} /> · émis le {date(data.issueDate)}
          </span>
        }
        actions={
          <>
            <a className="ds-btn" href={`/api/quotes/${id}/print`} target="_blank" rel="noreferrer">
              <Printer className="size-4" /> Imprimer / PDF
            </a>
            {draft && (
              <>
                <Button variant="danger" icon={<Trash2 className="size-4" />} busy={busy === 'delete'} onClick={async () => {
                  if (!window.confirm('Supprimer ce brouillon de devis ?')) return
                  await run('delete', () => api.delete(`/quotes/${id}`), 'Devis supprimé')
                  navigate('/devis')
                }}>
                  Supprimer
                </Button>
                <Button icon={<Save className="size-4" />} busy={busy === 'save'} disabled={!dirty} onClick={() => void save()}>
                  Enregistrer
                </Button>
                <Button variant="primary" icon={<Send className="size-4" />} busy={busy === 'send'} onClick={() => void act('send', 'Devis marqué comme envoyé')}>
                  Marquer envoyé
                </Button>
              </>
            )}
            {(data.status === 'SENT' || data.status === 'EXPIRED') && (
              <>
                <Button variant="danger" icon={<X className="size-4" />} busy={busy === 'decline'} onClick={() => void act('decline', 'Devis refusé', { markOpportunityLost: window.confirm('Marquer aussi l’opportunité comme perdue ?') })}>
                  Refusé
                </Button>
                <Button icon={<Check className="size-4" />} busy={busy === 'accept'} onClick={() => void act('accept', 'Devis accepté : opportunité gagnée')}>
                  Accepté
                </Button>
              </>
            )}
            {(data.status === 'SENT' || data.status === 'ACCEPTED' || data.status === 'EXPIRED') && (
              <Button variant="primary" icon={<Receipt className="size-4" />} busy={busy === 'invoice'} onClick={async () => {
                const invoice = await run('invoice', () => api.post<Invoice>(`/quotes/${id}/invoice`), 'Facture brouillon créée depuis le devis')
                if (invoice) navigate(`/factures/${invoice.id}`)
              }}>
                Transformer en facture
              </Button>
            )}
            {!draft && (
              <Button icon={<Copy className="size-4" />} busy={busy === 'duplicate'} onClick={async () => {
                const copy = await run('duplicate', () => api.post<Quote>(`/quotes/${id}/duplicate`), (q) => `Nouvelle version : ${q.number}`)
                if (copy) navigate(`/devis/${copy.id}`)
              }}>
                Nouvelle version
              </Button>
            )}
          </>
        }
      />

      {data.channel === 'MALT' && (
        <div className="mb-4">
          <Notice>Client Malt : reportez ces lignes dans la proposition Malt. Ce devis vous sert de brouillon chiffré et de suivi.</Notice>
        </div>
      )}

      <Card className="p-4">
        <div className="mb-5 grid gap-4 md:grid-cols-[2fr_1fr]">
          <Field label="Intitulé">
            <Input value={meta.title} disabled={!draft} onChange={(e) => { setMeta({ ...meta, title: e.target.value }); setDirty(true) }} />
          </Field>
          <Field label="Valable jusqu’au">
            <Input type="date" value={meta.validUntil} disabled={!draft} onChange={(e) => { setMeta({ ...meta, validUntil: e.target.value }); setDirty(true) }} />
          </Field>
        </div>
        <Eyebrow className="mb-2">Lignes</Eyebrow>
        <LinesEditor lines={lines} readOnly={!draft} defaultVat={defaultVat} franchise={franchise} onChange={(next) => { setLines(next); setDirty(true) }} />
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <Field label="Notes et conditions (imprimées sur le devis)">
            <TextArea rows={4} value={meta.notes} disabled={!draft} onChange={(e) => { setMeta({ ...meta, notes: e.target.value }); setDirty(true) }} placeholder="Acompte de 30 % à la commande, planning prévisionnel…" />
          </Field>
          <TotalsBox ht={draft ? totals.ht : data.totalHtCents} vat={draft ? totals.vat : data.totalVatCents} ttc={draft ? totals.ttc : data.totalTtcCents} vatByRate={draft ? undefined : data.vatByRate} franchise={franchise} />
        </div>
      </Card>
    </>
  )
}
