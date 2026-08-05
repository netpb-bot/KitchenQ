import { useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import {
  claimMember,
  ensureSession,
  findSessionByCode,
  isGuest,
  joinSession,
  lastName,
  listMembers,
  normalizeName,
  useAsync,
  type Member,
} from '../lib/db'
import { Button, Card, Field, Input, Screen } from '../components/ui'

/**
 * A guest nobody has taken over yet: a member row with no auth user behind it.
 *
 * `role` matters as much as `user_id`. A club_members.user_id also goes null when
 * an auth user is deleted (on delete set null), so an orphaned owner or co-host
 * row would otherwise look exactly like a guest and be claimable into its role.
 * claim_member refuses that server-side; this keeps the screen from offering it.
 */
export function isUnclaimedGuest(member: Member): boolean {
  return isGuest(member) && member.role === 'member'
}

/**
 * What a typed name means in this club, given a roster with the caller's own row
 * already removed. Names are unique per club, so a name that is already there is
 * one of two opposite things and they need opposite advice:
 *
 * - `claimable` — an unclaimed guest holds it, and this is probably the record
 *   the host has been keeping for the person now typing. Offer the takeover.
 * - `taken` — somebody with their own login holds it, or it is a row nobody may
 *   claim. There is nothing to take over; they need a different name.
 *
 * Pure so the branch guarding an irreversible takeover can be tested directly.
 */
export function checkName(
  members: Member[],
  typed: string,
): { kind: 'free' } | { kind: 'claimable'; guest: Member } | { kind: 'taken' } {
  const wanted = normalizeName(typed)
  if (!wanted) return { kind: 'free' }

  const holder = members.find((m) => normalizeName(m.display_name) === wanted)
  if (!holder) return { kind: 'free' }
  return isUnclaimedGuest(holder) ? { kind: 'claimable', guest: holder } : { kind: 'taken' }
}

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
  // Claiming is irreversible and takes someone's whole record with it, so every
  // route to it goes through this one confirmation rather than firing on a tap.
  const [pending, setPending] = useState<Member | null>(null)
  const nameField = useRef<HTMLInputElement>(null)

  const complete = code.trim().length === 6

  // Only worth fetching once the code is complete — before that there's no club
  // to look anyone up in. The whole roster, not just the guests: the claim chips
  // need the unclaimed ones, and the name check needs everybody.
  const [roster] = useAsync<Member[]>(async () => {
    if (!complete) return []
    const userId = await ensureSession()
    const session = await findSessionByCode(code)
    if (!session) return []
    const members = await listMembers(session.club_id)
    // Somebody who already belongs to this club must not be blocked by their own
    // name. join_session keeps their existing row and ignores what they typed.
    return members.filter((m) => m.user_id !== userId)
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

  /**
   * The other Mike's way out. Names are unique per club, so he cannot join as
   * plain "Mike" — the trailing space puts the cursor exactly where the initial
   * goes, which turns "pick a different name" into typing one character.
   *
   * Backing out of a chip tapped by mistake is the same button but not the same
   * situation: there is no name to disambiguate, so leave what they typed alone.
   */
  function beSomeoneElse() {
    const sameName = !pending || normalizeName(pending.display_name) === normalizeName(name)
    setPending(null)
    if (sameName) setName((typed) => `${typed.trim()} `)
    nameField.current?.focus()
  }

  const members = roster.data ?? []
  const candidates = members.filter(isUnclaimedGuest)

  const check = checkName(members, name)
  const mine = check.kind === 'claimable' ? check.guest : null
  const takenByOther = check.kind === 'taken'

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
              //
              // The placeholder drops the weight and the letter-spacing. At
              // display size, centred, semibold and tracked out, "ABC123" was
              // indistinguishable from a code someone had actually typed — so
              // the disabled Join button looked broken rather than waiting.
              // Contrast stays where it was; the visible label carries the
              // meaning either way.
              className={`tnum text-center text-display font-semibold tracking-[0.28em] placeholder:font-normal placeholder:tracking-normal ${
                complete ? 'kq-pop border-primary bg-tint' : ''
              }`}
            />
          </Field>

          {/* Worth saying out loud: silently showing nothing here is how a
              returning player ends up as a second member with an empty record. */}
          {complete && roster.loading && (
            <p className="text-meta text-muted" role="status">
              Checking this club for your name…
            </p>
          )}
          {roster.error && (
            <p className="text-meta font-medium text-danger" role="alert">
              Couldn't check whether the host already has you on the roster. Joining
              with your name below still works — tell the host so they can merge you.
            </p>
          )}

          {candidates.length > 0 && (
            <div className="rounded-xl bg-tint p-3">
              <p className="text-body font-medium text-ink">Already play here?</p>
              <p className="mt-0.5 text-meta text-muted">
                Tap your name to take over the record the host has been keeping for you.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {candidates.map((guest) => (
                  <button
                    key={guest.id}
                    type="button"
                    disabled={busy}
                    onClick={() => setPending(guest)}
                    className={`kq-chip inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-meta font-medium text-ink transition-transform active:scale-95 disabled:opacity-40 ${
                      guest.id === mine?.id
                        ? 'kq-pop bg-surface ring-2 ring-primary'
                        : 'bg-surface'
                    }`}
                  >
                    <Avatar name={guest.display_name} size="sm" />
                    {guest.display_name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Sits between the two things that open it — the chips above and the
              same-name prompt below — so it cannot appear off-screen.

              Claiming moves a real person's history and debts onto whoever taps,
              and the app has no way to tell two people of one name apart. So it
              says what is about to happen and waits for a second, named tap. */}
          {pending && (
            <div className="kq-rise space-y-2 rounded-xl bg-tint p-3" role="alert">
              <p className="text-body font-medium text-ink">
                Take over {pending.display_name}'s record?
              </p>
              <p className="text-meta text-muted">
                Their match history, standings and anything they still owe the club
                become yours. Only do this if that record is you.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button loading={busy} onClick={() => claim(pending)}>
                  Yes, that's my record
                </Button>
                <Button variant="ghost" disabled={busy} onClick={beSomeoneElse}>
                  No, I'm someone else
                </Button>
              </div>
            </div>
          )}

          <Field
            label={candidates.length > 0 ? 'Or join as someone new' : 'Your name'}
            hint="Shown on the queue, the courts and the standings."
          >
            <Input
              ref={nameField}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoFocus={Boolean(code) && !name}
              maxLength={40}
              aria-invalid={Boolean(mine) || takenByOther || undefined}
              required
            />
          </Field>

          {/* Three states, because "that name is taken" is the wrong thing to
              say to the person the host has been keeping the record for. */}
          {/* Two people called Mike is the case this whole screen has to get
              right. Both readings of a matching name are offered as equal, named
              actions: pushing one of them — a highlighted chip and a button
              reading "tap your name above" — is how the wrong Mike ends up
              holding the right Mike's unpaid fees. */}
          {mine && !pending ? (
            <div className="kq-rise space-y-2 rounded-xl bg-tint px-3 py-2.5">
              <p className="text-meta text-ink">
                The host already keeps a record for{' '}
                <span className="font-semibold">{mine.display_name}</span>. Names have
                to be unique here, so this one is either yours to take over or
                somebody else's.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" disabled={busy} onClick={() => setPending(mine)}>
                  That's my record
                </Button>
                <Button variant="ghost" disabled={busy} onClick={beSomeoneElse}>
                  I'm a different {mine.display_name}
                </Button>
              </div>
            </div>
          ) : takenByOther ? (
            // Already claimed by somebody with a phone, so there is no record
            // here to take over — only a name to distinguish yourself from.
            <div className="kq-rise space-y-2 rounded-xl bg-tint px-3 py-2.5" role="alert">
              <p className="text-meta font-medium text-danger">
                Someone here already uses that name.
              </p>
              <Button variant="secondary" disabled={busy} onClick={beSomeoneElse}>
                Add a last initial
              </Button>
            </div>
          ) : (
            name.trim() && (
              <div className="kq-rise flex items-center gap-3 rounded-xl bg-tint px-3 py-2.5">
                <Avatar name={name.trim()} />
                <p className="text-meta text-ink">
                  Joining as <span className="font-semibold">{name.trim()}</span>
                </p>
              </div>
            )
          )}

          {error && <p className="text-meta font-medium text-danger">{error}</p>}

          <Button
            type="submit"
            full
            loading={busy}
            disabled={!complete || !name.trim() || Boolean(mine) || takenByOther}
          >
            Join session
          </Button>
        </form>
      </Card>
    </Screen>
  )
}
