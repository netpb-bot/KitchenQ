import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, KeyRound, Plus, Users } from 'lucide-react'
import { createClub, lastName, listClubs, useAsync } from '../lib/db'
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Loading,
  Screen,
  SectionHeading,
} from '../components/ui'

export function Clubs() {
  const [clubs, reload] = useAsync(listClubs, [])
  const [creating, setCreating] = useState(false)

  return (
    <Screen
      title="Clubs"
      subtitle="Your clubs and their members."
      action={
        !creating && (
          <Button variant="secondary" icon={Plus} onClick={() => setCreating(true)}>
            New
          </Button>
        )
      }
    >
      {creating && (
        <div className="mt-2">
          <CreateClubForm
            onCancel={() => setCreating(false)}
            onCreated={() => {
              setCreating(false)
              reload()
            }}
          />
        </div>
      )}

      <SectionHeading>Your clubs</SectionHeading>
      {clubs.loading ? (
        <Loading />
      ) : clubs.error ? (
        <ErrorNote>{clubs.error}</ErrorNote>
      ) : clubs.data!.length === 0 ? (
        <EmptyState
          icon={Users}
          message="You're not in a club yet."
          hint="Create one to manage members, sessions, and dues — or join a session with a code and you'll be added to its club automatically."
          action={
            !creating && (
              <Button icon={Plus} onClick={() => setCreating(true)}>
                Create a club
              </Button>
            )
          }
        />
      ) : (
        <div className="space-y-3">
          {clubs.data!.map((club) => (
            <Link key={club.id} to={`/clubs/${club.id}`} className="block">
              <Card className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-tint text-primary">
                  <Users size={20} strokeWidth={2.25} aria-hidden />
                </span>
                <span className="min-w-0 flex-1 font-semibold text-ink">{club.name}</span>
                <ChevronRight size={20} className="text-muted" aria-hidden />
              </Card>
            </Link>
          ))}
        </div>
      )}

      <SectionHeading>Playing tonight somewhere else?</SectionHeading>
      <Card className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-tint text-primary">
          <KeyRound size={20} strokeWidth={2.25} aria-hidden />
        </span>
        <p className="min-w-0 flex-1 text-sm text-muted">
          A join code gets you into a session and its club in one step.
        </p>
        <Link to="/join">
          <Button variant="secondary">Join</Button>
        </Link>
      </Card>
    </Screen>
  )
}

function CreateClubForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void
  onCreated: () => void
}) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [ownerName, setOwnerName] = useState(lastName.get())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const clubId = await createClub(name, ownerName)
      lastName.set(ownerName)
      onCreated()
      navigate(`/clubs/${clubId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Club name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="DEPC"
            autoFocus
            required
            maxLength={60}
          />
        </Field>
        <Field label="Your name" hint="How you'll show up on the queue and standings.">
          <Input
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            required
            maxLength={40}
          />
        </Field>
        {error && <p className="text-sm font-medium text-danger">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || !name.trim() || !ownerName.trim()} full>
            {busy ? 'Creating…' : 'Create club'}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  )
}
