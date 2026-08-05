import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ChevronDown, Loader2, Search, X } from 'lucide-react'

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
  tabs,
  sticky = true,
  children,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  /** Rendered above the title, inside the header — e.g. a back button row. */
  lead?: ReactNode
  /** Rendered below the title, inside the header, so it stays pinned on scroll. */
  tabs?: ReactNode
  /**
   * Pin the header on scroll. On by default: most screens keep a back link, a
   * header action or tabs up there. Off for a screen whose header is only a
   * title — pinning a sentence costs a third of a phone viewport and pins
   * nothing anyone can act on.
   */
  sticky?: boolean
  children: ReactNode
}) {
  return (
    <div className="mx-auto min-h-svh w-full max-w-[30rem] bg-page pb-[calc(var(--tabbar-h)+4.5rem)] md:shadow-lift">
      {/* Opaque first, translucent only where backdrop-filter actually works.
          Without the fallback the 90% page colour lets headings scroll through
          the header as sliced glyphs on every engine that lacks the filter.
          Both are dead weight when the header scrolls away with the content. */}
      <header
        className={`bg-page px-5 pt-[env(safe-area-inset-top)] ${
          sticky ? 'sticky top-0 z-10 backdrop-blur-xl supports-[backdrop-filter]:bg-page/90' : ''
        }`}
      >
        {lead}
        <div className={`flex items-end justify-between gap-3 pt-5 ${tabs ? 'pb-3' : 'pb-4'}`}>
          <div className="min-w-0">
            <h1 className="text-display font-bold text-balance text-ink">{title}</h1>
            {subtitle && <p className="mt-1 text-meta text-muted">{subtitle}</p>}
          </div>
          {action}
        </div>
        {tabs}
      </header>
      {/* Tabbed screens drop the leading SectionHeading — it only repeated the
          tab label — so the top gap lives here instead of on each tab's body. */}
      <main className={`px-5 ${tabs ? 'pt-4' : ''}`}>{children}</main>
    </div>
  )
}

/**
 * In-page segmented navigation. One list on screen at a time beats four stacked
 * lists of the same twenty-eight people.
 *
 * Full 44px targets, not `.kq-chip`: this is primary navigation, not a secondary
 * action sitting beside a real button.
 */
