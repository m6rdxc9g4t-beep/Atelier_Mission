// Paramètres : identité (mentions légales), facturation, Malt, relances, connexions (Projets, Trésorerie, Brevo).
import { CheckCircle2, CircleSlash, Kanban, Mail, RefreshCw, Save, Wallet } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Button, Card, ErrorBox, Eyebrow, Field, Input, Loading, Notice, PageHeader, Select, TextArea, Toggle } from '../components/ui.tsx'
import { api } from '../lib/api.ts'
import { centsToInput, parseEuros, parseNumber } from '../lib/format.ts'
import { navigate, useRoute } from '../lib/router.ts'
import type { Settings } from '../lib/types.ts'
import { useAction, useApi } from '../lib/use-api.ts'

type Tab = 'entreprise' | 'facturation' | 'relances' | 'connexions'
const TABS: Record<Tab, string> = { entreprise: 'Entreprise', facturation: 'Facturation & Malt', relances: 'Relances', connexions: 'Connexions' }

interface Status {
  projets: { url: string; online: boolean }
  tresorerie: { url: string; online: boolean; configured: boolean }
  brevo: { keyConfigured: boolean; senderConfigured: boolean; onlineMode: boolean }
}

function StatusLine({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <p className={`flex items-center gap-2 text-sm ${ok ? 'text-muted' : 'font-medium text-down'}`}>
      {ok ? <CheckCircle2 className="size-4 text-faint" aria-hidden /> : <CircleSlash className="size-4" aria-hidden />}
      <span>{children}</span>
    </p>
  )
}

