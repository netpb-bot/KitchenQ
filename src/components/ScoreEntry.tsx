import { useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { correctMatch, endMatch, type Match, type Session } from '../lib/db'
import { Avatar } from './Avatar'
import { Button } from './ui'

/**
 * Score entry: type the number, or tap it up. Both affordances sit in one row —
 * typing "11" beats eleven taps, but the steppers still win for the last point
 * when this is filled in one-handed, standing on a court.
 *
 * `scoreError` mirrors the database's `check_score` so an illegal score is caught
 * before the round-trip. The database is still the authority — it also knows who
 * is host and whether the match already finished — and its rejection still shows.
 */
export function ScoreEntry({
  match,
  session,
  names,
  mode = 'end',
  onCancel,
  onSaved,
}: {
  match: Match
  session: Session
  names: Map<string, string>
  /** `end` finishes a live match; `correct` rewrites a finished one. */
  mode?: 'end' | 'correct'
  onCancel: () => void
  onSaved: () => void
}) {
  // Strings, not numbers: a field has to be able to be empty mid-typing.
  const [a, setA] = useState(String(match.score_a ?? 0))
  const [b, setB] = useState(String(match.score_b ?? 0))
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const bRef = useRef<HTMLInputElement>(null)

  const numA = num(a)
  const numB = num(b)
  const invalid = scoreError(session.target_score, session.win_by, numA, numB)

  function change(set: (v: string) => void) {
    return (v: string) => {
      setTouched(true)
      set(v)
    }
  }

  async function save() {
    if (invalid) return
    setBusy(true)
    setError('')
    try {
      if (mode === 'correct') await correctMatch(match.id, numA, numB)
      else await endMatch(match.id, numA, numB)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      className="mt-3 border-t border-hairline pt-3"
    >
      <div className="grid grid-cols-2 gap-3">
        <Side
          ids={match.team_a_ids}
          names={names}
          score={a}
          onChange={change(setA)}
          leading={numA > numB}
          autoFocus
          // Typing a score that has reached the target means this side is done;
          // move on rather than making the player aim at the other field.
          onReachedTarget={() => bRef.current?.focus()}
          target={session.target_score}
        />
        <Side
          ids={match.team_b_ids}
          names={names}
          score={b}
          onChange={change(setB)}
          leading={numB > numA}
          inputRef={bRef}
          target={session.target_score}
        />
      </div>

      {touched && invalid ? (
        <p className="mt-3 text-center text-meta font-medium text-danger">{invalid}</p>
      ) : (
        <p className="mt-3 text-center text-meta text-muted">
          First to {session.target_score}, win by {session.win_by}.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-meta font-medium text-danger">
          {error}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <Button type="submit" full loading={busy} disabled={!!invalid}>
          {mode === 'correct' ? 'Save correction' : 'Save score'}
        </Button>
        {/* "Cancel", not "Back" — every other inline form in the app says
            Cancel, and this one dismisses rather than navigating. */}
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/** `''` when the score is legal. Rule-for-rule the same as `check_score`. */
export function scoreError(target: number, winBy: number, a: number, b: number): string {
  const winner = Math.max(a, b)
  const loser = Math.min(a, b)
  if (loser < 0) return 'Enter both scores.'
  if (winner < target) return `The winner must reach ${target}.`
  if (winner - loser < winBy) return `The winner must win by ${winBy}.`
  // Past the target the game ends the moment the lead reaches win_by, so any
  // larger margin means the score was mistyped.
  if (winner > target && winner - loser !== winBy)
    return `Past ${target}, the game ends as soon as the lead reaches ${winBy}.`
  return ''
}

/** Empty reads as invalid, not as zero, so a blank field cannot be saved. */
function num(s: string): number {
  return s === '' ? -1 : Number(s)
}

function Side({
  ids,
  names,
  score,
  onChange,
  leading,
  target,
  autoFocus,
  inputRef,
  onReachedTarget,
}: {
  ids: string[]
  names: Map<string, string>
  score: string
  onChange: (v: string) => void
  leading: boolean
  target: number
  autoFocus?: boolean
  inputRef?: React.RefObject<HTMLInputElement | null>
  onReachedTarget?: () => void
}) {
  const who = ids.map((id) => names.get(id) ?? 'Unknown')
  const label = who.map(firstName).join(' and ')
  const n = num(score)

  // The leader is ringed rather than tinted: muted text on tint is only 4.48:1.
  return (
    <div
      className={`rounded-xl bg-page p-2 text-center ${leading ? 'ring-2 ring-brand' : ''}`}
    >
      <div className="flex items-center justify-center gap-1">
        {who.map((name, i) => (
          <Avatar key={ids[i]} name={name} size="sm" />
        ))}
      </div>
      {/* Weight as well as the ring: colour alone cannot be what says who is
          ahead (WCAG 1.4.1). Same treatment MatchRow gives a winner. */}
      <p
        className={`mt-1 truncate text-meta ${leading ? 'font-semibold text-ink' : 'text-muted'}`}
      >
        {who.map(firstName).join(' & ')}
      </p>

      <div className="mt-1 flex items-center justify-between gap-1">
        <Stepper
          label={`Subtract a point from ${label}`}
          icon={Minus}
          disabled={n <= 0}
          onClick={() => onChange(String(Math.max(0, n - 1)))}
        />
        {/* A bare input, not the `Input` primitive: those are always w-full by
            design and would blow out this row. `type="text"` + inputMode gives
            the numeric keypad without desktop spinners or accepting "e"/"-". */}
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          enterKeyHint="done"
          maxLength={2}
          aria-label={`Score for ${label}`}
          value={score}
          autoFocus={autoFocus}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '')
            onChange(v)
            if (v !== '' && Number(v) >= target) onReachedTarget?.()
          }}
          className="tnum w-12 min-w-0 rounded-lg bg-transparent text-center text-display font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-brand"
        />
        <Stepper
          label={`Add a point for ${label}`}
          icon={Plus}
          onClick={() => onChange(String(Math.max(0, n) + 1))}
        />
      </div>
    </div>
  )
}

function Stepper({
  label,
  icon: Icon,
  disabled,
  onClick,
}: {
  label: string
  icon: typeof Plus
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      // Same rule as Button: at zero, "subtract a point" is unavailable, not a
      // 30%-strength green. Swapped rather than layered, for the same ordering
      // reason.
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
        disabled ? 'bg-fill text-muted' : 'bg-surface text-primary shadow-card'
      }`}
    >
      <Icon size={20} strokeWidth={2.5} aria-hidden />
    </button>
  )
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}
