import { useEffect, useMemo, useState } from 'react'
import {
  Minus,
  Play,
  Plus,
  Shuffle,
  Timer,
  Undo2,
  UserMinus,
  UserPlus,
} from 'lucide-react'
import {
  TIER_LABEL,
  addPlayer,
  cancelMatch,
  isGuest,
  setCourtCount,
  setPlayerStatus,
  startMatch,
  useAction,
  type Match,
  type Member,
  type Session,
  type SessionPlayer,
  type Tier,
} from '../lib/db'
import { pickNextMatch, queueOrder, type Lineup, type QueuePlayer } from '../lib/queue'
import { AddGuestForm } from './AddGuestForm'
import { Avatar, TierBadge } from './Avatar'
import { CourtDiagram } from './CourtDiagram'
import { ScoreEntry } from './ScoreEntry'
import {
  Button,
  Card,
  ConfirmButton,
  EmptyState,
  Eyebrow,
  Pill,
  SectionHeading,
  UndoBar,
} from './ui'

export type LiveData = {
  session: Session
  me: Member | null
  players: SessionPlayer[]
  matches: Match[]
  clubMembers: Member[]
}

export function LiveSession({
  data,
  admin,
  reload,
}: {
  data: LiveData
  admin: boolean
  reload: () => void
}) {
  const { session, me, players, matches } = data
  const [adding, setAdding] = useState(false)

  const names = useMemo(
    () => new Map(players.map((p) => [p.club_members.id, p.club_members.display_name])),
    [players],
  )

  // Kept beside `names` rather than folded into it: ScoreEntry takes the name
  // map as-is, and only the court diagram needs the tier.
  const tiers = useMemo(
    () => new Map(players.map((p) => [p.club_members.id, p.club_members.skill_tier])),
    [players],
  )

  const waiting: QueuePlayer[] = useMemo(
    () =>
      players
        .filter((p) => p.status === 'waiting')
        .map((p) => ({
          memberId: p.club_members.id,
          name: p.club_members.display_name,
          tier: p.club_members.skill_tier,
          queuedAt: new Date(p.queued_at).getTime(),
          gamesPlayed: p.games_played,
        })),
    [players],
  )

  const live = useMemo(() => matches.filter((m) => !m.ended_at), [matches])
  const finished = useMemo(() => matches.filter((m) => m.ended_at), [matches])

  // Empty courts are filled in order, each suggestion excluding the players the
  // previous suggestion already claimed — otherwise two free courts propose the
  // same four people.
  //
  // Memoised because each open court enumerates a few hundred candidate
  // lineups, and the match timers re-render this component every second.
  const suggestions = useMemo(() => {
    const out = new Map<number, Lineup>()
    const claimed = new Set<string>()
    const history = finished.map((m) => ({ teamA: m.team_a_ids, teamB: m.team_b_ids }))
    for (let court = 1; court <= session.court_count; court++) {
      if (live.some((m) => m.court_number === court)) continue
      const available = waiting.filter((p) => !claimed.has(p.memberId))
      const lineup = pickNextMatch(available, history)
      if (!lineup) break
      out.set(court, lineup)
      ;[...lineup.teamA, ...lineup.teamB].forEach((id) => claimed.add(id))
    }
    return out
  }, [session.court_count, live, finished, waiting])

  return (
    <>
      <SectionHeading action={admin && <CourtCount session={session} live={live} reload={reload} />}>
        Courts
      </SectionHeading>
      <div className="kq-stagger space-y-3">
        {Array.from({ length: session.court_count }, (_, i) => i + 1).map((court) => {
          const match = live.find((m) => m.court_number === court)
          return match ? (
            <LiveCourt
              key={court}
              match={match}
              names={names}
              tiers={tiers}
              session={session}
              admin={admin}
              reload={reload}
            />
          ) : (
            <OpenCourt
              key={court}
              court={court}
              session={session}
              admin={admin}
              suggestion={suggestions.get(court) ?? null}
              waiting={waiting}
              claimedElsewhere={claimedByOtherCourts(suggestions, court)}
              reload={reload}
            />
          )
        })}
      </div>

      <Queue
        players={players}
        me={me}
        admin={admin}
        adding={adding}
        onToggleAdd={() => setAdding((open) => !open)}
        reload={reload}
      />

      {admin && adding && (
        <AddPlayer data={data} reload={reload} onDone={() => setAdding(false)} />
      )}
    </>
  )
}

