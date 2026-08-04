import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Loader2, X } from 'lucide-react'

/* ------------------------------------------------------------------ layout */

/**
 * Page frame: sticky header, scrolling body, clearance for the tab bar.
 *
 * The column is capped and centred. Without it the app is a stretched phone on
 * a desktop browser — cards become 2000px slivers of `p-4`. The page colour
 * stays on the column so the sunk body colour reads as a frame around it.
 */
export function Screen({
  title,
  subtitle,
  action,
  lead,
  children,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  /** Rendered above the title, inside the header — e.g. a back button row. */
  lead?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mx-auto min-h-svh w-full max-w-[30rem] bg-page pb-[calc(var(--tabbar-h)+4.5rem)] md:shadow-lift">
      <header className="sticky top-0 z-10 bg-page/95 px-5 pt-[env(safe-area-inset-top)] backdrop-blur">
        {lead}
        <div className="flex items-end justify-between gap-3 pt-4 pb-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-balance text-ink">{title}</h1>
            {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
          </div>
          {action}
        </div>
      </header>
      <main className="px-5">{children}</main>
    </div>
  )
}

export function SectionHeading({
  children,
  action,
}: {
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mt-7 mb-3 flex items-center justify-between gap-3">
      <h2 className="text-lg font-semibold text-ink">{children}</h2>
      {action}
    </div>
  )
}

/**
 * The quieter of the two heading levels. Labels a group inside a screen that
 * already has a SectionHeading — "PODIUM" under "Session wrapped!" — so a dense
 * screen gets structure without a second row of same-sized bold text.
 */
export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={`text-[11px] font-semibold uppercase tracking-[0.14em] text-muted ${className}`}
    >
      {children}
    </p>
  )
}

/* ----------------------------------------------------------------- surfaces */

export function Card({
  className = '',
  interactive,
  ...props
}: ComponentProps<'div'> & {
  /** Hover lift and press feedback, for a card that is itself a link or button. */
  interactive?: boolean
}) {
  return (
    <div
      className={`rounded-2xl bg-surface p-4 shadow-card ${
        interactive
          ? 'transition-all active:scale-[0.99] md:hover:-translate-y-0.5 md:hover:shadow-lift'
          : ''
      } ${className}`}
      {...props}
    />
  )
}

/**
 * Dark hero surface — session header, player card. Carries white text.
 *
 * `watermark` is the oversized icon bled off the bottom-right corner. It is
 * decorative only: it never carries meaning the text does not already state.
 */
export function DarkCard({
  className = '',
  watermark: Mark,
  children,
  ...props
}: ComponentProps<'div'> & { watermark?: LucideIcon }) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-surface-dark p-4 text-white ${className}`}
      {...props}
    >
      {Mark && (
        <Mark
          size={150}
          strokeWidth={1.25}
          aria-hidden
          className="pointer-events-none absolute -right-6 -bottom-8 text-white/[0.07]"
        />
      )}
      <div className="relative">{children}</div>
    </div>
  )
}

/* ----------------------------------------------------------------- controls */

const BUTTON_VARIANTS = {
  // `primary` (not `brand`) because this carries a white label — see theme.ts.
  primary: 'bg-primary text-white hover:bg-primary/90',
  // `brand` is the bright yellow-green, so the label must be ink.
  brand: 'bg-brand text-ink hover:bg-brand/90',
  secondary: 'bg-tint text-primary hover:bg-tint/70',
  ghost: 'bg-transparent text-muted hover:bg-tint/60',
  danger: 'bg-danger text-white hover:bg-danger/90',
} as const

// `sm` opts out of the global 44px floor via .kq-chip. Only ever for a
// secondary action that sits beside a full-size one — never a lone control.
const BUTTON_SIZES = {
  sm: 'kq-chip gap-1.5 px-3 text-xs',
  md: 'min-w-11 gap-2 px-5 text-sm',
} as const

export function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  full,
  loading,
  className = '',
  children,
  disabled,
  ...props
}: ComponentProps<'button'> & {
  variant?: keyof typeof BUTTON_VARIANTS
  size?: keyof typeof BUTTON_SIZES
  icon?: LucideIcon
  full?: boolean
  /** Swaps the icon for a spinner and disables the button. */
  loading?: boolean
}) {
  const Glyph = loading ? Loader2 : Icon
  return (
    <button
      // min-w matters for the icon-only buttons: at `px-3` with no label they
      // come out 42px wide, two short of a usable target on a court.
      className={`inline-flex items-center justify-center rounded-full font-semibold transition-all active:scale-95 disabled:pointer-events-none disabled:opacity-40 ${BUTTON_SIZES[size]} ${BUTTON_VARIANTS[variant]} ${full ? 'w-full' : ''} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {Glyph && (
        <Glyph
          size={size === 'sm' ? 15 : 18}
          strokeWidth={2.25}
          aria-hidden
          className={loading ? 'animate-spin' : ''}
        />
      )}
      {children}
    </button>
  )
}

