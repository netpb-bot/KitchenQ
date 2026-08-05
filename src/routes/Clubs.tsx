import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronRight, KeyRound, Plus, Users } from 'lucide-react'
import { createClub, lastName, listClubs, useAsync } from '../lib/db'
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Eyebrow,
  Field,
  Input,
  Loading,
  Screen,
} from '../components/ui'

export function Clubs() {
  const navigate = useNavigate()
  const [clubs, reload] = useAsync(listClubs, [])
  const [params, setParams] = useSearchParams()
  // Home's "Host a session" links here with ?new=1 when you have no clubs. It
  // already says "create a club first", so it opens the form rather than
  // landing you on a screen where you have to go find the button.
  const [creating, setCreating] = useState(params.get('new') === '1')
  const empty = clubs.data?.length === 0

  return (
    <Screen
      title="Clubs"
      subtitle="Find your crew, or start your own."
      action={
        // Hidden while the empty state carries the action: the same job offered
        // twice on one short screen reads as two different offers.
        !creating &&
        !empty && (
          <Button variant="secondary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
            New
          </Button>
        )
      }
    >
      {creating && (
        <div className="kq-rise mt-2">
          <CreateClubForm
            onCancel={() => {
              setCreating(false)
              setParams({}, { replace: true })
            }}
            onCreated={() => {
              setCreating(false)
              reload()
            }}
          />
        </div>
      )}

      {/* An empty state whose whole job is "make a club" has nothing left to say
          once the form is open above it — and it would be a second Create button
          on screen. It comes back if you cancel. */}
      {!(empty && creating) && (
        <>
          <Eyebrow className="mt-6 mb-2">Your clubs</Eyebrow>
          {clubs.loading ? (
            <Loading />
          ) : clubs.error ? (
            <ErrorNote onRetry={reload}>{clubs.error}</ErrorNote>
          ) : empty ? (
            // The header chip steps aside for this one (see `action` above), so
            // the screen's only club-making control is the one you are already
            // looking at. The hint no longer sells the join code either — that
            // offer has its own card below, and saying it twice sold neither.
            <EmptyState
              icon={Users}
              message="You're not in a club yet."
              hint="A club is where your members, sessions and dues live."
              action={
                <Button icon={Plus} onClick={() => setCreating(true)}>
                  Create a club
                </Button>
              }
            />
          ) : (
            <div className="kq-stagger space-y-3">
              {clubs.data!.map((club) => (
                <Link key={club.id} to={`/clubs/${club.id}`} className="block">
                  <Card interactive className="flex items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-fill text-ink">
                      <Users size={20} strokeWidth={2.25} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 text-body font-medium text-ink">
                      {club.name}
                    </span>
                    <ChevronRight size={20} className="text-muted" aria-hidden />
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      {/* "Somewhere else" presumes a club you already play at. With none, this
          is most people's actual first move, not a footnote. */}
      <Eyebrow className="mt-7 mb-2">
        {empty ? 'Been invited to a session?' : 'Playing somewhere else tonight?'}
      </Eyebrow>
      <Card className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-fill text-ink">
          <KeyRound size={20} strokeWidth={2.25} aria-hidden />
        </span>
        <p className="min-w-0 flex-1 text-meta text-muted">
          A join code gets you into a session and its club in one step.
        </p>
        {/* Not a <Link> wrapping a <Button>: nesting them is invalid, and a
            screen reader announces a link containing a button. */}
        <Button variant="secondary" size="sm" onClick={() => navigate('/join')}>
          Enter code
        </Button>
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
        {error && <p className="text-meta font-medium text-danger">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" loading={busy} disabled={!name.trim() || !ownerName.trim()} full>
            Create club
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  )
}