export function Tabs<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (value: T) => void
  options: ReadonlyArray<{ value: T; label: string; count?: number }>
  /** Names the group for screen readers — "Club sections", "Payment status". */
  label: string
}) {
  return (
    // Bled to the screen edge so the last tab can scroll fully into view on a
    // narrow phone instead of being clipped by the page gutter.
    <div
      role="tablist"
      aria-label={label}
      className="-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 text-meta font-semibold transition-colors ${
              selected ? 'bg-primary text-white' : 'bg-fill text-ink'
            }`}
          >
            {option.label}
            {option.count !== undefined && (
              <span className={`tnum ${selected ? 'text-white/70' : 'text-muted'}`}>
                {option.count}
              </span>
            )}
          </button>
        )
      })}
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
    <div className="mt-9 mb-3 flex items-center justify-between gap-3">
      <h2 className="text-title font-semibold text-ink">{children}</h2>
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
    <p className={`text-caption font-semibold uppercase text-muted ${className}`}>{children}</p>
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
      // The hairline edge lives inside --shadow-card, not in a ring here: a
      // ring set on the component wins against whatever the caller passes,
      // because Tailwind orders colour utilities alphabetically rather than by
      // class order. Callers wanting a coloured edge pass their own `ring-1
      // ring-<colour>` and it composes on top.
      className={`rounded-card bg-surface p-4 shadow-card ${
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
 * Near-black rather than the old olive: one dark block at the top of a screen
 * anchors the hierarchy, and it is the only place the green accent gets to be
 * loud. A green block under a green button was two things competing.
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
      // shadow-pop, not shadow-lift: lift carries the light hairline, which on
      // a near-black card reads as a stray outline.
      className={`relative overflow-hidden rounded-card bg-surface-dark p-5 text-white shadow-pop ${className}`}
      {...props}
    >
      {Mark && (
        <Mark
          size={150}
          strokeWidth={1.25}
          aria-hidden
          className="pointer-events-none absolute -right-6 -bottom-8 text-white/[0.06]"
        />
      )}
      <div className="relative">{children}</div>
    </div>
  )
}

/* ----------------------------------------------------------------- controls */

// One meaning each — the table in theme.ts is the contract these implement.
const BUTTON_VARIANTS = {
  // `primary` (not `brand`) because this carries a white label — see theme.ts.
  primary: 'bg-primary text-white hover:bg-primary/90',
  // `brand` is the bright yellow-green, so the label must be ink.
  brand: 'bg-brand text-ink hover:bg-brand/90',
  // A positive action at low weight, for the one that repeats down a list.
  // Filled green in every fee row stopped reading as an action at all.
  positive: 'bg-tint text-primary hover:bg-primary/[0.14]',
  // Neutral, not tinted: `secondary` sits beside `primary` constantly, and two
  // greens next to each other made neither of them read as the action.
  secondary: 'bg-fill text-ink hover:bg-fill-strong',
  ghost: 'bg-transparent text-muted hover:bg-fill',
  danger: 'bg-danger text-white hover:bg-danger/90',
  // Destructive, said in red from the first paint, but without the filled block:
  // remove-player repeats on every row of the roster, and a red column is its
  // own kind of noise. Filled `danger` stays for the screen-wide ones.
  dangerQuiet: 'bg-transparent text-danger hover:bg-danger-tint',
  // Over a DarkCard, `secondary` and `ghost` are ink on near-black. These are
  // their counterparts — theme.test.ts fails the build if the light ones are
  // used inside a DarkCard again.
  secondaryOnDark: 'bg-fill-on-dark text-white hover:bg-fill-on-dark-strong',
  ghostOnDark: 'bg-transparent text-white/70 hover:bg-fill-on-dark',
} as const

// `sm` opts out of the global 44px floor via .kq-chip. Only ever for a
// secondary action that sits beside a full-size one — never a lone control.
const BUTTON_SIZES = {
  sm: 'kq-chip gap-1.5 px-3 text-meta',
  md: 'min-w-11 gap-2 px-5 text-body',
} as const

/**
 * Unavailable is its own state, not a faded copy of the action.
 *
 * This was `disabled:opacity-40` over whatever the variant painted, which meant
 * a not-yet-fillable "Join session" was still green — the colour that says go —
 * with its white label at 1.8:1 on the faded fill, illegible on a phone held up
 * outdoors. Neutral fill, muted label, full opacity: it reads as "not yet", at
 * 5.2:1, and it reads.
 *
 * Variants with no fill of their own have no hue to mislead with, so they keep
 * the fade — and their disabled moments last as long as one write.
 */
const DISABLED = 'bg-fill text-muted shadow-none'
const BARE_VARIANTS = new Set(['ghost', 'ghostOnDark', 'dangerQuiet'])

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
  // Loading keeps its colour: the action is under way, not unavailable, and a
  // button that greys out the instant you press it reads as having failed.
  const inactive = disabled && !loading
  const paint =
    inactive && !BARE_VARIANTS.has(variant) ? DISABLED : BUTTON_VARIANTS[variant]
  return (
    <button
      // min-w matters for the icon-only buttons: at `px-3` with no label they
      // come out 42px wide, two short of a usable target on a court.
      // Swapped rather than layered: Tailwind orders same-property colour
      // utilities alphabetically, so a `disabled:bg-*` cannot be relied on to
      // beat the variant's own fill — see the note on --shadow-card.
      className={`inline-flex items-center justify-center rounded-full font-semibold transition-all active:scale-95 disabled:pointer-events-none ${inactive && BARE_VARIANTS.has(variant) ? 'opacity-40' : ''} ${BUTTON_SIZES[size]} ${paint} ${full ? 'w-full' : ''} ${className}`}
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
  confirmVariant = 'danger',
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
  /**
   * The armed step. Red by default because two taps usually means destructive —
   * but not always: a bulk write that a snackbar can put back is not a deletion,
   * and colouring it red would put red back to meaning two things.
   */
  confirmVariant?: keyof typeof BUTTON_VARIANTS
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
          variant={confirmVariant}
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
      {error && <p className="mt-1 text-meta font-medium text-danger">{error}</p>}
    </div>
  )
}

// A finished state is `neutral` or `good` — never `warn`, whichever way it went.
// `warn` is for something still open: partial, not started, owing.
const PILL_TONES = {
  neutral: 'bg-fill text-ink',
  good: 'bg-tint text-primary',
  live: 'bg-brand text-ink',
  warn: 'bg-warn-tint text-warn',
  onDark: 'bg-fill-on-dark text-white',
  // The amber for a dark card. `warn`'s own tint is a pale chip that reads as a
  // hole punched in a near-black surface.
  warnOnDark: 'bg-warn-fill/20 text-warn-fill',
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
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-semibold uppercase ${PILL_TONES[tone]} ${className}`}
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
    <div className="flex flex-col items-center gap-1.5">
      <Icon
        size={16}
        strokeWidth={2}
        className={onDark ? 'text-white/55' : 'text-muted'}
        aria-hidden
      />
      <span
        className={`tnum text-title font-semibold leading-none ${onDark ? 'text-white' : 'text-ink'}`}
      >
        {value}
      </span>
      <span
        className={`text-caption font-medium uppercase ${onDark ? 'text-white/55' : 'text-muted'}`}
      >
        {label}
      </span>
    </div>
  )
}