/**
 * Two-step destructive action. The first tap arms it, the second commits, and
 * there is always a way out — an armed control with no dismiss is a trap.
 *
 * Busy and error state stay with the caller, which already holds a `useAction`
 * for the write itself.
 */
export function ConfirmButton({
  label,
  ariaLabel,
  confirmLabel,
  variant = 'ghost',
  icon,
  size = 'md',
  full,
  busy,
  error,
  onConfirm,
  className = '',
}: {
  /** Empty for an icon-only button — pass `ariaLabel` too when it is. */
  label: string
  ariaLabel?: string
  /** Phrase it as the consequence — "End the session?", not "Confirm". */
  confirmLabel: string
  variant?: keyof typeof BUTTON_VARIANTS
  icon?: LucideIcon
  size?: keyof typeof BUTTON_SIZES
  full?: boolean
  busy?: boolean
  error?: string
  onConfirm: () => void
  className?: string
}) {
  const [armed, setArmed] = useState(false)

  if (!armed) {
    return (
      <Button
        variant={variant}
        size={size}
        icon={icon}
        full={full}
        className={className}
        aria-label={ariaLabel}
        onClick={() => setArmed(true)}
      >
        {label}
      </Button>
    )
  }

  return (
    <div className={full ? 'w-full' : 'inline-flex flex-col items-end'}>
      <div className="flex items-center gap-1.5">
        <Button
          variant="danger"
          size={size}
          full={full}
          loading={busy}
          autoFocus
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
        <Button
          variant="ghost"
          size={size}
          icon={X}
          aria-label="Keep it"
          className="shrink-0 px-2"
          onClick={() => setArmed(false)}
        />
      </div>
      {error && <p className="mt-1 text-xs font-medium text-danger">{error}</p>}
    </div>
  )
}

const PILL_TONES = {
  neutral: 'bg-tint text-primary',
  live: 'bg-brand text-ink',
  warn: 'bg-warn-tint text-warn',
  danger: 'bg-danger-tint text-danger',
  onDark: 'bg-white/15 text-white',
} as const

