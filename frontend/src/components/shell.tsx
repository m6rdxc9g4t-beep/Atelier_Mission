// Cadre de l'application : marque, sélecteur de la suite, interrupteur Hors ligne / En ligne, thème, navigation.
import {
  BarChart3,
  BriefcaseBusiness,
  CalendarCheck,
  Check,
  ChevronDown,
  Clock3,
  FileText,
  Gauge,
  KanbanSquare,
  Landmark,
  LayoutGrid,
  Mail,
  Monitor,
  Moon,
  Receipt,
  Settings2,
  Sun,
  Table2,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../lib/api.ts'
import { href, useRoute } from '../lib/router.ts'
import { checkAnyHealth, CURRENT_APP, SUITE_APPS, type SuiteAppId, type SuiteStatus } from '../lib/suite.ts'
import { applyTheme, onSystemThemeChange, resolveTheme, type ThemePreference } from '../lib/theme.ts'
import { useApi } from '../lib/use-api.ts'
import type { Settings } from '../lib/types.ts'
import { useUi } from '../store/ui.ts'
import { Button, Modal } from './ui.tsx'

export const NAV = [
  { to: '/', label: 'Tableau de bord', icon: <Gauge /> },
  { to: '/pipeline', label: 'Pipeline', icon: <KanbanSquare /> },
  { to: '/clients', label: 'Clients', icon: <Users /> },
  { to: '/devis', label: 'Devis', icon: <FileText /> },
  { to: '/factures', label: 'Factures', icon: <Receipt /> },
  { to: '/temps', label: 'Temps (Projets)', icon: <Clock3 /> },
  { to: '/relances', label: 'Relances', icon: <Mail /> },
  { to: '/parametres', label: 'Paramètres', icon: <Settings2 /> },
] as const

export function AtelierBrand() {
  const dialog = useRef<HTMLDialogElement>(null)
  return (
    <>
      <button type="button" className="atelier-brand" aria-haspopup="dialog" title="À propos d'Atelier Mission" onClick={() => dialog.current?.showModal()}>
        <span className="atelier-brand__tile" aria-hidden="true">
          <BriefcaseBusiness />
        </span>
        <span className="atelier-brand__name">
          <span className="atelier-brand__prefix">atelier_</span>Mission
        </span>
      </button>
      <dialog ref={dialog} className="atelier-about" aria-label="À propos d'Atelier Mission" onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}>
        <div className="atelier-about__panel">
          <button type="button" className="atelier-about__close" aria-label="Fermer" onClick={() => dialog.current?.close()}>
            ×
          </button>
          <div className="atelier-brand__tile mx-auto !size-28 [&>svg]:!size-14" data-atelier-app="mission" aria-hidden>
            <BriefcaseBusiness />
          </div>
          <h2 className="atelier-about__name">
            <span className="atelier-brand__prefix">atelier_</span>Mission
          </h2>
          <p className="atelier-about__tagline">Mini-CRM freelance : prospects Malt, devis, factures et relances, relié à Projets, Trésorerie et Brevo.</p>
          <p className="atelier-about__suite">Suite Atelier · local d’abord</p>
        </div>
      </dialog>
    </>
  )
}

const SUITE_ICONS: Record<SuiteAppId, ReactNode> = {
  mission: <BriefcaseBusiness />,
  projets: <CalendarCheck />,
  tresorerie: <Landmark />,
  viz: <BarChart3 />,
  tab: <Table2 />,
}

