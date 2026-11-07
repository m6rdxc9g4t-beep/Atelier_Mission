// Briques d'interface au-dessus des classes ds-* du design system. Aucune couleur ici : la teinte vient des
// attributs data-stage / data-invoice / data-quote / data-channel / data-money (design-system/components/mission.css).
import { AlertTriangle, CheckCircle2, ChevronRight, Info, Loader2, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { euros } from '../lib/format.ts'
import { CHANNEL_LABEL, INVOICE_STATUS_LABEL, QUOTE_STATUS_LABEL, STAGE_LABEL } from '../lib/labels.ts'
import type { Channel, InvoiceStatus, QuoteStatus, Stage } from '../lib/types.ts'
import { href } from '../lib/router.ts'
import { useUi } from '../store/ui.ts'
import { useTopBarSlot } from './topbar.ts'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; icon?: ReactNode; busy?: boolean }

export function Button({ variant = 'default', size = 'md', icon, busy, children, className, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`ds-btn ${className ?? ''}`}
      data-variant={variant === 'default' ? undefined : variant}
      data-size={size === 'sm' ? 'sm' : undefined}
      data-icon-only={children === undefined ? '' : undefined}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
}

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ds-card ${className ?? ''}`} {...rest} />
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={`ds-eyebrow ${className ?? ''}`}>{children}</h2>
}

/**
 * En-tête d'une vue. Le titre part dans la barre haute de la coquille (44 px, avec la rubrique parente en fil
 * d'Ariane pour une fiche) ; le sous-titre et les actions forment la première ligne du contenu.
 */
export function PageHeader({ title, subtitle, actions, parent }: { title: string; subtitle?: ReactNode; actions?: ReactNode; parent?: { to: string; label: string } }) {
  const slot = useTopBarSlot()
  const heading = (
    <h1 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
      {parent && (
        <>
          <a href={href(parent.to)} className="shrink-0 font-medium text-muted no-underline hover:text-fg">
            {parent.label}
          </a>
          <ChevronRight className="size-3.5 shrink-0 text-faint" aria-hidden />
        </>
      )}
      <span className="truncate">{title}</span>
    </h1>
  )
  return (
    <>
      {slot ? createPortal(heading, slot) : null}
      {(subtitle || actions || !slot) && (
        <header className="mb-4 flex min-h-[1.875rem] flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {!slot && heading}
          {subtitle ? <div className="min-w-0 text-sm text-muted">{subtitle}</div> : <span />}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
    </>
  )
}

/** Choix exclusif compact (filtres de statut, de canal) : contrôle segmenté de la charte. */
export function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: readonly { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  return (
    <div className="ds-seg max-w-full overflow-x-auto [scrollbar-width:none]" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value || 'all'} type="button" className="shrink-0 whitespace-nowrap" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function StageBadge({ stage }: { stage: Stage }) {
  return <span className="ds-badge" data-stage={stage}>{STAGE_LABEL[stage]}</span>
}
export function InvoiceBadge({ status }: { status: InvoiceStatus }) {
  return <span className="ds-badge" data-invoice={status}>{INVOICE_STATUS_LABEL[status]}</span>
}
export function QuoteBadge({ status }: { status: QuoteStatus }) {
  return <span className="ds-badge" data-quote={status}>{QUOTE_STATUS_LABEL[status]}</span>
}
export function ChannelBadge({ channel }: { channel: Channel }) {
  return (
    <span className="ds-badge" data-channel={channel} data-plain="">
      {CHANNEL_LABEL[channel]}
    </span>
  )
}
export function ToneBadge({ tone, children, attr = 'data-reminder' }: { tone: string; children: ReactNode; attr?: 'data-reminder' | 'data-money' }) {
  return (
    <span className="ds-badge" {...{ [attr]: tone }}>
      {children}
    </span>
  )
}

export function Money({ cents, tone, className }: { cents: number; tone?: 'in' | 'out' | 'late'; className?: string }) {
  return (
    <span className={`ms-num whitespace-nowrap ${tone ? 'ds-ink' : ''} ${className ?? ''}`} data-money={tone}>
      {euros(cents)}
    </span>
  )
}

/**
 * Carte de chiffre (`.atelier-kpi` de la marque commune : plate, trait de 1 px, coins de 12 px, chiffre tabulaire).
 * Seul un montant anormal (en retard) prend une couleur ; les autres restent à l'encre.
 */
export function Kpi({ label, value, hint, tone, icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'in' | 'out' | 'late'; icon?: ReactNode }) {
  const alert = tone === 'late'
  return (
    <div className="atelier-kpi">
      <div className="atelier-kpi__label flex min-w-0 items-center gap-2">
        <span className="text-faint max-sm:hidden [&>svg]:size-4" aria-hidden>
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </div>
      <div className={`atelier-kpi__value ms-num ${alert ? 'ds-ink' : ''}`} data-money={alert ? tone : undefined}>
        {value}
      </div>
      {hint && <div className="atelier-kpi__note">{hint}</div>}
    </div>
  )
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`ds-label ${className ?? ''}`}>
      <span>{label}</span>
      {children}
      {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
    </label>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`ds-input ${props.className ?? ''}`} />
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`ds-select ${props.className ?? ''}`} />
}
export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`ds-textarea !font-sans ${props.className ?? ''}`} />
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-muted hover:text-fg">
      <input type="checkbox" className="size-3.5 accent-[var(--accent)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

/** Fenêtre modale native (<dialog>) : Échap et clic à l'extérieur ferment, focus piégé par le navigateur. */
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      className={`ds-card m-auto max-h-[90vh] w-[calc(100%-2rem)] overflow-hidden p-0 text-fg shadow-overlay ${wide ? 'max-w-4xl' : 'max-w-lg'}`}
    >
      {open && (
        <div className="flex max-h-[90vh] flex-col">
          <div className="flex min-h-12 items-center justify-between gap-4 border-b border-line py-2 pl-4 pr-2.5">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            <Button variant="ghost" size="sm" icon={<X />} aria-label="Fermer" onClick={onClose} />
          </div>
          <div className="overflow-y-auto px-4 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <div className="mb-1 text-faint [&>svg]:size-6" aria-hidden>
        {icon}
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      {children && <p className="max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function Loading({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-muted" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {label}
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-2.5 rounded-md border border-down/30 bg-down/10 px-3 py-2.5 text-down" role="alert">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex-1 text-sm">{error.message}</div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Réessayer
        </Button>
      )}
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: ReactNode }) {
  return (
    <div className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm ${tone === 'warn' ? 'border-warn/35 bg-warn/10' : 'border-line bg-sidebar'}`}>
      {tone === 'warn' ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden /> : <Info className="mt-0.5 size-4 shrink-0 text-faint" aria-hidden />}
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismiss)
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 md:inset-x-auto md:right-4 md:items-end" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="ds-card pointer-events-auto flex w-full max-w-md items-start gap-2.5 px-3 py-2.5 text-sm shadow-overlay" role={t.tone === 'error' ? 'alert' : undefined}>
          {t.tone === 'error' ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-down" aria-hidden /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-faint" aria-hidden />}
          <span className="flex-1 leading-snug">{t.message}</span>
          <button type="button" className="grid size-5 place-items-center rounded text-muted hover:bg-hover hover:text-fg" aria-label="Fermer" onClick={() => dismiss(t.id)}>
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
