// Clients : liste avec encours, fiche détaillée (coordonnées de facturation, opportunités, devis, factures, activité).
import { Building2, FileText, Mail, Pencil, Phone, Plus, Receipt, Search, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Card, ChannelBadge, EmptyState, ErrorBox, Eyebrow, Field, Input, InvoiceBadge, Loading, Modal, Money, PageHeader, QuoteBadge, Select, StageBadge, TextArea } from '../components/ui.tsx'
import { api, qs } from '../lib/api.ts'
import { date, dateShort } from '../lib/format.ts'
import { href, navigate } from '../lib/router.ts'
import type { Channel, Client, ClientDetail } from '../lib/types.ts'
import { useAction, useApi } from '../lib/use-api.ts'

const EMPTY = { name: '', channel: 'MALT' as Channel, contactName: '', email: '', phone: '', address: '', siren: '', vatNumber: '', maltFee: '', paymentTermsDays: '', notes: '' }

export function ClientForm({ open, onClose, client }: { open: boolean; onClose: (created?: Client) => void; client?: Client | null }) {
  const { run, busy } = useAction()
  const [form, setForm] = useState(EMPTY)
  useEffect(() => {
    if (!open) return
    setForm(
      client
        ? {
            name: client.name,
            channel: client.channel,
            contactName: client.contactName ?? '',
            email: client.email ?? '',
            phone: client.phone ?? '',
            address: client.address ?? '',
            siren: client.siren ?? '',
            vatNumber: client.vatNumber ?? '',
            maltFee: client.maltFeeBps === null ? '' : String(client.maltFeeBps / 100).replace('.', ','),
            paymentTermsDays: client.paymentTermsDays === null ? '' : String(client.paymentTermsDays),
            notes: client.notes,
          }
        : EMPTY,
    )
  }, [open, client])
  const set = (key: keyof typeof EMPTY, value: string) => setForm((f) => ({ ...f, [key]: value }))
  const save = async () => {
    const fee = form.maltFee.trim() === '' ? null : Math.round(Number(form.maltFee.replace(',', '.')) * 100)
    const body = {
      name: form.name,
      channel: form.channel,
      contactName: form.contactName || null,
      email: form.email || null,
      phone: form.phone || null,
      address: form.address || null,
      siren: form.siren || null,
      vatNumber: form.vatNumber || null,
      maltFeeBps: Number.isFinite(fee) ? fee : null,
      paymentTermsDays: form.paymentTermsDays === '' ? null : Number(form.paymentTermsDays),
      notes: form.notes,
    }
    const saved = client
      ? await run('save', () => api.patch<Client>(`/clients/${client.id}`, body), 'Client enregistré')
      : await run('save', () => api.post<Client>('/clients', body), 'Client créé')
    if (saved) onClose(saved)
  }
  return (
    <Modal
      open={open}
      onClose={() => onClose()}
      title={client ? client.name : 'Nouveau client'}
      wide
      footer={
        <>
          <Button onClick={() => onClose()}>Annuler</Button>
          <Button variant="primary" onClick={() => void save()} busy={busy === 'save'} disabled={!form.name.trim()}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Nom ou raison sociale">
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} required />
        </Field>
        <Field label="Canal" hint={form.channel === 'MALT' ? 'Malt émet la facture et encaisse : pas de numéro propre ni de relance' : 'Vous facturez et relancez vous-même'}>
          <Select value={form.channel} onChange={(e) => set('channel', e.target.value)}>
            <option value="MALT">Malt</option>
            <option value="DIRECT">Direct</option>
          </Select>
        </Field>
        <Field label="Contact">
          <Input value={form.contactName} onChange={(e) => set('contactName', e.target.value)} placeholder="Prénom Nom" />
        </Field>
        <Field label="E-mail de facturation" hint="Destinataire des relances">
          <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Téléphone">
          <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="SIREN" hint="Mention de la facture électronique (émission obligatoire en sept. 2027 pour les micro-entreprises)">
          <Input value={form.siren} onChange={(e) => set('siren', e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Adresse de facturation" className="md:col-span-2" hint="Obligatoire pour émettre une facture directe">
          <TextArea rows={2} value={form.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label="N° de TVA intracommunautaire">
          <Input value={form.vatNumber} onChange={(e) => set('vatNumber', e.target.value)} />
        </Field>
        {form.channel === 'MALT' ? (
          <Field label="Frais Malt pour ce client (% HT)" hint="Vide : taux par défaut des Paramètres. Souvent 10 %, puis 5 % après 6 mois avec le même client.">
            <Input inputMode="decimal" value={form.maltFee} onChange={(e) => set('maltFee', e.target.value)} placeholder="10" />
          </Field>
        ) : (
          <Field label="Délai de paiement (jours)" hint="Vide : délai par défaut des Paramètres">
            <Input inputMode="numeric" value={form.paymentTermsDays} onChange={(e) => set('paymentTermsDays', e.target.value.replace(/\D/g, ''))} />
          </Field>
        )}
        <Field label="Notes" className="md:col-span-2">
          <TextArea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

function ClientDetailView({ clientId }: { clientId: number }) {
  const { data, error, loading, reload } = useApi(() => api.get<ClientDetail>(`/clients/${clientId}`), [clientId])
  const [editing, setEditing] = useState(false)
  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (loading && !data) return <Loading />
  if (!data) return null
  return (
    <>
      <PageHeader
        parent={{ to: '/clients', label: 'Clients' }}
        title={data.name}
        subtitle={<span className="inline-flex items-center gap-2"><ChannelBadge channel={data.channel} /> {data.contactName}</span>}
        actions={
          <>
            <Button icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
              Modifier
            </Button>
            <Button icon={<FileText className="size-4" />} onClick={() => navigate(`/devis?client=${data.id}`)}>
              Devis
            </Button>
            <Button variant="primary" icon={<Receipt className="size-4" />} onClick={() => navigate(`/factures?nouvelle=${data.id}`)}>
              Facture
            </Button>
          </>
        }
      />
      <div className="grid gap-3 lg:grid-cols-[1fr_2fr]">
        <Card className="flex flex-col gap-2.5 p-4 text-sm">
          <Eyebrow>Coordonnées</Eyebrow>
          {data.email && (
            <a className="flex items-center gap-2 hover:underline" href={`mailto:${data.email}`}>
              <Mail className="size-4 text-muted" /> {data.email}
            </a>
          )}
          {data.phone && (
            <span className="flex items-center gap-2">
              <Phone className="size-4 text-muted" /> {data.phone}
            </span>
          )}
          {data.address && (
            <span className="flex items-start gap-2 whitespace-pre-line">
              <Building2 className="mt-0.5 size-4 text-muted" /> {data.address}
            </span>
          )}
          {data.siren && <span className="text-muted">SIREN {data.siren}</span>}
          {data.notes && <p className="whitespace-pre-line rounded-md border border-line bg-sidebar px-3 py-2">{data.notes}</p>}
          <Eyebrow className="mt-3 border-t border-line pt-3">Activité</Eyebrow>
          <ol className="flex flex-col gap-2">
            {data.activities.map((a) => (
              <li key={a.id} className="flex gap-2 text-xs">
                <span className="w-16 shrink-0 text-muted">{dateShort(a.at)}</span>
                <span>{a.message}</span>
              </li>
            ))}
          </ol>
        </Card>
        <div className="flex flex-col gap-3">
          <Card className="p-4">
            <Eyebrow className="mb-3">Opportunités</Eyebrow>
            {data.opportunities.length === 0 && <p className="text-sm text-muted">Aucune.</p>}
            <ul className="divide-y divide-line">
              {data.opportunities.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <a href={href('/pipeline')} className="font-medium hover:underline">
                    {o.title}
                  </a>
                  <span className="flex items-center gap-3">
                    <Money cents={o.amountCents} /> <StageBadge stage={o.stage} />
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-4">
            <Eyebrow className="mb-3">Devis</Eyebrow>
            {data.quotes.length === 0 && <p className="text-sm text-muted">Aucun.</p>}
            <ul className="divide-y divide-line">
              {data.quotes.map((q) => (
                <li key={q.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <a href={href(`/devis/${q.id}`)} className="hover:underline">
                    <span className="font-medium">{q.number}</span> · {q.title}
                  </a>
                  <span className="flex items-center gap-3">
                    <Money cents={q.totalHtCents} /> <QuoteBadge status={q.status} />
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-4">
            <Eyebrow className="mb-3">Factures</Eyebrow>
            {data.invoices.length === 0 && <p className="text-sm text-muted">Aucune.</p>}
            <ul className="divide-y divide-line">
              {data.invoices.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <a href={href(`/factures/${i.id}`)} className="hover:underline">
                    <span className="font-medium">{i.number ?? (i.channel === 'MALT' ? `Malt ${i.externalRef ?? ''}` : 'Brouillon')}</span> · {i.title}
                    <span className="block text-xs text-muted">{i.issueDate ? `Émise le ${date(i.issueDate)}` : 'Non émise'}</span>
                  </a>
                  <span className="flex items-center gap-3">
                    <Money cents={i.totalTtcCents} /> <InvoiceBadge status={i.status} />
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
      <ClientForm open={editing} client={data} onClose={() => setEditing(false)} />
    </>
  )
}

export function ClientsView({ clientId }: { clientId?: number }) {
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const { data, error, loading, reload } = useApi(() => api.get<Client[]>(`/clients${qs({ q })}`), [q])
  if (clientId) return <ClientDetailView clientId={clientId} />
  return (
    <>
      <PageHeader
        title="Clients"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            Nouveau client
          </Button>
        }
      />
      <div className="relative mb-3 max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" aria-hidden />
        <Input className="!pl-8" placeholder="Rechercher un client…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />
      </div>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && data.length === 0 && (
        <Card>
          <EmptyState icon={<Users />} title={q ? 'Aucun client trouvé' : 'Aucun client'} action={!q && <Button variant="primary" onClick={() => setCreating(true)}>Ajouter un client</Button>} />
        </Card>
      )}
      {data && data.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="ds-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Canal</th>
                <th>Contact</th>
                <th className="ds-num">Opportunités</th>
                <th className="ds-num">Facturé TTC</th>
                <th className="ds-num">À encaisser</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="cursor-pointer" onClick={() => navigate(`/clients/${c.id}`)}>
                  <td>
                    <a href={href(`/clients/${c.id}`)} className="font-medium hover:underline">
                      {c.name}
                    </a>
                  </td>
                  <td>
                    <ChannelBadge channel={c.channel} />
                  </td>
                  <td className="text-muted">{c.contactName ?? c.email ?? '—'}</td>
                  <td className="ds-num">{c.openOpportunities ?? 0}</td>
                  <td className="ds-num">
                    <Money cents={c.billedTtcCents ?? 0} />
                  </td>
                  <td className="ds-num">
                    <Money cents={c.outstandingCents ?? 0} tone={c.overdueCount ? 'late' : undefined} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <ClientForm open={creating} onClose={(created) => { setCreating(false); if (created) navigate(`/clients/${created.id}`) }} />
    </>
  )
}