function SuiteSwitcher() {
  const [open, setOpen] = useState(false)
  const [health, setHealth] = useState<Partial<Record<SuiteAppId, SuiteStatus | 'checking'>>>({})
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    for (const app of SUITE_APPS) {
      if (app.id === CURRENT_APP) continue
      setHealth((h) => ({ ...h, [app.id]: 'checking' }))
      void checkAnyHealth(app.healthUrls).then((s) => !cancelled && setHealth((h) => ({ ...h, [app.id]: s })))
    }
    const onPointer = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      cancelled = true
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={root} className="relative">
      <Button variant="ghost" size="sm" icon={<LayoutGrid className="size-4" />} aria-label="Suite Atelier" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)} />
      {open && (
        <div role="menu" className="ds-card absolute left-0 top-10 z-40 w-80 p-2 shadow-overlay">
          <p className="ds-eyebrow px-2 py-1">Suite Atelier</p>
          {SUITE_APPS.map((app) => {
            const state = app.id === CURRENT_APP ? 'up' : health[app.id]
            return (
              <a
                key={app.id}
                role="menuitem"
                href={app.id === CURRENT_APP ? '#/' : app.url}
                target={app.id === CURRENT_APP ? undefined : '_blank'}
                rel="noreferrer"
                className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-hover"
                onClick={() => setOpen(false)}
              >
                <span className="atelier-brand__tile atelier-brand__tile--sm" data-atelier-app={app.id} aria-hidden>
                  {SUITE_ICONS[app.id]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="atelier-brand__name atelier-brand__name--sm block">
                    <span className="atelier-brand__prefix">atelier_</span>
                    {app.short}
                  </span>
                  <span className="block truncate text-xs text-muted">{app.description}</span>
                </span>
                {app.id === CURRENT_APP ? (
                  <Check className="size-4 text-accent-ink" aria-label="Application courante" />
                ) : (
                  <span className="ds-badge" data-reminder={state === 'up' ? 'SENT' : state === 'down' ? 'FAILED' : 'PLANNED'} title={state === 'up' ? 'En marche' : state === 'down' ? 'Arrêtée' : 'Vérification…'}>
                    {state === 'up' ? 'En marche' : state === 'down' ? 'Arrêtée' : '…'}
                  </span>
                )}
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}

function OnlineSwitch() {
  const { data, setData } = useApi(() => api.get<Settings>('/settings'))
  const [confirm, setConfirm] = useState(false)
  const notify = useUi((s) => s.notify)
  const refresh = useUi((s) => s.refresh)
  const online = data?.onlineMode ?? false
  const set = async (value: boolean) => {
    try {
      setData(await api.put<Settings>('/settings/online-mode', { online: value }))
      notify(value ? 'En ligne : factures électroniques et relances peuvent partir' : 'Hors ligne : rien ne quitte la machine')
      refresh()
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error')
    }
  }
  return (
    <>
      <Button
        size="sm"
        variant={online ? 'primary' : 'default'}
        icon={online ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}
        aria-pressed={online}
        title={online ? 'En ligne : SUPER PDP et Brevo autorisés' : 'Hors ligne : aucun envoi extérieur'}
        onClick={() => (online ? void set(false) : setConfirm(true))}
      >
        <span className="hidden sm:inline">{online ? 'En ligne' : 'Hors ligne'}</span>
      </Button>
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Passer en ligne ?"
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>Rester hors ligne</Button>
            <Button
              variant="primary"
              icon={<Wifi className="size-4" />}
              onClick={() => {
                setConfirm(false)
                void set(true)
              }}
            >
              Passer en ligne
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p>En ligne, Atelier Mission échange avec deux services extérieurs, et seulement eux.</p>
          <p className="rounded-md bg-accent-faint px-3 py-2">
            <strong>SUPER PDP (plateforme agréée) :</strong> chaque facture directe émise et ses avoirs au format Factur-X (contenu complet de la facture), et les montants encaissés (statut « Encaissée »).
          </p>
          <p className="rounded-md bg-accent-faint px-3 py-2">
            <strong>Brevo (relances) :</strong> adresse et nom du client, numéro, date, titre et reste à payer de la facture, votre nom, e-mail et IBAN.
          </p>
          <p className="text-muted">Atelier Projets et Atelier Trésorerie restent joints en local (127.0.0.1), en ligne comme hors ligne.</p>
        </div>
      </Modal>
    </>
  )
}

function ThemeMenu() {
  const theme = useUi((s) => s.theme)
  const setTheme = useUi((s) => s.setTheme)
  useEffect(() => {
    applyTheme(resolveTheme(theme))
    return theme === 'system' ? onSystemThemeChange(applyTheme) : undefined
  }, [theme])
  const next: Record<ThemePreference, ThemePreference> = { light: 'dark', dark: 'system', system: 'light' }
  const icon = theme === 'light' ? <Sun className="size-4" /> : theme === 'dark' ? <Moon className="size-4" /> : <Monitor className="size-4" />
  const label = theme === 'light' ? 'Thème clair' : theme === 'dark' ? 'Thème sombre' : 'Thème du système'
  return <Button variant="ghost" size="sm" icon={icon} aria-label={`${label} (changer)`} title={label} onClick={() => setTheme(next[theme])} />
}

export function Shell({ children }: { children: ReactNode }) {
  const { segments } = useRoute()
  const active = `/${segments[0] ?? ''}`
  const [menu, setMenu] = useState(false)
  return (
    <div className="flex min-h-full">
      <aside className="ds-chrome sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line px-3 py-4 lg:flex">
        <div className="mb-6 flex items-center gap-1 px-1">
          <SuiteSwitcher />
          <AtelierBrand />
        </div>
        <nav className="flex flex-col gap-0.5" aria-label="Navigation principale">
          {NAV.map((item) => (
            <a
              key={item.to}
              href={href(item.to)}
              aria-current={active === item.to ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm [&>svg]:size-4 ${active === item.to ? 'ds-nav-active font-medium' : 'text-muted hover:bg-hover hover:text-fg'}`}
            >
              {item.icon}
              {item.label}
            </a>
          ))}
        </nav>
        <div className="mt-auto flex items-center justify-between gap-2 px-1">
          <OnlineSwitch />
          <ThemeMenu />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="ds-chrome sticky top-0 z-30 flex items-center gap-2 border-b border-line px-4 py-2 lg:hidden">
          <SuiteSwitcher />
          <AtelierBrand />
          <div className="ml-auto flex items-center gap-1">
            <OnlineSwitch />
            <ThemeMenu />
            <Button variant="ghost" size="sm" icon={<ChevronDown className={`size-4 transition ${menu ? 'rotate-180' : ''}`} />} aria-label="Menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)} />
          </div>
        </header>
        {menu && (
          <nav className="ds-chrome grid grid-cols-2 gap-1 border-b border-line p-2 lg:hidden" aria-label="Navigation principale">
            {NAV.map((item) => (
              <a key={item.to} href={href(item.to)} onClick={() => setMenu(false)} className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm [&>svg]:size-4 ${active === item.to ? 'ds-nav-active' : 'text-muted'}`}>
                {item.icon}
                {item.label}
              </a>
            ))}
          </nav>
        )}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
