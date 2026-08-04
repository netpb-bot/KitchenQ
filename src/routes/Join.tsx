import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import {
  claimMember,
  findSessionByCode,
  joinSession,
  lastName,
  listUnclaimedGuests,
  useAsync,
  type Member,
} from '../lib/db'
import { Button, Card, Field, Input, Screen } from '../components/ui'

/**
 * Code, then name, then in. A player who has never opened the app before signs
 * in anonymously and becomes a club member in the same call — see join_session.
 *
 * If the host has already been queueing them as a guest, they take over that
 * row instead of creating a second one, and keep their record.
 */
export function Join() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [code, setCode] = useState((params.get('code') ?? '').toUpperCase())
  const [name, setName] = useState(lastName.get())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const complete = code.trim().length === 6

  // Guests are only worth fetching once the code is complete — before that
  // there's no club to look them up in.
  const [guests] = useAsync<Member[]>(async () => {
    if (!complete) return []
    const session = await findSessionByCode(code)
    if (!session) return []
    return listUnclaimedGuests(session.club_id)
  }, [complete ? code.trim().toUpperCase() : ''])

  async function enter(action: () => Promise<string>, playerName: string) {
    setBusy(true)
    setError('')
    try {
      const sessionId = await action()
      lastName.set(playerName)
      navigate(`/session/${sessionId}`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    void enter(() => joinSession(code, name), name)
  }

  /** Take over the guest row the host has been using, then enter the session. */
  function claim(guest: Member) {
    void enter(async () => {
      await claimMember(code, guest.id)
      return joinSession(code, guest.display_name)
    }, guest.display_name)
  }

  const candidates = guests.data ?? []

  return (
    <Screen title="Join a session" subtitle="Ask the host for tonight's code.">
      <Card className="mt-2">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Join code">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
              autoFocus={!code}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={6}
              required
              // Pops once the sixth character lands, so a code typed while
              // walking in gets an acknowledgement without a status line.
              className={`tnum text-center text-2xl font-bold tracking-[0.3em] ${
                complete ? 'kq-pop border-primary bg-tint' : ''
              }`}
            />
          </Field>

          {/* Worth saying out loud: silently showing nothing here is how a
              returning player ends up as a second member with an empty record. */}
          {complete && guests.loading && (
            <p className="text-sm text-muted" role="status">
              Checking this club for your name…
            </p>
          )}
          {guests.error && (
            <p className="text-sm font-medium text-warn" role="alert">
              Couldn't check whether the host already has you on the roster. Joining
              with your name below still works — tell the host so they can merge you.
            </p>
          )}

          {candidates.length > 0 && (
            <div className="rounded-xl bg-tint p-3">
              <p className="text-sm font-semibold text-ink">Already play here?</p>
              <p className="mt-0.5 text-xs text-muted">
                Tap your name to take over the record the host has been keeping for you.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {candidates.map((guest) => (
                  <button
                    key={guest.id}
                    type="button"
                    disabled={busy}
                    onClick={() => claim(guest)}
                    className="kq-chip inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-sm font-semibold text-ink transition-transform active:scale-95 disabled:opacity-40"
                  >
                    <Avatar name={guest.display_name} size="sm" />
                    {guest.display_name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Field
            label={candidates.length > 0 ? 'Or join as someone new' : 'Your name'}
            hint="Shown on the queue, the courts and the standings."
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoFocus={Boolean(code) && !name}
              maxLength={40}
              required
            />
          </Field>

          {name.trim() && (
            <div className="kq-rise flex items-center gap-3 rounded-xl bg-tint px-3 py-2.5">
              <Avatar name={name.trim()} />
              <p className="text-sm text-ink">
                Joining as <span className="font-semibold">{name.trim()}</span>
              </p>
            </div>
          )}

          {error && <p className="text-sm font-medium text-danger">{error}</p>}

          <Button type="submit" full loading={busy} disabled={!complete || !name.trim()}>
            Join session
          </Button>
        </form>
      </Card>
    </Screen>
  )
}
