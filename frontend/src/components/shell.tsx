// Cadre de l'application, forme du portail de la suite (charte v2 « Linear ») : barre latérale neutre de 232 px
// (marque, sélecteur de la suite, navigation, puis en pied l'interrupteur Hors ligne / En ligne et le thème),
// barre haute de 44 px avec le titre de la vue ; sur téléphone, bandeau en haut et rubriques en pastilles défilantes.
import {
  ChartColumn,
  Check,
  Clock3,
  FileText,
  Gauge,
  KanbanSquare,
  Kanban,
  LayoutGrid,
  Mail,
  Monitor,
  Moon,
  Receipt,
  Settings2,
  Sun,
  Table,
  Users,
  Wallet,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { api } from '../lib/api.ts'
import { href, useRoute } from '../lib/router.ts'
import { checkAnyHealth, CURRENT_APP, SUITE_APPS, type SuiteAppId, type SuiteStatus } from '../lib/suite.ts'
import { useThemePreference, type ThemePreference } from '../lib/theme.ts'
import { useApi } from '../lib/use-api.ts'
import type { Settings } from '../lib/types.ts'
import { useUi } from '../store/ui.ts'
import { TopBarSlot } from './topbar.ts'
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

/**
 * Marque commune de la Suite Atelier (design-system/brand/atelier-brand.css, docs/SUITE.md §1.6 d'Atelier Projets) :
 * icône carrée en dégradé de la signature (glyphe Lucide « receipt » blanc) + « Atelier Mission » ;
 * un clic ouvre la fenêtre « À propos » avec la grande icône de l'app.
 */
export function AtelierBrand() {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  return (
    <>
      <button type="button" className="atelier-brand min-w-0" aria-haspopup="dialog" title="À propos d'Atelier Mission" onClick={() => dialog.current?.showModal()}>
        <span className="atelier-brand__tile" aria-hidden="true">
          <Receipt />
        </span>
        <span className="atelier-brand__name truncate">
          <span className="atelier-brand__prefix">Atelier </span>Mission
        </span>
      </button>
      <dialog ref={dialog} className="atelier-about" aria-labelledby={titleId} onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}>
        <div className="atelier-about__panel">
          <button type="button" className="atelier-about__close" aria-label="Fermer" onClick={() => dialog.current?.close()}>
            <X className="size-4" aria-hidden />
          </button>
          <span className="atelier-about__icon atelier-brand__tile" aria-hidden="true">
            <Receipt />
          </span>
          <h2 id={titleId} className="atelier-about__name">
            <span className="atelier-brand__prefix">Atelier </span>Mission
          </h2>
          <p className="atelier-about__tagline">Mini-CRM freelance : prospects Malt, devis, factures et relances, relié à Projets, Trésorerie et Brevo.</p>
          <p className="atelier-about__suite">Suite Atelier · local d’abord</p>
        </div>
      </dialog>
    </>
  )
}

/** Icônes Lucide de la marque commune (docs/SUITE.md §1.6), dans l'icône carrée de chaque app, à sa couleur. */
const SUITE_ICONS: Record<SuiteAppId, ReactNode> = {
  mission: <Receipt />,
  projets: <Kanban />,
  tresorerie: <Wallet />,
  viz: <ChartColumn />,
  tab: <Table />,
}

type Health = SuiteStatus | 'checking'
const HEALTH_TEXT: Record<Health, string> = { up: 'En marche', down: 'Arrêtée', checking: 'Vérification…' }
/** Seule l'app arrêtée est colorée (rouge) ; en marche, simple mention ; vérification : cercle vide. */
const HEALTH_CLASS: Record<Health, string> = {
  up: 'text-muted',
  down: "font-medium text-down before:size-2 before:shrink-0 before:rounded-full before:bg-down before:content-['']",
  checking: "text-faint before:size-2 before:shrink-0 before:rounded-full before:shadow-[inset_0_0_0_1.5px_currentColor] before:content-['']",
}