/**
 * Players spoken for by a *different* open court. This court's own picks are
 * excluded deliberately: swapping someone out of the lineup has to put them
 * back on the bench, or the host can't undo the swap.
 */
function claimedByOtherCourts(
  suggestions: Map<number, Lineup>,
  court: number,
): Set<string> {
  const claimed = new Set<string>()
  for (const [other, lineup] of suggestions) {
    if (other === court) continue
    for (const id of [...lineup.teamA, ...lineup.teamB]) claimed.add(id)
  }
  return claimed
}

/**
 * Courts open and close mid-session — a group leaves, the club hands over a
 * spare. Removing one is refused server-side while a match is on it, so this
 * hides the control rather than offering an action that will be rejected.
 */
function CourtCount({
  session,
  live,
  reload,
}: {
  session: Session
  live: Match[]
  reload: () => void
}) {
  const [busy, error, run] = useAction()
  const highest = live.reduce((max, m) => Math.max(max, m.court_number), 0)

  const set = (count: number) =>
    run(async () => {
      await setCourtCount(session.id, count)
      reload()
    })

  return (
    <div className="flex items-center gap-1.5">
      {error && <span className="text-xs font-medium text-danger">{error}</span>}
      <Button
        variant="secondary"
        size="sm"
        icon={Minus}
        aria-label="Remove a court"
        className="px-2"
        disabled={busy || session.court_count <= 1 || session.court_count <= highest}
        onClick={() => set(session.court_count - 1)}
      />
      <Button
        variant="secondary"
        size="sm"
        icon={Plus}
        className="px-3"
        disabled={busy || session.court_count >= 12}
        onClick={() => set(session.court_count + 1)}
      >
        Court
      </Button>
    </div>
  )
}

/* -------------------------------------------------------------- live court */

/** Court number and elapsed time, the pair that heads every court card. */
function CourtLabel({ court, children }: { court: number; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Eyebrow>Court {court}</Eyebrow>
      {children}
    </div>
  )
}

function LiveCourt({
  match,
  names,
  tiers,
  session,
  admin,
  reload,
}: {
  match: Match
  names: Map<string, string>
  tiers: Map<string, Tier>
  session: Session
  admin: boolean
  reload: () => void
}) {
  const [scoring, setScoring] = useState(false)
  const onCourt = (id: string) => ({ name: names.get(id) ?? 'Unknown', tier: tiers.get(id) })
  // The host always scores; players only when the session says they may.
  const canScore = admin || session.allow_player_scoring

  return (
    <Card className="ring-1 ring-brand/25">
      <div className="flex items-center justify-between gap-3">
        <CourtLabel court={match.court_number}>
          <MatchTimer since={match.started_at} />
        </CourtLabel>
        <Pill tone="live" dot>
          LIVE
        </Pill>
      </div>

      <div className="mt-3">
        <CourtDiagram
          teamA={match.team_a_ids.map(onCourt)}
          teamB={match.team_b_ids.map(onCourt)}
        />
      </div>

      {canScore &&
        (scoring ? (
          <ScoreEntry
            match={match}
            session={session}
            names={names}
            onCancel={() => setScoring(false)}
            onSaved={reload}
          />
        ) : (
          <>
            <Button full className="mt-3" onClick={() => setScoring(true)}>
              End match · enter score
            </Button>
            {admin && (
              <div className="mt-2 flex justify-center">
                <CancelMatchButton matchId={match.id} reload={reload} />
              </div>
            )}
          </>
        ))}
    </Card>
  )
}

function CancelMatchButton({ matchId, reload }: { matchId: string; reload: () => void }) {
  const [busy, error, run] = useAction()
  return (
    <ConfirmButton
      variant="ghost"
      size="sm"
      icon={Undo2}
      label="Cancel match · undo start"
      confirmLabel="Put everyone back in the queue?"
      busy={busy}
      error={error}
      onConfirm={() =>
        run(async () => {
          await cancelMatch(matchId)
          reload()
        })
      }
    />
  )
}

/* -------------------------------------------------------------- open court */

