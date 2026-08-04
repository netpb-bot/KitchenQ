import type { ComponentProps, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/* ------------------------------------------------------------------ layout */

/** Page frame: sticky header, scrolling body, clearance for the tab bar. */
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
    <div className="min-h-svh pb-28">
      <header className="sticky top-0 z-10 bg-page/95 px-5 pt-[env(safe-area-inset-top)] backdrop-blur">
        {lead}
        <div className="flex items-end justify-between gap-3 pt-4 pb-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
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

/* ----------------------------------------------------------------- surfaces */

export function Card({
  className = '',
  ...props
}: ComponentProps<'div'>) {
  return (
    <div
      className={`rounded-2xl bg-surface p-4 shadow-card ${className}`}
      {...props}
    />
  )
}

/** Dark hero surface — session header, player card. Carries white text. */
export function DarkCard({
  className = '',
  ...props
}: ComponentProps<'div'>) {
  return (
    <div
      className={`rounded-2xl bg-surface-dark p-4 text-white ${className}`}
      {...props}
    />
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

export function Button({
  variant = 'primary',
  icon: Icon,
  full,
  className = '',
  children,
  ...props
}: ComponentProps<'button'> & {
  variant?: keyof typeof BUTTON_VARIANTS
  icon?: LucideIcon
  full?: boolean
}) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40 ${BUTTON_VARIANTS[variant]} ${full ? 'w-full' : ''} ${className}`}
      {...props}
    >
      {Icon && <Icon size={18} strokeWidth={2.25} aria-hidden />}
      {children}
    </button>
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
  children,
}: {
  tone?: keyof typeof PILL_TONES
  /** Leading status dot, as on the LIVE badge. */
  dot?: boolean
  children: ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${PILL_TONES[tone]}`}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  )
}

/* -------------------------------------------------------------------- stats */

/** Icon + number + caption, as in the session header strip. */
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
  'w-full rounded-xl border border-hairline bg-surface px-3.5 text-base text-ink placeholder:text-muted focus:border-primary focus:outline-none'

export function Input({ className = '', ...props }: ComponentProps<'input'>) {
  return <input className={`${CONTROL} ${className}`} {...props} />
}

export function Select({ className = '', ...props }: ComponentProps<'select'>) {
  return <select className={`${CONTROL} ${className}`} {...props} />
}

/* ---------------------------------------------------------------- feedback */

/** Inline error, for a failed load or a rejected write. */
export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <Card className="border border-danger-tint">
      <p className="break-words text-sm font-medium text-danger">{children}</p>
    </Card>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <p className="py-8 text-center text-sm text-muted">{label}</p>
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