export function Pill({
  tone = 'neutral',
  dot,
  className = '',
  children,
}: {
  tone?: keyof typeof PILL_TONES
  /** Leading status dot, as on the LIVE badge. */
  dot?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${PILL_TONES[tone]} ${className}`}
    >
      {dot && (
        // Only the live tone pulses. A pulsing dot on a static state reads as
        // something still loading.
        <span
          className={`h-1.5 w-1.5 rounded-full bg-current ${tone === 'live' ? 'kq-pulse' : ''}`}
          aria-hidden
        />
      )}
      {children}
    </span>
  )
}

/* -------------------------------------------------------------------- stats */

/** Icon + number + caption, for a strip on a dark surface. */
export function StatTile({
  icon: Icon,
  value,
  label,
  tone = 'default',
}: {
  icon: LucideIcon
  value: string | number
  label: string
  tone?: 'default' | 'onDark'
}) {
  const onDark = tone === 'onDark'
  return (
    <div className="flex flex-col items-center gap-1">
      <Icon
        size={18}
        strokeWidth={2.25}
        className={onDark ? 'text-accent' : 'text-primary'}
        aria-hidden
      />
      <span
        className={`tnum text-lg font-bold leading-none ${onDark ? 'text-white' : 'text-ink'}`}
      >
        {value}
      </span>
      <span
        className={`text-[10px] font-medium uppercase tracking-wider ${onDark ? 'text-white/70' : 'text-muted'}`}
      >
        {label}
      </span>
    </div>
  )
}

const STAT_TONES = {
  default: 'text-ink',
  good: 'text-primary',
  warn: 'text-warn',
  danger: 'text-danger',
} as const

/**
 * The standalone white stat card, for a row of two to four headline numbers on
 * the page background. StatTile is its counterpart inside a dark strip.
 */
export function StatCard({
  icon: Icon,
  value,
  label,
  tone = 'default',
}: {
  icon?: LucideIcon
  value: string | number
  label: string
  tone?: keyof typeof STAT_TONES
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-2xl bg-surface px-2 py-3 shadow-card">
      {Icon && <Icon size={16} strokeWidth={2.25} className="mb-0.5 text-muted" aria-hidden />}
      <span className={`tnum text-xl font-bold leading-none ${STAT_TONES[tone]}`}>{value}</span>
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted">{label}</span>
    </div>
  )
}

/* ------------------------------------------------------------------- inputs */

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-ink">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      <span className="mt-1.5 block">{children}</span>
    </label>
  )
}

// Controls always fill their container. Passing a `w-*` class will NOT narrow
// them — Tailwind resolves conflicting width utilities by stylesheet order, not
// by the order of the class attribute, so `w-full` wins. To size a control,
// wrap it in a sized element instead.
const CONTROL =
  'w-full rounded-xl border border-hairline bg-surface px-3.5 text-base text-ink transition-colors placeholder:text-muted focus:border-primary focus:outline-none'

export function Input({ className = '', ...props }: ComponentProps<'input'>) {
  return <input className={`${CONTROL} ${className}`} {...props} />
}

export function Select({ className = '', ...props }: ComponentProps<'select'>) {
  return <select className={`${CONTROL} ${className}`} {...props} />
}

/* ---------------------------------------------------------------- feedback */

/**
 * Inline error, for a failed load or a rejected write. `role="alert"` because
 * these appear after the screen has settled — without it a failed save is
 * completely silent to a screen reader.
 *
 * `onRetry` matters: every screen using this already holds a `reload` from
 * useAsync, so a failed load with no way back is a dead end for no reason.
 */
export function ErrorNote({
  children,
  onRetry,
}: {
  children: ReactNode
  onRetry?: () => void
}) {
  return (
    <Card className="border border-danger-tint">
      <p role="alert" className="break-words text-sm font-medium text-danger">
        {children}
      </p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </Card>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p role="status" className="flex items-center justify-center gap-2 py-8 text-sm text-muted">
      <Loader2 size={16} className="animate-spin" aria-hidden />
      {label}
    </p>
  )
}

/**
 * Bottom-anchored undo for an action that already happened. Sits above the tab
 * bar and expires on its own — an undo that waits forever is a second thing to
 * dismiss.
 */
export function UndoBar({
  message,
  actionLabel = 'Undo',
  onAction,
  onDismiss,
}: {
  message: string
  actionLabel?: string
  onAction: () => void
  onDismiss: () => void
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 6000)
    return () => clearTimeout(timer)
  }, [onDismiss])

  return (
    <div className="kq-slide-up fixed inset-x-0 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+0.75rem)] z-30 px-5 md:bottom-[calc(var(--tabbar-h)+2.5rem)]">
      <div className="mx-auto flex max-w-[26rem] items-center gap-3 rounded-full bg-surface-darker py-2 pr-2 pl-4 text-white shadow-pop">
        <p role="status" className="min-w-0 flex-1 truncate text-sm font-medium">
          {message}
        </p>
        <Button variant="brand" size="sm" className="shrink-0" onClick={onAction}>
          {actionLabel}
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- empty states */

export function EmptyState({
  icon: Icon,
  message,
  hint,
  action,
}: {
  icon?: LucideIcon
  message: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <Card className="flex flex-col items-center gap-2 px-5 py-10 text-center">
      {Icon && <Icon size={28} strokeWidth={1.75} className="text-muted" aria-hidden />}
      <p className="font-semibold text-ink">{message}</p>
      {hint && <p className="max-w-xs text-sm text-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </Card>
  )
}