function Connections({ settings, update }: { settings: Settings; update: (patch: object, label: string) => Promise<void> }) {
  const status = useApi(() => api.get<Status>('/integrations/status'))
  const options = useApi(() => api.get<{ accounts: { id: number; name: string }[]; categories: { id: number; name: string; kind: string }[] }>('/integrations/tresorerie/options').catch(() => null), [status.data?.tresorerie.online])
  const { run, busy } = useAction()
  const [urls, setUrls] = useState({ projetsUrl: settings.integrations.projetsUrl, tresorerieUrl: settings.integrations.tresorerieUrl })
  const [sender, setSender] = useState({ brevoSenderEmail: settings.integrations.brevoSenderEmail, brevoSenderName: settings.integrations.brevoSenderName })
  const s = status.data
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <span className="atelier-brand__tile atelier-brand__tile--sm" data-atelier-app="projets" aria-hidden>
            <Kanban />
          </span>
          <Eyebrow>Atelier Projets</Eyebrow>
        </div>
        <p className="text-sm text-muted">Le temps saisi dans Projets devient une facture (écran Temps).</p>
        {s && <StatusLine ok={s.projets.online}>{s.projets.online ? 'En marche' : 'Injoignable — lancez Atelier Projets'}</StatusLine>}
        <Field label="Adresse de l’API" hint="Locale uniquement (127.0.0.1, localhost)">
          <Input value={urls.projetsUrl} onChange={(e) => setUrls({ ...urls, projetsUrl: e.target.value })} />
        </Field>
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <span className="atelier-brand__tile atelier-brand__tile--sm" data-atelier-app="tresorerie" aria-hidden>
            <Wallet />
          </span>
          <Eyebrow>Atelier Trésorerie</Eyebrow>
        </div>
        <p className="text-sm text-muted">Chaque encaissement crée une opération (revenu ; frais Malt en dépense) sur le compte choisi.</p>
        {s && <StatusLine ok={s.tresorerie.online}>{s.tresorerie.online ? 'En marche' : 'Injoignable — lancez Atelier Trésorerie'}</StatusLine>}
        <Field label="Adresse" hint="Locale uniquement">
          <Input value={urls.tresorerieUrl} onChange={(e) => setUrls({ ...urls, tresorerieUrl: e.target.value })} />
        </Field>
        {options.data ? (
          <>
            <Field label="Compte bancaire">
              <Select value={settings.integrations.tresorerieAccountId ?? ''} onChange={(e) => void update({ integrations: { tresorerieAccountId: e.target.value ? Number(e.target.value) : null } }, 'Compte enregistré')}>
                <option value="">— Choisir —</option>
                {options.data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Catégorie des encaissements">
              <Select value={settings.integrations.tresorerieRevenueCategoryId ?? ''} onChange={(e) => void update({ integrations: { tresorerieRevenueCategoryId: e.target.value ? Number(e.target.value) : null } }, 'Catégorie enregistrée')}>
                <option value="">Devinée par Trésorerie</option>
                {options.data.categories.filter((c) => c.kind === 'revenu').map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Catégorie des frais Malt">
              <Select value={settings.integrations.tresorerieFeeCategoryId ?? ''} onChange={(e) => void update({ integrations: { tresorerieFeeCategoryId: e.target.value ? Number(e.target.value) : null } }, 'Catégorie enregistrée')}>
                <option value="">Devinée par Trésorerie</option>
                {options.data.categories.filter((c) => c.kind === 'depense').map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        ) : (
          <p className="text-xs text-muted">Lancez Trésorerie pour choisir le compte et les catégories.</p>
        )}
        <Toggle checked={settings.integrations.tresorerieAutoSync} label="Envoyer chaque encaissement automatiquement" onChange={(v) => void update({ integrations: { tresorerieAutoSync: v } }, 'Réglage enregistré')} />
        <Button size="sm" icon={<RefreshCw className="size-4" />} busy={busy === 'sync'} onClick={() => void run('sync', () => api.post<{ synced: number; failed: number; total: number }>('/integrations/tresorerie/sync-pending'), (r) => `${r.synced} / ${r.total} encaissement(s) envoyé(s)`)}>
          Envoyer les encaissements en attente
        </Button>
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <span className="grid size-5 place-items-center text-faint" aria-hidden>
            <Mail className="size-4" />
          </span>
          <Eyebrow>Brevo (relances)</Eyebrow>
        </div>
        <p className="text-sm text-muted">Seul service extérieur : n’envoie qu’en mode « En ligne ».</p>
        {s && (
          <>
            <StatusLine ok={s.brevo.keyConfigured}>{s.brevo.keyConfigured ? 'Clé API configurée' : 'Clé absente : BREVO_API_KEY dans backend/.env'}</StatusLine>
            <StatusLine ok={s.brevo.onlineMode}>{s.brevo.onlineMode ? 'Mode en ligne' : 'Hors ligne : aucun envoi'}</StatusLine>
          </>
        )}
        <Field label="Adresse d’expédition" hint="Doit être un expéditeur vérifié dans Brevo">
          <Input type="email" value={sender.brevoSenderEmail} onChange={(e) => setSender({ ...sender, brevoSenderEmail: e.target.value })} />
        </Field>
        <Field label="Nom affiché">
          <Input value={sender.brevoSenderName} onChange={(e) => setSender({ ...sender, brevoSenderName: e.target.value })} />
        </Field>
        <Button size="sm" busy={busy === 'brevo'} disabled={!s?.brevo.onlineMode || !s.brevo.keyConfigured} onClick={() => void run('brevo', () => api.get<{ email: string }>('/integrations/brevo/account'), (a) => `Connexion Brevo OK (${a.email})`)}>
          Tester la connexion
        </Button>
      </Card>

      <div className="lg:col-span-3">
        <Button variant="primary" icon={<Save className="size-4" />} onClick={() => void update({ integrations: { ...urls, ...sender } }, 'Connexions enregistrées').then(() => status.reload())}>
          Enregistrer les adresses et l’expéditeur
        </Button>
      </div>
    </div>
  )
}

export function SettingsView() {
  const { query } = useRoute()
  const tab = (query.get('onglet') as Tab) in TABS ? (query.get('onglet') as Tab) : 'entreprise'
  const { data, error, loading, reload, setData } = useApi(() => api.get<Settings>('/settings'))
  const { run, busy } = useAction()
  const [company, setCompany] = useState<Settings['company'] | null>(null)
  const [billing, setBilling] = useState({ rate: '', hoursPerDay: '', paymentTermsDays: '', quoteValidityDays: '', defaultVat: '0', penalty: '', footer: '', maltFee: '', offsets: '', invoicePrefix: '', quotePrefix: '' })

  useEffect(() => {
    if (!data) return
    setCompany(data.company)
    setBilling({
      rate: centsToInput(data.billing.defaultDailyRateCents),
      hoursPerDay: String(data.billing.hoursPerDay).replace('.', ','),
      paymentTermsDays: String(data.billing.paymentTermsDays),
      quoteValidityDays: String(data.billing.quoteValidityDays),
      defaultVat: String(data.billing.defaultVatRateBps),
      penalty: data.billing.latePenaltyRateText,
      footer: data.billing.footer,
      maltFee: String(data.malt.feeBps / 100).replace('.', ','),
      offsets: data.reminders.offsetsDays.join(', '),
      invoicePrefix: data.billing.invoicePrefix,
      quotePrefix: data.billing.quotePrefix,
    })
  }, [data])

  const update = async (patch: object, label: string) => {
    const next = await run('save', () => api.patch<Settings>('/settings', patch), label)
    if (next) setData(next)
  }

  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (loading && !data) return <Loading />
  if (!data || !company) return null
  const set = (key: keyof Settings['company'], value: string) => setCompany({ ...company, [key]: value })

  return (
    <>
      <PageHeader title="Paramètres" />
      <div className="ds-tabs mb-4" role="tablist">
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <button key={t} type="button" role="tab" className="ds-tab" aria-selected={tab === t} onClick={() => navigate(`/parametres?onglet=${t}`)}>
            {TABS[t]}
          </button>
        ))}
      </div>

      {tab === 'entreprise' && (
        <Card className="p-4">
          <p className="mb-4 text-sm text-muted">Ces informations sont imprimées sur vos devis et factures (mentions obligatoires) et figées sur chaque facture à son émission.</p>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nom ou dénomination" hint="Entrepreneur individuel : votre nom suivi de « EI »">
              <Input value={company.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="Forme juridique">
              <Select value={company.legalForm} onChange={(e) => set('legalForm', e.target.value)}>
                {['EI', 'EURL', 'SASU', 'SARL', 'SAS'].map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </Select>
            </Field>
            <Field label="SIREN">
              <Input value={company.siren} onChange={(e) => set('siren', e.target.value)} inputMode="numeric" />
            </Field>
            <Field label="SIRET">
              <Input value={company.siret} onChange={(e) => set('siret', e.target.value)} inputMode="numeric" />
            </Field>
            <Field label="Adresse" className="md:col-span-2">
              <TextArea rows={2} value={company.address} onChange={(e) => set('address', e.target.value)} />
            </Field>
            <Field label="E-mail">
              <Input type="email" value={company.email} onChange={(e) => set('email', e.target.value)} />
            </Field>
            <Field label="Téléphone">
              <Input value={company.phone} onChange={(e) => set('phone', e.target.value)} />
            </Field>
            <Field label="IBAN" hint="Imprimé sur les factures et rappelé dans les relances">
              <Input value={company.iban} onChange={(e) => set('iban', e.target.value)} />
            </Field>
            <Field label="BIC">
              <Input value={company.bic} onChange={(e) => set('bic', e.target.value)} />
            </Field>
            <Field label="Régime de TVA">
              <Select value={company.vatRegime} onChange={(e) => set('vatRegime', e.target.value)}>
                <option value="FRANCHISE">Franchise en base (art. 293 B du CGI)</option>
                <option value="REEL">Assujetti à la TVA</option>
              </Select>
            </Field>
            <Field label="N° de TVA intracommunautaire">
              <Input value={company.vatNumber} onChange={(e) => set('vatNumber', e.target.value)} />
            </Field>
          </div>
          <Button className="mt-5" variant="primary" icon={<Save className="size-4" />} busy={busy === 'save'} onClick={() => void update({ company, ...(company.vatRegime === 'FRANCHISE' ? { billing: { defaultVatRateBps: 0 } } : {}) }, 'Entreprise enregistrée')}>
            Enregistrer
          </Button>
        </Card>
      )}

      {tab === 'facturation' && (
        <Card className="p-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="TJM par défaut (€ HT)">
              <Input inputMode="decimal" value={billing.rate} onChange={(e) => setBilling({ ...billing, rate: e.target.value })} />
            </Field>
            <Field label="Heures facturées par jour">
              <Input inputMode="decimal" value={billing.hoursPerDay} onChange={(e) => setBilling({ ...billing, hoursPerDay: e.target.value })} />
            </Field>
            <Field label="TVA par défaut">
              <Select value={billing.defaultVat} disabled={company.vatRegime === 'FRANCHISE'} onChange={(e) => setBilling({ ...billing, defaultVat: e.target.value })}>
                {[0, 550, 1000, 2000].map((r) => (
                  <option key={r} value={r}>
                    {r / 100} %
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Délai de paiement (jours)" hint="60 jours au plus entre professionnels">
              <Input inputMode="numeric" value={billing.paymentTermsDays} onChange={(e) => setBilling({ ...billing, paymentTermsDays: e.target.value })} />
            </Field>
            <Field label="Validité des devis (jours)">
              <Input inputMode="numeric" value={billing.quoteValidityDays} onChange={(e) => setBilling({ ...billing, quoteValidityDays: e.target.value })} />
            </Field>
            <Field label="Préfixes facture / devis" hint="F-2026-0001, D-2026-0001">
              <div className="flex gap-2">
                <Input value={billing.invoicePrefix} onChange={(e) => setBilling({ ...billing, invoicePrefix: e.target.value })} aria-label="Préfixe des factures" />
                <Input value={billing.quotePrefix} onChange={(e) => setBilling({ ...billing, quotePrefix: e.target.value })} aria-label="Préfixe des devis" />
              </div>
            </Field>
            <Field label="Pénalités de retard (texte imprimé)" className="md:col-span-3" hint="Au moins 3 fois le taux d’intérêt légal ; l’indemnité forfaitaire de 40 € est ajoutée automatiquement">
              <Input value={billing.penalty} onChange={(e) => setBilling({ ...billing, penalty: e.target.value })} />
            </Field>
            <Field label="Pied de facture" className="md:col-span-3">
              <TextArea rows={2} value={billing.footer} onChange={(e) => setBilling({ ...billing, footer: e.target.value })} placeholder="Dispensé d’immatriculation au RCS et au RM…" />
            </Field>
            <Field label="Frais de service Malt par défaut (% HT)" hint="Malt a modifié ses frais plusieurs fois en 2026 : vérifiez le taux de chaque client sur help.malt.com">
              <Input inputMode="decimal" value={billing.maltFee} onChange={(e) => setBilling({ ...billing, maltFee: e.target.value })} />
            </Field>
          </div>
          <Button
            className="mt-5"
            variant="primary"
            icon={<Save className="size-4" />}
            busy={busy === 'save'}
            onClick={() =>
              void update(
                {
                  billing: {
                    defaultDailyRateCents: parseEuros(billing.rate) ?? data.billing.defaultDailyRateCents,
                    hoursPerDay: parseNumber(billing.hoursPerDay) ?? data.billing.hoursPerDay,
                    defaultVatRateBps: company.vatRegime === 'FRANCHISE' ? 0 : Number(billing.defaultVat),
                    paymentTermsDays: Number(billing.paymentTermsDays) || 0,
                    quoteValidityDays: Number(billing.quoteValidityDays) || 30,
                    latePenaltyRateText: billing.penalty,
                    footer: billing.footer,
                    invoicePrefix: billing.invoicePrefix || 'F',
                    quotePrefix: billing.quotePrefix || 'D',
                  },
                  malt: { feeBps: Math.round((parseNumber(billing.maltFee) ?? 10) * 100) },
                },
                'Facturation enregistrée',
              )
            }
          >
            Enregistrer
          </Button>
        </Card>
      )}

      {tab === 'relances' && (
        <Card className="flex flex-col gap-4 p-4">
          <Notice>Les relances ne concernent que les factures directes : pour une mission Malt, c’est Malt qui encaisse et relance le client.</Notice>
          <Field label="Jours après l’échéance (3 niveaux au plus)" hint="Rappel amical, relance avec rappel des pénalités, dernière relance avant mise en demeure">
            <Input className="max-w-xs" value={billing.offsets} onChange={(e) => setBilling({ ...billing, offsets: e.target.value })} placeholder="3, 15, 30" />
          </Field>
          <Toggle checked={data.reminders.autoSend} label="Envoyer automatiquement les relances dues (mode En ligne uniquement)" onChange={(v) => void update({ reminders: { autoSend: v } }, v ? 'Envoi automatique activé' : 'Envoi manuel')} />
          <Toggle checked={data.reminders.bccSelf} label="M’envoyer une copie cachée de chaque relance" onChange={(v) => void update({ reminders: { bccSelf: v } }, 'Réglage enregistré')} />
          <Button
            className="self-start"
            variant="primary"
            icon={<Save className="size-4" />}
            busy={busy === 'save'}
            onClick={() => {
              const offsets = billing.offsets.split(/[,;\s]+/).map((v) => Number(v)).filter((v) => Number.isInteger(v) && v >= 0).slice(0, 3)
              void update({ reminders: { offsetsDays: offsets.length ? offsets : [3, 15, 30] } }, 'Calendrier des relances enregistré')
            }}
          >
            Enregistrer le calendrier
          </Button>
        </Card>
      )}

      {tab === 'connexions' && <Connections settings={data} update={update} />}
    </>
  )
}