function OpenCourt({
  court,
  session,
  admin,
  suggestion,
  waiting,
  claimedElsewhere,
  reload,
}: {
  court: number
  session: Session
  admin: boolean
  suggestion: Lineup | null
  waiting: QueuePlayer[]
  claimedElsewhere: Set<string>
  reload: () => void
}) {
  // The host's edits to the suggested lineup, kept until the match starts.
  const [override, setOverride] = useState<string[] | null>(null)
  const [slot, setSlot] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const suggested = suggestion
    ? [...suggestion.teamA, ...suggestion.teamB]
    : null
  const lineup = override ?? suggested

  // A player picked up by another court, or who left the queue, invalidates the
  // host's pending edit rather than starting a match that will be rejected.
  useEffect(() => {
    if (!override) return
    const stillWaiting = new Set(waiting.map((p) => p.memberId))
    if (!override.every((id) => stillWaiting.has(id))) setOverride(null)
  }, [waiting, override])

  // Players see the same card shape as a live court, so the screen keeps its
  // rhythm instead of collapsing to a single line of text between matches.
  if (!admin || !lineup) {
    return (
      <Card>
        <div className="flex items-center justify-between gap-3">
          <CourtLabel court={court} />
          <Pill tone="neutral">Open</Pill>
        </div>
        <div className="mt-3">
          <CourtDiagram teamA={[]} teamB={[]} muted />
        </div>
        <p className="mt-3 text-center text-sm text-muted">
          {session.status !== 'live'
            ? 'Start the session to put a match on court.'
            : admin
              ? 'Four players need to be in the queue before a match can start.'
              : 'Waiting on the next match.'}
        </p>
      </Card>
    )
  }

  const byId = new Map(waiting.map((p) => [p.memberId, p]))
  const bench = waiting.filter(
    (p) => !lineup.includes(p.memberId) && !claimedElsewhere.has(p.memberId),
  )

  function swapPartners() {
    // A 3-cycle through every way to pair the same four players: repeated taps
    // reach all three pairings and come back, rather than toggling between two.
    const [w, x, y, z] = lineup!
    setOverride([w, z, x, y])
    setSlot(null)
  }

  function substitute(memberId: string) {
    if (slot === null) return
    const next = [...lineup!]
    next[slot] = memberId
    setOverride(next)
    setSlot(null)
  }

  async function start() {
    setBusy(true)
    setError('')
    try {
      await startMatch(session.id, court, lineup!.slice(0, 2), lineup!.slice(2, 4))
      setOverride(null)
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setBusy(false)
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <CourtLabel court={court} />
        <Pill tone="neutral">Next up</Pill>
      </div>

      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <TeamSlots ids={lineup.slice(0, 2)} offset={0} byId={byId} slot={slot} onPick={setSlot} />
        <span className="text-xs font-bold text-muted">vs</span>
        <TeamSlots ids={lineup.slice(2, 4)} offset={2} byId={byId} slot={slot} onPick={setSlot} />
      </div>

      {slot !== null && (
        <div className="kq-rise mt-3 rounded-xl bg-tint p-3">
          <p className="text-sm font-semibold text-ink">
            {bench.length > 0 ? 'Swap in a player from the queue' : 'Nobody else is waiting'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {bench.map((p) => (
              <button
                key={p.memberId}
                onClick={() => substitute(p.memberId)}
                className="kq-chip inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-sm font-semibold text-ink transition-transform active:scale-95"
              >
                <Avatar name={p.name} size="sm" />
                {p.name}
              </button>
            ))}
            <button
              onClick={() => setSlot(null)}
              className="kq-chip rounded-full px-3 py-1.5 text-sm font-semibold text-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm font-medium text-danger">{error}</p>}

      <div className="mt-3 flex gap-2">
        <Button icon={Play} full loading={busy} onClick={() => void start()}>
          Start match
        </Button>
        <Button variant="secondary" icon={Shuffle} onClick={swapPartners} className="px-3">
          Swap
        </Button>
      </div>
    </Card>
  )
}

function TeamSlots({
  ids,
  offset,
  byId,
  slot,
  onPick,
}: {
  ids: string[]
  offset: number
  byId: Map<string, QueuePlayer>
  slot: number | null
  onPick: (slot: number | null) => void
}) {
  return (
    <div className="space-y-2">
      {ids.map((id, i) => {
        const index = offset + i
        const player = byId.get(id)
        const selected = slot === index
        return (
          <button
            key={id}
            onClick={() => onPick(selected ? null : index)}
            className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors ${selected ? 'bg-tint ring-2 ring-primary' : 'hover:bg-tint/50'}`}
          >
            <Avatar
              name={player?.name ?? '?'}
              size="sm"
              badge={player && <TierBadge tier={player.tier} />}
            />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
              {player?.name ?? 'Unknown'}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------------------- queue */

function Queue({
  players,
  me,
  admin,
  adding,
  onToggleAdd,
  reload,
}: {
  players: SessionPlayer[]
  me: Member | null
  admin: boolean
  adding: boolean
  onToggleAdd: () => void
  reload: () => void
}) {
  const [removed, setRemoved] = useState<{ id: string; name: string } | null>(null)
  const waiting = players.filter((p) => p.status === 'waiting')
  const resting = players.filter((p) => p.status === 'resting')
  const playing = players.filter((p) => p.status === 'playing')

  const order = queueOrder(
    waiting.map((p) => ({
      memberId: p.id, // ordering only — the session_player id is enough here
      name: p.club_members.display_name,
      tier: p.club_members.skill_tier,
      queuedAt: new Date(p.queued_at).getTime(),
      gamesPlayed: p.games_played,
    })),
  )
  const byId = new Map(waiting.map((p) => [p.id, p]))
  const mine = players.find((p) => p.club_members.id === me?.id && p.status !== 'left')

  return (
    <>
      <SectionHeading
        action={
          admin && (
            <Button
              variant="secondary"
              size="sm"
              icon={UserPlus}
              aria-expanded={adding}
              onClick={onToggleAdd}
            >
              {adding ? 'Done' : 'Player'}
            </Button>
          )
        }
      >
        Queue{waiting.length > 0 && ` · ${waiting.length} waiting`}
      </SectionHeading>

      {/* Own status and own actions in one place. Without this the only way to
          sit out was to find yourself in a list of twenty. */}
      {mine && <SelfStatus player={mine} position={order.findIndex((e) => e.memberId === mine.id) + 1} reload={reload} />}

      {waiting.length === 0 ? (
        <EmptyState
          message={
            playing.length > 0 ? 'Everyone is on court.' : 'Nobody is in the queue yet.'
          }
          hint={playing.length > 0 ? undefined : 'Share the join code to fill it.'}
        />
      ) : (
        <Card className="divide-y divide-hairline p-0">
          {order.map((entry, index) => {
            // queueOrder is built from the same list as byId, so a miss cannot
            // happen today — but a bare `!` here would take the whole live
            // screen down mid-session if that ever stopped being true.
            const player = byId.get(entry.memberId)
            if (!player) return null
            return (
              <PlayerRow
                key={player.id}
                player={player}
                position={index + 1}
                isMe={player.club_members.id === me?.id}
                admin={admin}
                onRemoved={setRemoved}
                reload={reload}
              />
            )
          })}
        </Card>
      )}

      {resting.length > 0 && (
        <>
          <SectionHeading>Sitting out · {resting.length}</SectionHeading>
          <Card className="divide-y divide-hairline p-0">
            {resting.map((player) => (
              <PlayerRow
                key={player.id}
                player={player}
                isMe={player.club_members.id === me?.id}
                admin={admin}
                onRemoved={setRemoved}
                reload={reload}
              />
            ))}
          </Card>
        </>
      )}

      {removed && (
        <UndoBar
          message={`${removed.name} removed`}
          onDismiss={() => setRemoved(null)}
          onAction={() => {
            const { id } = removed
            setRemoved(null)
            void setPlayerStatus(id, 'waiting').then(reload)
          }}
        />
      )}
    </>
  )
}

/** Where you are in the queue, and the only two things you can do about it. */
function SelfStatus({
  player,
  position,
  reload,
}: {
  player: SessionPlayer
  position: number
  reload: () => void
}) {
  const [busy, error, run] = useAction()
  const move = (status: SessionPlayer['status']) =>
    run(async () => {
      await setPlayerStatus(player.id, status)
      reload()
    })

  const waiting = player.status === 'waiting'

  return (
    <div className="mb-3 rounded-2xl bg-tint px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 text-sm font-semibold text-primary">
          {player.status === 'playing'
            ? "You're on court"
            : waiting
              ? `You're ${ordinal(position)} in the queue`
              : "You're sitting out"}
        </p>
        {waiting && (
          <Button variant="ghost" size="sm" loading={busy} onClick={() => move('resting')}>
            Sit out
          </Button>
        )}
        {player.status === 'resting' && (
          <>
            <Button variant="primary" size="sm" loading={busy} onClick={() => move('waiting')}>
              I'm back
            </Button>
            <ConfirmButton
              variant="ghost"
              size="sm"
              label="Leave"
              confirmLabel="Leave for the night?"
              busy={busy}
              onConfirm={() => move('left')}
            />
          </>
        )}
      </div>
      {error && <p className="mt-1 text-xs font-medium text-danger">{error}</p>}
    </div>
  )
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
  return `${n}${suffix}`
}

function PlayerRow({
  player,
  position,
  isMe,
  admin,
  onRemoved,
  reload,
}: {
  player: SessionPlayer
  position?: number
  isMe: boolean
  admin: boolean
  onRemoved: (removed: { id: string; name: string }) => void
  reload: () => void
}) {
  const [busy, error, run] = useAction()
  const name = player.club_members.display_name

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      {position !== undefined && (
        <span className="tnum w-5 shrink-0 text-sm font-bold text-muted">{position}</span>
      )}
      <Avatar name={name} badge={<TierBadge tier={player.club_members.skill_tier} />} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-ink">
          {name}
          {isMe && <span className="ml-1.5 text-sm font-medium text-muted">(you)</span>}
        </p>
        <p className="tnum mt-0.5 text-xs text-muted">
          {player.games_played} {player.games_played === 1 ? 'game' : 'games'} ·{' '}
          {TIER_LABEL[player.club_members.skill_tier]}
        </p>
      </div>

      {/* A guest has no phone, so the host does everything for them. */}
      {isGuest(player.club_members) && <Pill tone="neutral">Guest</Pill>}

      {admin && !isMe && player.status !== 'left' && (
        <ConfirmButton
          variant="ghost"
          size="sm"
          icon={UserMinus}
          label=""
          ariaLabel={`Remove ${name}`}
          confirmLabel={`Remove ${name}?`}
          busy={busy}
          error={error}
          className="px-2"
          onConfirm={() =>
            run(async () => {
              await setPlayerStatus(player.id, 'left')
              onRemoved({ id: player.id, name })
              reload()
            })
          }
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------- add players */

function AddPlayer({
  data,
  reload,
  onDone,
}: {
  data: LiveData
  reload: () => void
  onDone: () => void
}) {
  const [busy, error, run] = useAction()
  const inSession = new Set(
    data.players.filter((p) => p.status !== 'left').map((p) => p.club_members.id),
  )
  const absent = data.clubMembers.filter((m) => !inSession.has(m.id))

  return (
    <Card className="kq-rise mt-3">
      {absent.length > 0 && (
        <>
          <Eyebrow>Already in the club</Eyebrow>
          <p className="mt-1 text-sm text-muted">
            Here tonight, but haven't joined on their own phone.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {absent.map((member) => (
              <button
                key={member.id}
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await addPlayer(data.session.id, member.id)
                    reload()
                  })
                }
                className="kq-chip inline-flex items-center gap-2 rounded-full bg-tint px-3 py-1.5 text-sm font-semibold text-primary transition-transform active:scale-95 disabled:opacity-40"
              >
                <Plus size={14} strokeWidth={2.5} aria-hidden />
                {member.display_name}
              </button>
            ))}
          </div>
          {error && <p className="mt-2 text-sm font-medium text-danger">{error}</p>}
          <hr className="my-4 border-hairline" />
        </>
      )}

      <Eyebrow>Someone new, without a phone</Eyebrow>
      <p className="mt-1 mb-3 text-sm text-muted">
        They queue and get scored like everyone else. They can take over this name
        later with the join code.
      </p>
      <AddGuestForm
        clubId={data.session.club_id}
        submitLabel="Add to queue"
        onAdded={async (guest) => {
          await addPlayer(data.session.id, guest.id)
          reload()
        }}
      />
      <Button variant="ghost" full className="mt-2" onClick={onDone}>
        Done adding
      </Button>
    </Card>
  )
}

/* -------------------------------------------------------------------- timer */

/**
 * Wall-clock elapsed time as mm:ss, ticking once a second.
 *
 * A component of its own rather than a hook in LiveCourt, because the tick is
 * a state change and state changes re-render the component that owns them. Held
 * one level up it redrew the court diagram — a fifteen-node SVG — once a second
 * per court, all night, on the one screen that is never closed.
 */
function MatchTimer({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const seconds = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000))
  const mm = Math.floor(seconds / 60)
  const ss = seconds % 60

  return (
    <span className="tnum inline-flex items-center gap-1 rounded-full bg-tint px-2 py-0.5 text-xs font-bold text-primary">
      <Timer size={12} strokeWidth={2.5} aria-hidden />
      {mm}:{String(ss).padStart(2, '0')}
    </span>
  )
}
