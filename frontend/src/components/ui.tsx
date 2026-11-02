// Briques d'interface au-dessus des classes ds-* du design system. Aucune couleur ici : la teinte vient des
// attributs data-stage / data-invoice / data-quote / data-channel / data-money (design-system/components/mission.css).
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from 'lucide-react'
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { euros } from '../lib/format.ts'
import { CHANNEL_LABEL, INVOICE_STATUS_LABEL, QUOTE_STATUS_LABEL, STAGE_LABEL } from '../lib/labels.ts'
import type { Channel, InvoiceStatus, QuoteStatus, Stage } from '../lib/types.ts'
import { useUi } from '../store/ui.ts'

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

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="ds-title-glow text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
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

export function Kpi({ label, value, hint, tone, icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'in' | 'out' | 'late'; icon?: ReactNode }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="ds-eyebrow">{label}</span>
        <span className="text-accent-ink [&>svg]:size-4" aria-hidden>
          {icon}
        </span>
      </div>
      <div className="ms-num text-2xl font-semibold tracking-tight ds-ink" data-money={tone}>
        {value}
      </div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </Card>
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
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
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
      className={`ds-card m-auto max-h-[90vh] w-[calc(100%-2rem)] overflow-hidden p-0 text-fg backdrop:bg-backdrop backdrop:backdrop-blur-sm ${wide ? 'max-w-4xl' : 'max-w-lg'}`}
    >
      {open && (
        <div className="flex max-h-[90vh] flex-col">
          <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            <Button variant="ghost" size="sm" icon={<X className="size-4" />} aria-label="Fermer" onClick={onClose} />
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent-ink [&>svg]:size-6">{icon}</div>
      <h3 className="text-base font-semibold">{title}</h3>
      {children && <p className="max-w-md text-sm text-muted">{children}</p>}
      {action}
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
    <Card className="flex items-start gap-3 p-4" role="alert" data-money="late">
      <AlertTriangle className="mt-0.5 size-5 shrink-0 ds-ink" aria-hidden />
      <div className="flex-1 text-sm">{error.message}</div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Réessayer
        </Button>
      )}
    </Card>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-line-soft bg-accent-faint px-3 py-2 text-sm" data-money={tone === 'warn' ? 'late' : undefined}>
      {tone === 'warn' ? <AlertTriangle className="mt-0.5 size-4 shrink-0 ds-ink" aria-hidden /> : <Info className="mt-0.5 size-4 shrink-0 text-accent-ink" aria-hidden />}
      <div>{children}</div>
    </div>
  )
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismiss)
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="ds-card pointer-events-auto flex max-w-xl items-start gap-2 px-4 py-3 text-sm shadow-overlay" data-money={t.tone === 'error' ? 'late' : t.tone === 'success' ? 'in' : undefined}>
          {t.tone === 'error' ? <AlertTriangle className="mt-0.5 size-4 shrink-0 ds-ink" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 ds-ink" />}
          <span className="flex-1">{t.message}</span>
          <button type="button" className="text-muted hover:text-fg" aria-label="Fermer" onClick={() => dismiss(t.id)}>
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