// No `danger` tone: a headline number is a fact, and money still outstanding is
// unresolved rather than wrong. Nothing on a stat card has ever been an error.
const STAT_TONES = {
  default: 'text-ink',
  good: 'text-primary',
  warn: 'text-warn',
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
    <div className="flex flex-col items-center gap-1 rounded-card bg-surface px-2 py-3.5 shadow-card">
      {Icon && <Icon size={15} strokeWidth={2} className="text-muted" aria-hidden />}
      <span className={`tnum text-title font-semibold leading-none ${STAT_TONES[tone]}`}>
        {value}
      </span>
      <span className="text-caption font-medium uppercase text-muted">{label}</span>
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
      <span className="text-caption font-semibold uppercase text-muted">{label}</span>
      {hint && <span className="mt-1 block text-meta text-muted">{hint}</span>}
      <span className="mt-2 block">{children}</span>
    </label>
  )
}

// Controls always fill their container. Passing a `w-*` class will NOT narrow
// them — Tailwind resolves conflicting width utilities by stylesheet order, not
// by the order of the class attribute, so `w-full` wins. To size a control,
// wrap it in a sized element instead.
// `text-base` (16px) is not a style choice: iOS Safari zooms the viewport on
// focus for anything smaller. Do not drop it to the 15px body step.
const CONTROL =
  'w-full rounded-xl border border-hairline bg-surface px-3.5 text-base text-ink transition-colors placeholder:text-muted focus:border-primary focus:outline-none'

export function Input({ className = '', ...props }: ComponentProps<'input'>) {
  return <input className={`${CONTROL} ${className}`} {...props} />
}

export function Select({ className = '', ...props }: ComponentProps<'select'>) {
  return <select className={`${CONTROL} ${className}`} {...props} />
}

/**
 * Type-to-filter over a list of names. `type="search"` for the native clear
 * affordance and the right keyboard — a custom X button would be a third thing
 * to style for what the platform already ships.
 */
export function SearchField({
  value,
  onChange,
  placeholder = 'Search',
  label,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** The list being filtered — "Search members", read out instead of the glyph. */
  label: string
}) {
  return (
    <div className="relative">
      <Search
        size={17}
        strokeWidth={2}
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted"
      />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-10"
      />
    </div>
  )
}

/* --------------------------------------------------------------- long lists */

/**
 * First `cap` rows, plus a way to see the rest. Twenty-eight members is a normal
 * club night and every list in this app used to render all of them.
 *
 * No "show less": nobody re-collapses a list they deliberately opened, and the
 * control costs a row on every screen to serve that nobody.
 */
export function useShowAll<T>(rows: T[], cap: number): [T[], (() => void) | null] {
  const [all, setAll] = useState(false)
  if (all || rows.length <= cap) return [rows, null]
  return [rows.slice(0, cap), () => setAll(true)]
}

/** The footer row for a `useShowAll` list. `count` is the true total, not the remainder. */
export function ShowAllRow({
  count,
  noun,
  onClick,
}: {
  count: number
  /** Completes "Show all N ___" — "members", "waiting", "matches". */
  noun: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-center gap-1.5 px-4 py-3 text-meta font-semibold text-primary transition-colors hover:bg-fill"
    >
      Show all {count} {noun}
      <ChevronDown size={15} strokeWidth={2.5} aria-hidden />
    </button>
  )
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
    <Card className="bg-danger-tint ring-1 ring-danger/20">
      <p role="alert" className="break-words text-body font-medium text-danger">
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
    <p role="status" className="flex items-center justify-center gap-2 py-10 text-meta text-muted">
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
        <p role="status" className="min-w-0 flex-1 truncate text-meta font-medium">
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
    <Card className="flex flex-col items-center gap-2 px-5 py-12 text-center">
      {Icon && <Icon size={26} strokeWidth={1.5} className="text-muted/70" aria-hidden />}
      <p className="text-body font-medium text-ink">{message}</p>
      {hint && <p className="max-w-xs text-meta text-muted">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </Card>
  )
}