/** Sélecteur « Suite Atelier » : menu des applications reliées, l'application courante cochée. */
function SuiteSwitcher() {
  const [open, setOpen] = useState(false)
  const [health, setHealth] = useState<Partial<Record<SuiteAppId, Health>>>({})
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const items = useRef<(HTMLElement | null)[]>([])
  const menuId = useId()

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) trigger.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    for (const app of SUITE_APPS) {
      if (app.id === CURRENT_APP) continue
      setHealth((h) => ({ ...h, [app.id]: 'checking' }))
      void checkAnyHealth(app.healthUrls).then((s) => !cancelled && setHealth((h) => ({ ...h, [app.id]: s })))
    }
    const onPointer = (e: MouseEvent) => !root.current?.contains(e.target as Node) && close(false)
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      close(true)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey, true)
    return () => {
      cancelled = true
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, close])

  const focusItem = (index: number) => {
    const list = items.current.filter((item): item is HTMLElement => item !== null)
    list[(index + list.length) % list.length]?.focus()
  }
  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items.current.filter((item): item is HTMLElement => item !== null)
    const index = list.indexOf(document.activeElement as HTMLElement)
    const moves: Record<string, number> = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: list.length - 1 }
    if (event.key in moves) {
      event.preventDefault()
      focusItem(moves[event.key]!)
    } else if (event.key === 'Tab') {
      close(false)
    }
  }

  return (
    <div ref={root} className="relative shrink-0">
      <button
        ref={trigger}
        type="button"
        className="ds-btn"
        data-variant="ghost"
        data-size="sm"
        data-icon-only=""
        aria-label="Suite Atelier : changer d’application"
        title="Suite Atelier"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setOpen((o) => !o)
          if (!open) requestAnimationFrame(() => focusItem(0))
        }}
      >
        <LayoutGrid aria-hidden />
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label="Suite Atelier" className="ds-card absolute left-0 top-full z-50 mt-1 w-80 max-w-[calc(100vw-1.75rem)] p-1 shadow-overlay" onKeyDown={onMenuKey}>
          <p className="px-2 pb-1 pt-1.5 text-xs font-medium text-faint" aria-hidden>
            Suite Atelier
          </p>
          {SUITE_APPS.map((app, index) => {
            const current = app.id === CURRENT_APP
            const state: Health = current ? 'up' : (health[app.id] ?? 'checking')
            return (
              <a
                key={app.id}
                ref={(element) => {
                  items.current[index] = element
                }}
                role="menuitemradio"
                aria-checked={current}
                aria-label={`${app.name}${current ? ' (application courante)' : ` — ${HEALTH_TEXT[state]}`}`}
                href={current ? '#/' : app.url}
                target={current ? undefined : '_blank'}
                rel="noreferrer"
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left no-underline hover:bg-hover focus-visible:bg-hover"
                onClick={() => close(false)}
              >
                <span className="atelier-brand__tile atelier-brand__tile--sm" data-atelier-app={app.id} aria-hidden="true">
                  {SUITE_ICONS[app.id]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="atelier-brand__name atelier-brand__name--sm">
                      <span className="atelier-brand__prefix">Atelier </span>
                      {app.short}
                    </span>
                    {!current && <span className={`ml-auto flex items-center gap-1.5 text-xs ${HEALTH_CLASS[state]}`}>{HEALTH_TEXT[state]}</span>}
                  </span>
                  <span className="block truncate text-xs text-muted">{app.description}</span>
                </span>
                <span className="grid size-5 shrink-0 place-items-center text-accent-ink">{current && <Check className="size-4" aria-hidden />}</span>
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Interrupteur Hors ligne / En ligne : seul le mode En ligne laisse partir les relances par Brevo. */
function OnlineSwitch() {
  const { data, setData } = useApi(() => api.get<Settings>('/settings'))
  const [confirm, setConfirm] = useState(false)
  const notify = useUi((s) => s.notify)
  const refresh = useUi((s) => s.refresh)
  const online = data?.onlineMode ?? false
  const set = async (value: boolean) => {
    try {
      setData(await api.put<Settings>('/settings/online-mode', { online: value }))
      notify(value ? 'En ligne : les relances peuvent partir par Brevo' : 'Hors ligne : rien ne quitte la machine')
      refresh()
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error')
    }
  }
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className={`!px-2 ${online ? '!text-fg' : ''}`}
        icon={online ? <Wifi className="text-accent-ink" /> : <WifiOff />}
        aria-pressed={online}
        title={online ? 'En ligne : Brevo autorisé' : 'Hors ligne : aucun envoi extérieur'}
        onClick={() => (online ? void set(false) : setConfirm(true))}
      >
        <span className="max-md:sr-only">{online ? 'En ligne' : 'Hors ligne'}</span>
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
          <p>En ligne, Atelier Mission peut envoyer les relances de factures par Brevo. C’est le seul flux qui quitte votre machine.</p>
          <p className="rounded-md border border-line bg-sidebar px-3 py-2">
            <strong className="font-semibold">Envoyé à Brevo :</strong> adresse et nom du client, numéro, date, titre et reste à payer de la facture, votre nom, e-mail et IBAN.
          </p>
          <p className="text-muted">Atelier Projets et Atelier Trésorerie restent joints en local (127.0.0.1), en ligne comme hors ligne.</p>
        </div>
      </Modal>
    </>
  )
}

const THEMES: { id: ThemePreference; label: string; icon: ReactNode }[] = [
  { id: 'system', label: 'Thème du système', icon: <Monitor /> },
  { id: 'light', label: 'Thème clair', icon: <Sun /> },
  { id: 'dark', label: 'Thème sombre', icon: <Moon /> },
]

/** Choix du thème (Système / Clair / Sombre), commun à toute la suite. */
function ThemeSwitch() {
  const [theme, setTheme] = useThemePreference()
  return (
    <div className="ds-seg shrink-0" role="group" aria-label="Thème">
      {THEMES.map((option) => (
        <button key={option.id} type="button" aria-label={option.label} title={option.label} aria-pressed={theme === option.id} onClick={() => setTheme(option.id)}>
          {option.icon}
        </button>
      ))}
    </div>
  )
}

const NAV_ITEM =
  'flex h-[30px] shrink-0 items-center gap-2.5 whitespace-nowrap rounded-full border border-line px-3 text-sm font-medium no-underline transition-colors hover:bg-hover hover:text-fg md:rounded-md md:border-0 md:px-2 [&>svg]:hidden [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-faint md:[&>svg]:block'

export function Shell({ children }: { children: ReactNode }) {
  const { segments } = useRoute()
  const active = `/${segments[0] ?? ''}`
  const current = NAV.find((item) => item.to === active) ?? NAV[0]
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  return (
    <div className="flex min-h-full flex-col md:grid md:grid-cols-[var(--side-w)_minmax(0,1fr)]">
      <aside className="ds-chrome flex flex-col gap-2 border-b border-line px-3.5 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] md:sticky md:top-0 md:z-40 md:h-screen md:gap-0 md:border-b-0 md:border-r md:px-2 md:pb-2 md:pt-3">
        <div className="flex min-w-0 items-center gap-1 md:px-1 md:pb-3">
          <SuiteSwitcher />
          <AtelierBrand />
          <div className="ml-auto flex items-center gap-1.5 md:hidden">
            <OnlineSwitch />
            <ThemeSwitch />
          </div>
        </div>
        <nav
          className="-mx-3.5 flex gap-1 overflow-x-auto px-3.5 [scrollbar-width:none] md:mx-0 md:flex-col md:gap-px md:overflow-visible md:px-0"
          aria-label="Navigation principale"
        >
          {NAV.map((item) => {
            const isCurrent = active === item.to
            return (
              <a key={item.to} href={href(item.to)} aria-current={isCurrent ? 'page' : undefined} className={`${NAV_ITEM} ${isCurrent ? 'border-transparent bg-selected text-fg md:[&>svg]:text-fg' : 'text-fg/80'}`}>
                {item.icon}
                {item.label}
              </a>
            )
          })}
        </nav>
        <div className="mt-auto hidden items-center justify-between gap-2 border-t border-line pt-2 md:flex">
          <OnlineSwitch />
          <ThemeSwitch />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="ms-top sticky top-0 z-30 flex min-h-[var(--top-h)] items-center gap-3 border-b border-line px-4 md:px-5">
          <div ref={setSlot} className="peer flex min-w-0 items-center empty:hidden" />
          <h1 className="truncate text-sm font-semibold peer-[:not(:empty)]:hidden">{current.label}</h1>
        </header>
        <TopBarSlot.Provider value={slot}>
          <main className="mx-auto w-full max-w-[90rem] flex-1 px-4 py-4 md:px-5 md:py-5">{children}</main>
        </TopBarSlot.Provider>
      </div>
    </div>
  )
}
