import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { TIERS, createGuest, type Member, type Tier } from '../lib/db'
import { Button, Field, Input, Select } from './ui'

export const TIER_LABEL: Record<Tier, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
}

/**
 * Types in a player who has no phone. Used both mid-session and from the club
 * directory, so the caller decides what happens next with the new member.
 *
 * The field clears and re-focuses after each add — four people walking in
 * together is the normal case, not the exception.
 */
export function AddGuestForm({
  clubId,
  onAdded,
  submitLabel = 'Add',
}: {
  clubId: string
  onAdded: (guest: Member) => Promise<void> | void
  submitLabel?: string
}) {
  const [name, setName] = useState('')
  const [tier, setTier] = useState<Tier>('intermediate')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const field = useRef<HTMLInputElement>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const guest = await createGuest(clubId, name, tier)
      await onAdded(guest)
      setName('')
      field.current?.focus()
    } catch (err) {
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
      {error && <p className="text-sm font-medium text-danger">{error}</p>}
      <Button type="submit" icon={Plus} full disabled={busy || !name.trim()}>
        {busy ? 'Adding…' : submitLabel}
      </Button>
    </form>
  )
}
