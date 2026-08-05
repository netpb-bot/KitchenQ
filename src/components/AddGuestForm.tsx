import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import {
  TIERS,
  TIER_LABEL,
  createGuest,
  nameTaken,
  normalizeName,
  type Member,
  type Tier,
} from '../lib/db'
import { Button, Field, Input, Select } from './ui'

/**
 * Types in a player who has no phone. Used both mid-session and from the club
 * directory, so the caller decides what happens next with the new member.
 *
 * The field clears and re-focuses after each add — four people walking in
 * together is the normal case, not the exception.
 *
 * That same convenience is why names are checked here: the host adding walk-ins
 * back to back is exactly who types a name the club already has. The check runs
 * against `taken` and against the guests added in this sitting, because
 * `onAdded` reloads the roster asynchronously and the field is ready for the
 * next name long before that lands. Neither is authoritative —
 * club_members_unique_name is — but reaching the database with a duplicate
 * should be the rare path, not the normal one.
 */
export function AddGuestForm({
  clubId,
  taken,
  onAdded,
  onDuplicate,
  submitLabel = 'Add',
}: {
  clubId: string
  /** Everyone already in the club. The whole roster — never a filtered view. */
  taken: Member[]
  onAdded: (guest: Member) => Promise<void> | void
  /** Offers a way out of the collision, given the member already holding the name. */
  onDuplicate?: (existing: Member) => React.ReactNode
  submitLabel?: string
}) {
  const [name, setName] = useState('')
  const [tier, setTier] = useState<Tier>('intermediate')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [justAdded, setJustAdded] = useState<Member[]>([])
  const field = useRef<HTMLInputElement>(null)

  const known = [...taken, ...justAdded]
  const clash = nameTaken(known.map((m) => m.display_name), name)
    ? known.find((m) => normalizeName(m.display_name) === normalizeName(name))
    : undefined

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (clash) return
    setBusy(true)
    setError('')
    try {
      const guest = await createGuest(clubId, name, tier)
      setJustAdded((added) => [...added, guest])
      await onAdded(guest)
      setName('')
      field.current?.focus()
    } catch (err) {
      // The name stays in the field. If this was a duplicate the roster had not
      // caught up with, retyping it is the wrong thing to ask for.
      setError(err instanceof Error ? err.message : String(err))
    }
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Name">
        <Input
          ref={field}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Player's name"
          maxLength={40}
          aria-invalid={clash ? true : undefined}
          required
        />
      </Field>
      <Field label="Skill level">
        <Select value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {TIER_LABEL[t]}
            </option>
          ))}
        </Select>
      </Field>
      {clash && (
        <div className="space-y-2" role="alert">
          <p className="text-meta font-medium text-danger">
            {clash.display_name} is already in this club — add a last initial so the
            courts can tell them apart.
          </p>
          {onDuplicate?.(clash)}
        </div>
      )}
      {error && !clash && (
        <p className="text-meta font-medium text-danger" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" icon={Plus} full loading={busy} disabled={!name.trim() || Boolean(clash)}>
        {submitLabel}
      </Button>
    </form>
  )
}
