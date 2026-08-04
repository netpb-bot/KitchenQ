import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { correctMatch, endMatch, type Match, type Session } from '../lib/db'
import { Avatar } from './Avatar'
import { Button } from './ui'

/**
 * Tap-based score entry. Steppers rather than a number field: this is filled in
 * one-handed, standing on a court, and a phone keyboard covers the screen.
 *
 * The rules (reach the target, win by the margin) are NOT re-implemented here.
 * The database is the only place that decides whether a score is legal, so the
 * Save button always submits and a rejection comes back as its message.
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
  const [a, setA] = useState(match.score_a ?? 0)
  const [b, setB] = useState(match.score_b ?? 0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setBusy(true)
    setError('')
    try {
      if (mode === 'correct') await correctMatch(match.id, a, b)
      else await endMatch(match.id, a, b)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 border-t border-hairline pt-3">
      <div className="grid grid-cols-2 gap-3">
        <Side ids={match.team_a_ids} names={names} score={a} onChange={setA} leading={a > b} />
        <Side ids={match.team_b_ids} names={names} score={b} onChange={setB} leading={b > a} />
      </div>

      <p className="mt-3 text-center text-xs text-muted">
        First to {session.target_score}, win by {session.win_by}.
      </p>
      {error && <p className="mt-2 text-sm font-medium text-danger">{error}</p>}

      <div className="mt-3 flex gap-2">
        <Button full disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : mode === 'correct' ? 'Save correction' : 'Save score'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Back
        </Button>
      </div>
    </div>
  )
}

function Side({
  ids,
  names,
  score,
  onChange,
  leading,
}: {
  ids: string[]
  names: Map<string, string>
  score: number
  onChange: (n: number) => void
  leading: boolean
}) {
  const who = ids.map((id) => names.get(id) ?? 'Unknown')

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
      <p className="mt-1 truncate text-xs font-medium text-muted">
        {who.map(firstName).join(' & ')}
      </p>

      <div className="mt-1 flex items-center justify-between gap-1">
        <Stepper
          label={`Subtract a point from ${who.map(firstName).join(' and ')}`}
          icon={Minus}
          disabled={score === 0}
          onClick={() => onChange(Math.max(0, score - 1))}
        />
        <span className="tnum min-w-10 text-3xl font-bold text-ink">{score}</span>
        <Stepper
          label={`Add a point for ${who.map(firstName).join(' and ')}`}
          icon={Plus}
          onClick={() => onChange(score + 1)}
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
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface text-primary shadow-card disabled:opacity-30"
    >
      <Icon size={20} strokeWidth={2.5} aria-hidden />
    </button>
  )
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}
