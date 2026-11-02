// Fiche d'une opportunité (création / modification) : client existant ou nouveau, montant direct ou TJM × jours,
// prochaine action, lien Malt et projet d'Atelier Projets (dont le temps sera facturé).
import { ExternalLink, FileText, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api.ts'
import { centsToInput, euros, parseEuros, parseNumber } from '../lib/format.ts'
import { SOURCE_LABEL, STAGE_LABEL, STAGES } from '../lib/labels.ts'
import { navigate } from '../lib/router.ts'
import type { Channel, Client, Opportunity, ProjectSummary, Quote, Source, Stage } from '../lib/types.ts'
import { useAction, useApi } from '../lib/use-api.ts'
import { Button, Field, Input, Modal, Select, TextArea } from './ui.tsx'

interface Props {
  open: boolean
  onClose: () => void
  opportunity?: Opportunity | null
  defaultStage?: Stage
}

const NEW_CLIENT = 'new'

export function OpportunityForm({ open, onClose, opportunity, defaultStage = 'NEW' }: Props) {
  const clients = useApi(() => api.get<Client[]>('/clients'), [open])
  const projects = useApi(() => api.get<{ online: boolean; projects: ProjectSummary[] }>('/time/projects'), [open])
  const { run, busy } = useAction()
  const [clientId, setClientId] = useState<string>('')
  const [newClient, setNewClient] = useState({ name: '', channel: 'MALT' as Channel, email: '', contactName: '' })
  const [form, setForm] = useState({
    title: '',
    stage: defaultStage,
    source: 'MALT' as Source,
    amount: '',
    rate: '',
    days: '',
    probability: '',
    nextAction: '',
    nextActionDate: '',
    maltUrl: '',
    projetsProjectId: '',
    notes: '',
    lostReason: '',
  })

  useEffect(() => {
    if (!open) return
    if (opportunity) {
      setClientId(String(opportunity.clientId))
      setForm({
        title: opportunity.title,
        stage: opportunity.stage,
        source: opportunity.source,
        amount: centsToInput(opportunity.amountCents),
        rate: centsToInput(opportunity.dailyRateCents),
        days: opportunity.days === null ? '' : String(opportunity.days).replace('.', ','),
        probability: String(opportunity.probability),
        nextAction: opportunity.nextAction,
        nextActionDate: opportunity.nextActionDate ?? '',
        maltUrl: opportunity.maltUrl ?? '',
        projetsProjectId: opportunity.projetsProjectId ? String(opportunity.projetsProjectId) : '',
        notes: opportunity.notes,
        lostReason: opportunity.lostReason ?? '',
      })
    } else {
      setClientId('')
      setNewClient({ name: '', channel: 'MALT', email: '', contactName: '' })
      setForm((f) => ({ ...f, title: '', stage: defaultStage, amount: '', rate: '', days: '', probability: '', nextAction: '', nextActionDate: '', maltUrl: '', projetsProjectId: '', notes: '', lostReason: '' }))
    }
  }, [open, opportunity, defaultStage])

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }))
  const rate = parseEuros(form.rate)
  const days = parseNumber(form.days)
  const computed = rate && days ? Math.round(rate * days) : null
  const amountCents = parseEuros(form.amount) ?? computed ?? 0

  const save = async () => {
    let targetClient = Number(clientId)
    if (clientId === NEW_CLIENT || clientId === '') {
      if (!newClient.name.trim()) return
      const created = await run('client', () =>
        api.post<Client>('/clients', { name: newClient.name, channel: newClient.channel, email: newClient.email || null, contactName: newClient.contactName || null }),
      )
      if (!created) return
      targetClient = created.id
    }
    const body = {
      clientId: targetClient,
      title: form.title,
      source: form.source,
      amountCents,
      dailyRateCents: rate,
      days,
      ...(form.probability ? { probability: Math.max(0, Math.min(100, Number(form.probability))) } : {}),
      nextAction: form.nextAction,
      nextActionDate: form.nextActionDate || null,
      maltUrl: form.maltUrl || null,
      projetsProjectId: form.projetsProjectId ? Number(form.projetsProjectId) : null,
      notes: form.notes,
    }
    const saved = opportunity
      ? await run('save', async () => {
          const updated = await api.patch<Opportunity>(`/opportunities/${opportunity.id}`, { ...body, lostReason: form.lostReason || null })
          return form.stage !== opportunity.stage ? api.post<Opportunity>(`/opportunities/${opportunity.id}/move`, { stage: form.stage }) : updated
        }, 'Opportunité enregistrée')
      : await run('save', () => api.post<Opportunity>('/opportunities', { ...body, stage: form.stage }), 'Opportunité créée')
    if (saved) onClose()
  }

  const createQuote = async () => {
    if (!opportunity) return
    const quote = await run(
      'quote',
      () =>
        api.post<Quote>('/quotes', {
          clientId: opportunity.clientId,
          opportunityId: opportunity.id,
          title: opportunity.title,
          channel: opportunity.clientChannel,
          lines:
            opportunity.dailyRateCents && opportunity.days
              ? [{ label: opportunity.title, unit: 'DAY', quantity: opportunity.days, unitPriceCents: opportunity.dailyRateCents, vatRateBps: 0 }]
              : opportunity.amountCents
                ? [{ label: opportunity.title, unit: 'FLAT', quantity: 1, unitPriceCents: opportunity.amountCents, vatRateBps: 0 }]
                : [],
        }),
      (q) => `Devis ${q.number} créé`,
    )
    if (quote) {
      onClose()
      navigate(`/devis/${quote.id}`)
    }
  }

  const remove = async () => {
    if (!opportunity || !window.confirm(`Supprimer « ${opportunity.title} » ?`)) return
    await run('delete', () => api.delete(`/opportunities/${opportunity.id}`), 'Opportunité supprimée')
    onClose()
  }

  const canSave = form.title.trim() !== '' && (clientId !== '' && clientId !== NEW_CLIENT ? true : newClient.name.trim() !== '')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={opportunity ? opportunity.title : 'Nouveau prospect'}
      wide
      footer={
        <>
          {opportunity && (
            <>
              <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()} busy={busy === 'delete'} className="mr-auto">
                Supprimer
              </Button>
              <Button icon={<FileText className="size-4" />} onClick={() => void createQuote()} busy={busy === 'quote'}>
                Créer le devis
              </Button>
            </>
          )}
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" onClick={() => void save()} busy={busy === 'save' || busy === 'client'} disabled={!canSave}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Client">
          <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">— Choisir —</option>
            <option value={NEW_CLIENT}>+ Nouveau client…</option>
            {(clients.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.channel === 'MALT' ? '· Malt' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Intitulé de la mission">
          <Input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Refonte du portail…" required />
        </Field>

        {(clientId === NEW_CLIENT || clientId === '') && (
          <div className="grid gap-3 rounded-md border border-dashed border-line-soft p-3 md:col-span-2 md:grid-cols-4">
            <Field label="Nom du client" className="md:col-span-2">
              <Input value={newClient.name} onChange={(e) => setNewClient({ ...newClient, name: e.target.value })} placeholder="Entreprise" />
            </Field>
            <Field label="Canal">
              <Select value={newClient.channel} onChange={(e) => setNewClient({ ...newClient, channel: e.target.value as Channel })}>
                <option value="MALT">Malt</option>
                <option value="DIRECT">Direct</option>
              </Select>
            </Field>
            <Field label="Contact">
              <Input value={newClient.contactName} onChange={(e) => setNewClient({ ...newClient, contactName: e.target.value })} placeholder="Prénom Nom" />
            </Field>
          </div>
        )}

        <Field label="Étape">
          <Select value={form.stage} onChange={(e) => set('stage', e.target.value as Stage)}>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Source">
          <Select value={form.source} onChange={(e) => set('source', e.target.value as Source)}>
            {(Object.keys(SOURCE_LABEL) as Source[]).map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-3 gap-3 md:col-span-2">
          <Field label="TJM (€ HT)">
            <Input inputMode="decimal" value={form.rate} onChange={(e) => set('rate', e.target.value)} placeholder="550" />
          </Field>
          <Field label="Jours estimés">
            <Input inputMode="decimal" value={form.days} onChange={(e) => set('days', e.target.value)} placeholder="20" />
          </Field>
          <Field label="Montant estimé (€ HT)" hint={computed && !form.amount ? `TJM × jours = ${euros(computed)}` : undefined}>
            <Input inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder={computed ? centsToInput(computed) : '0'} />
          </Field>
        </div>

        <Field label="Probabilité (%)" hint="Vide : celle de l’étape (10 → 70 %)">
          <Input inputMode="numeric" value={form.probability} onChange={(e) => set('probability', e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label="Projet Atelier Projets" hint={projects.data && !projects.data.online ? 'Atelier Projets injoignable : projets déjà importés seulement' : 'Son temps passé deviendra une facture'}>
          <Select value={form.projetsProjectId} onChange={(e) => set('projetsProjectId', e.target.value)}>
            <option value="">— Aucun —</option>
            {(projects.data?.projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Prochaine action">
          <Input value={form.nextAction} onChange={(e) => set('nextAction', e.target.value)} placeholder="Appel de cadrage, relance…" />
        </Field>
        <Field label="Le">
          <Input type="date" value={form.nextActionDate} onChange={(e) => set('nextActionDate', e.target.value)} />
        </Field>

        <Field label="Lien de la mission Malt" className="md:col-span-2">
          <div className="flex gap-2">
            <Input type="url" value={form.maltUrl} onChange={(e) => set('maltUrl', e.target.value)} placeholder="https://www.malt.fr/…" />
            {form.maltUrl.startsWith('https://') && (
              <a className="ds-btn" data-icon-only="" href={form.maltUrl} target="_blank" rel="noreferrer" aria-label="Ouvrir sur Malt">
                <ExternalLink className="size-4" />
              </a>
            )}
          </div>
        </Field>
        {form.stage === 'LOST' && (
          <Field label="Motif de la perte" className="md:col-span-2">
            <Input value={form.lostReason} onChange={(e) => set('lostReason', e.target.value)} placeholder="Budget, délai, concurrent…" />
          </Field>
        )}
        <Field label="Notes" className="md:col-span-2">
          <TextArea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
