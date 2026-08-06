import { useEffect, useMemo, useState } from 'react'
import {
  Flag,
  Handshake,
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
  requestPair,
  respondPair,
  setCourtCount,
  setPlayerStatus,
  startMatch,
  useAction,
  type Match,
  type Member,
  type PairRequest,
  type Session,
  type SessionPlayer,
  type SessionStatus,
  type Tier,
} from '../lib/db'
import {
  applyPairs,
  courtFreeAt,
  forecast,
  queueOrder,
  typicalMatchMs,
  type Lineup,
  type QueuePlayer,
  type Upcoming,
} from '../lib/queue'
import { AddGuestForm } from './AddGuestForm'
import { isUnreachable } from './ConnectionBanner'
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
  SearchField,
  SectionHeading,
  ShowAllRow,
  UndoBar,
  useShowAll,
} from './ui'

export type LiveData = {
  session: Session
  me: Member | null
  players: SessionPlayer[]
  matches: Match[]
  clubMembers: Member[]
  /** Open asks and live pairings. Answered ones are not fetched. */
  pairRequests: PairRequest[]
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
  const { session, me, players, matches, pairRequests } = data
  const [adding, setAdding] = useState(false)

  const accepted = useMemo(
    () =>
      pairRequests
        .filter((r) => r.status === 'accepted')
        .map((r): [string, string] => [r.from_member, r.to_member]),
    [pairRequests],
  )

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

  // The one list every position, forecast and lineup on this screen is derived
  // from — including the queue list itself, which used to build its own and so
  // could disagree with the courts above it about who was where.
  const waiting: QueuePlayer[] = useMemo(
    () =>
      applyPairs(
        players
          .filter((p) => p.status === 'waiting')
          .map((p) => ({
            memberId: p.club_members.id,
            name: p.club_members.display_name,
            tier: p.club_members.skill_tier,
            queuedAt: new Date(p.queued_at).getTime(),
            gamesPlayed: p.games_played,
          })),
        accepted,
      ),
    [players, accepted],
  )

  const live = useMemo(() => matches.filter((m) => !m.ended_at), [matches])
  const finished = useMemo(() => matches.filter((m) => m.ended_at), [matches])

  // Minutes, not seconds — this drives wait estimates, which are rounded to the
  // minute and built on a median. A faster tick would only animate noise.
  const now = useNow(30_000)
  const typicalMs = useMemo(() => typicalMatchMs(matches), [matches])

  // Who plays next on every court, free or not, each lineup excluding the
  // players an earlier one already claimed — otherwise two courts propose the
  // same four people.
  //
  // Memoised because each court enumerates a few hundred candidate lineups.
  const plan = useMemo(() => {
    const history = finished.map((m) => ({ teamA: m.team_a_ids, teamB: m.team_b_ids }))
    const courts = Array.from({ length: session.court_count }, (_, i) => {
      const match = live.find((m) => m.court_number === i + 1)
      return {
        court: i + 1,
        freeAt: match
          ? courtFreeAt(new Date(match.started_at).getTime(), typicalMs, now)
          : now,
      }
    })
    return forecast(waiting, courts, history, typicalMs)
  }, [session.court_count, live, finished, waiting, typicalMs, now])

  // A forecast for a court that is still playing is a guess; only a court
  // standing empty gets to offer a startable lineup.
  const suggestions = useMemo(
    () =>
      new Map(
        plan.courts.filter((c) => c.freeAt <= now).map((c) => [c.court, c.lineup]),
      ),
    [plan, now],
  )

  // "You're 3rd" is the answer to a question nobody actually asked; "you're on
  // in about ten minutes" is. One label per waiting player, keyed by member id.
  const waits = useMemo(() => {
    const out = new Map<string, string>()
    for (const [id, at] of plan.onCourtAt) out.set(id, waitLabel(at, now))
    for (const court of plan.courts) {
      if (court.freeAt > now) continue
      for (const id of everyone(court.lineup)) out.set(id, 'up next')
    }
    return out
  }, [plan, now])

  // "Where am I in the queue" is the only question most players open this screen
  // to answer, and it used to sit below every court card — four large cards of
  // scrolling on a busy night. It leads the screen now.
  const mine = players.find((p) => p.club_members.id === me?.id && p.status !== 'left')
  const myPosition = mine
    ? queueOrder(waiting).findIndex((e) => e.memberId === mine.club_members.id) + 1
    : 0
  const myNext = me
    ? (plan.courts.find((c) => everyone(c.lineup).includes(me.id)) ?? null)
    : null

  const myPair = useMemo(
    () =>
      pairRequests.find(
        (r) =>
          r.status === 'accepted' && (r.from_member === me?.id || r.to_member === me?.id),
      ) ?? null,
    [pairRequests, me],
  )

  return (
    <>
      {mine && (
        <SelfStatus
          player={mine}
          position={myPosition}
          status={session.status}
          upNext={myNext}
          onCourtAt={(me && plan.onCourtAt.get(me.id)) ?? null}
          now={now}
          names={names}
          pair={myPair}
          reload={reload}
        />
      )}

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
              meId={me?.id ?? null}
              upNext={plan.courts.find((c) => c.court === court) ?? null}
              waiting={waiting}
              now={now}
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
        order={waiting}
        me={me}
        admin={admin}
        adding={adding}
        waits={waits}
        sessionId={session.id}
        requests={pairRequests}
        // You have to be in the queue yourself to ask, and one arrangement at a
        // time. Both are refused server-side too; hiding the control just saves
        // everyone the error.
        canAsk={
          session.status === 'live' && mine?.status === 'waiting' && myPair === null
        }
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
    for (const id of everyone(lineup)) claimed.add(id)
  }
  return claimed
}

function everyone(lineup: Lineup): string[] {
  return [...lineup.teamA, ...lineup.teamB]
}

/**
 * A clock for wait estimates, ticking far slower than `MatchTimer`.
 *
 * Held by the components that print minutes rather than by the ones that draw
 * courts, for the reason spelled out on MatchTimer: a tick is a state change,
 * and state changes redraw whoever owns them.
 */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/**
 * A wait, in the roundest terms the estimate can honestly support. It is a
 * median match length divided by courts — printing "7 min" would claim a
 * precision that isn't there, and a player who waits nine feels lied to.
 */
export function waitLabel(freeAt: number, now: number): string {
  const minutes = Math.round((freeAt - now) / 60_000)
  return minutes < 2 ? 'any minute' : `~${minutes} min`
}

/** Your partner and who you're up against, from your own side of the net. */
export function matchup(lineup: Lineup, meId: string, names: Map<string, string>): string {
  const withMe = lineup.teamA.includes(meId) ? lineup.teamA : lineup.teamB
  const against = lineup.teamA.includes(meId) ? lineup.teamB : lineup.teamA
  const named = (id: string | undefined) => (id && names.get(id)) || 'a guest'
  return `with ${named(withMe.find((id) => id !== meId))} vs ${named(against[0])} & ${named(against[1])}`
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
      {error && <span className="text-meta font-medium text-danger">{error}</span>}
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
      {/* The card's identifier, so it outweighs the timer chip beside it rather
          than sitting under it as an 11px grey eyebrow. */}
      <h3 className="text-body font-semibold text-ink">Court {court}</h3>
      {children}
    </div>
  )
}

/**
 * Who may end this match. The host always; a player only when the session
 * allows it *and* they are one of the four on this court.
 *
 * "Players can enter their own score" used to be read as "anyone may score", so
 * every player in the session got an End-match button on every court and could
 * finish a game they were nowhere near. Mirrors the gate in `end_match`, which
 * is the one that actually holds — a guest has no account and so ends up on
 * neither side of this, which is why their court stays the host's to score.
 */
export function canEnterScore(
  match: Match,
  session: Session,
  admin: boolean,
  meId: string | null,
): boolean {
  if (admin) return true
  if (!session.allow_player_scoring || !meId) return false
  return match.team_a_ids.includes(meId) || match.team_b_ids.includes(meId)
}

function LiveCourt({
  match,
  names,
  tiers,
  session,
  admin,
  meId,
  upNext,
  waiting,
  now,
  reload,
}: {
  match: Match
  names: Map<string, string>
  tiers: Map<string, Tier>
  session: Session
  admin: boolean
  /** The viewer's club_members.id — the id space the lineup is written in. */
  meId: string | null
  /** Who is forecast onto this court once this match ends. */
  upNext: Upcoming | null
  waiting: QueuePlayer[]
  now: number
  reload: () => void
}) {
  const [scoring, setScoring] = useState(false)
  const onCourt = (id: string) => ({ id, name: names.get(id) ?? 'Unknown', tier: tiers.get(id) })
  const canScore = canEnterScore(match, session, admin, meId)
  const byId = new Map(waiting.map((p) => [p.memberId, p]))

  return (
    <Card className="ring-2 ring-brand/50">
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
          meId={meId}
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
            <Button full icon={Flag} className="mt-4" onClick={() => setScoring(true)}>
              End match · enter score
            </Button>
            {admin && (
              <div className="mt-1 flex justify-center">
                <CancelMatchButton matchId={match.id} reload={reload} />
              </div>
            )}
          </>
        ))}

      {/* On the court card rather than in a section of its own: it is the only
          place the four names reach a guest, who has no phone and never sees
          SelfStatus. Hidden while scoring — that card is a keypad, not a
          notice board. */}
      {upNext && !scoring && (
        <div className="mt-4 border-t border-hairline pt-3">
          <p className="text-caption font-semibold uppercase text-muted">
            Up next here · {waitLabel(upNext.freeAt, now)}
          </p>
          <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <TeamSlots ids={upNext.lineup.teamA} offset={0} byId={byId} slot={null} locked />
            <span className="text-caption font-semibold uppercase text-muted">vs</span>
            <TeamSlots ids={upNext.lineup.teamB} offset={2} byId={byId} slot={null} locked />
          </div>
        </div>
      )}
    </Card>
  )
}

function CancelMatchButton({ matchId, reload }: { matchId: string; reload: () => void }) {
  const [busy, error, run] = useAction()
  return (
    // Grey at rest, not red: undoing a start is a rare escape hatch, and paint
    // it red and it competes with the one action people actually came to tap.
    // The confirm step still arms to `danger` — that is where the weight belongs.
    <ConfirmButton
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

export type CourtState = 'ready' | 'locked' | 'open'

/**
 * What an empty court can offer right now — the one place session status gates
 * play. It used to be gated nowhere on the client: a draft session with four
 * people waiting rendered a full lineup and a live-looking "Start match" that
 * only Postgres could refuse, and the host got `the session is not live`.
 *
 * `locked` still shows the lineup, because seeing who is up next is exactly what
 * a host checks before starting the night. An ended session gets `open` instead
 * — a suggested match for a night that is over is noise.
 *
 * A live session shows the lineup to *everyone*: it used to be host-only, so a
 * player waiting on a free court read "Waiting on the next match" while the
 * host was looking at their name in the lineup. Only the host gets `ready`,
 * which is the state that carries Start and Swap.
 */
export function courtState(
  status: SessionStatus,
  admin: boolean,
  hasLineup: boolean,
): CourtState {
  if (status !== 'live') return status === 'draft' && admin && hasLineup ? 'locked' : 'open'
  if (!hasLineup) return 'open'
  return admin ? 'ready' : 'locked'
}

/**
 * Why a court is sitting empty, in the words of whoever is looking at it. The
 * host gets the action that unblocks them; everyone else gets the reason.
 */
function openCourtReason(status: SessionStatus, admin: boolean): string {
  if (status === 'ended') return 'This session has ended.'
  if (status === 'draft')
    return admin
      ? 'Start the session to put a match on court.'
      : 'Waiting for the host to start.'
  return admin
    ? 'Four players need to be in the queue before a match can start.'
    : 'Waiting on the next match.'
}

/**
 * `start_match` refuses for six reasons and says so in lowercase developer
 * English. The host is standing on a court with fifteen people waiting, so each
 * one becomes a sentence that names what to do about it.
 */
const START_MATCH_ERRORS: Record<string, string> = {
  'the session is not live': "This session hasn't started yet — tap Start session at the top.",
  'a match needs four players': 'Four players need to be in the queue before a match can start.',
  'those players are no longer all in the queue':
    'Someone in this lineup just left the queue. Pick again.',
  'only the host can start a match': 'Only the host can start a match.',
  'a player cannot be on court twice': 'That player is already in this lineup.',
}

function startMatchError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (isUnreachable(raw)) return "Can't reach the club right now — check your connection."
  return START_MATCH_ERRORS[raw.toLowerCase()] ?? raw
}

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

  const state = courtState(session.status, admin, lineup !== null)
  const byId = new Map(waiting.map((p) => [p.memberId, p]))

  // Players see the same card shape as a live court, so the screen keeps its
  // rhythm instead of collapsing to a single line of text between matches.
  if (state === 'open') {
    return (
      <Card>
        <div className="flex items-center justify-between gap-3">
          <CourtLabel court={court} />
          <Pill tone="neutral">{session.status === 'ended' ? 'Ended' : 'Open'}</Pill>
        </div>
        <div className="mt-3">
          <CourtDiagram teamA={[]} teamB={[]} muted />
        </div>
        <p className="mt-3 text-center text-meta text-muted">
          {openCourtReason(session.status, admin)}
        </p>
      </Card>
    )
  }

  // Same card, same lineup, same geometry as the live version — so starting the
  // session changes the pills and reveals the buttons without the courts jumping
  // under the host's thumb.
  // Two ways to be shown a lineup you cannot start: the night hasn't begun, or
  // you aren't the host. Same card, and the pill and footer say which.
  if (state === 'locked') {
    const notStarted = session.status === 'draft'
    return (
      <Card>
        <div className="flex items-center justify-between gap-3">
          <CourtLabel court={court} />
          <Pill tone={notStarted ? 'warn' : 'neutral'}>
            {notStarted ? 'Not started' : 'Next up'}
          </Pill>
        </div>
        {/* Not dimmed: the names are the reason to show this card at all, and
            60% opacity puts them under AA. The pill, the missing buttons and the
            line below carry the state. */}
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <TeamSlots ids={lineup!.slice(0, 2)} offset={0} byId={byId} slot={null} locked />
          <span className="text-caption font-semibold uppercase text-muted">vs</span>
          <TeamSlots ids={lineup!.slice(2, 4)} offset={2} byId={byId} slot={null} locked />
        </div>
        <p className="mt-3 text-center text-meta text-muted">
          {notStarted
            ? 'Tap Start session at the top to put this match on court.'
            : 'Starting as soon as the host taps go.'}
        </p>
      </Card>
    )
  }

  // `state === 'ready'` guarantees a lineup, which the compiler cannot see
  // through courtState() — hence the assertions from here down.
  const bench = waiting.filter(
    (p) => !lineup!.includes(p.memberId) && !claimedElsewhere.has(p.memberId),
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
      setError(startMatchError(err))
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
        <TeamSlots ids={lineup!.slice(0, 2)} offset={0} byId={byId} slot={slot} onPick={setSlot} />
        <span className="text-caption font-semibold uppercase text-muted">vs</span>
        <TeamSlots ids={lineup!.slice(2, 4)} offset={2} byId={byId} slot={slot} onPick={setSlot} />
      </div>

      {slot !== null && (
        <div className="kq-rise mt-3 rounded-xl bg-fill p-3">
          <p className="text-meta font-medium text-ink">
            {bench.length > 0 ? 'Swap in a player from the queue' : 'Nobody else is waiting'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {bench.map((p) => (
              <button
                key={p.memberId}
                onClick={() => substitute(p.memberId)}
                className="kq-chip inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-meta font-medium text-ink transition-transform active:scale-95"
              >
                <Avatar id={p.memberId} name={p.name} size="sm" />
                {p.name}
              </button>
            ))}
            <button
              onClick={() => setSlot(null)}
              className="kq-chip rounded-full px-3 py-1.5 text-meta font-medium text-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-meta font-medium text-danger">{error}</p>}

      <div className="mt-4 flex gap-2">
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
  locked = false,
}: {
  ids: string[]
  offset: number
  byId: Map<string, QueuePlayer>
  slot: number | null
  onPick?: (slot: number | null) => void
  /** Preview only. `disabled` rather than `pointer-events-none`, which would
      leave four dead slots in the tab order. */
  locked?: boolean
}) {
  return (
    // justify-self-center, not the default stretch: the block shrinks to its
    // widest row and centres in its half of the grid, so the air either side of
    // the `vs` column is equal. Flush-left in a wide half put all the space on
    // one side of each name and `vs` read as glued to the right-hand team.
    // The rows keep `w-full` — of the block, so the two avatars stay aligned.
    <div className="justify-self-center space-y-2">
      {ids.map((id, i) => {
        const index = offset + i
        const player = byId.get(id)
        const selected = slot === index
        return (
          <button
            key={id}
            disabled={locked}
            aria-pressed={locked ? undefined : selected}
            onClick={() => onPick?.(selected ? null : index)}
            className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors ${selected ? 'bg-tint ring-2 ring-primary' : locked ? '' : 'hover:bg-fill'}`}
          >
            <Avatar
              id={id}
              name={player?.name ?? '?'}
              size="sm"
              badge={player && <TierBadge tier={player.tier} />}
            />
            <span className="min-w-0 flex-1 truncate text-meta font-medium text-ink">
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
  order: queue,
  me,
  admin,
  adding,
  waits,
  sessionId,
  requests,
  canAsk,
  onToggleAdd,
  reload,
}: {
  players: SessionPlayer[]
  /** The waiting players as the matchmaker sees them, pairings already folded in. */
  order: QueuePlayer[]
  me: Member | null
  admin: boolean
  adding: boolean
  /** Wait label per club_members.id. Missing = nothing worth guessing. */
  waits: Map<string, string>
  sessionId: string
  requests: PairRequest[]
  /** Whether the viewer is in a position to ask anyone at all. */
  canAsk: boolean
  onToggleAdd: () => void
  reload: () => void
}) {
  const [removed, setRemoved] = useState<{ id: string; name: string } | null>(null)
  const waiting = players.filter((p) => p.status === 'waiting')
  const resting = players.filter((p) => p.status === 'resting')
  const playing = players.filter((p) => p.status === 'playing')

  // Ordered by the same list the courts above were filled from, keyed by
  // club_members.id so a pairing means the same thing here as it does there.
  const order = queueOrder(queue)
  const byId = new Map(waiting.map((p) => [p.club_members.id, p]))

  // Who's next is the question this list answers; the twenty-second person in
  // line is not part of the answer. SelfStatus above the courts already reports
  // your own position whether or not your row is on screen.
  const [shownOrder, showAllWaiting] = useShowAll(order, 6)
  const [shownResting, showAllResting] = useShowAll(resting, 3)

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

      {waiting.length === 0 ? (
        <EmptyState
          message={
            playing.length > 0 ? 'Everyone is on court.' : 'Nobody is in the queue yet.'
          }
          hint={playing.length > 0 ? undefined : 'Share the join code to fill it.'}
        />
      ) : (
        <Card className="divide-y divide-hairline p-0">
          {shownOrder.map((entry, index) => {
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
                wait={waits.get(player.club_members.id)}
                partnerName={
                  entry.partnerId ? byId.get(entry.partnerId)?.club_members.display_name : undefined
                }
                pair={{ sessionId, requests, meId: me?.id ?? null, canAsk }}
                onRemoved={setRemoved}
                reload={reload}
              />
            )
          })}
          {showAllWaiting && (
            <ShowAllRow count={waiting.length} noun="waiting" onClick={showAllWaiting} />
          )}
        </Card>
      )}

      {resting.length > 0 && (
        <>
          <SectionHeading>Sitting out · {resting.length}</SectionHeading>
          <Card className="divide-y divide-hairline p-0">
            {shownResting.map((player) => (
              <PlayerRow
                key={player.id}
                player={player}
                isMe={player.club_members.id === me?.id}
                admin={admin}
                onRemoved={setRemoved}
                reload={reload}
              />
            ))}
            {showAllResting && (
              <ShowAllRow
                count={resting.length}
                noun="sitting out"
                onClick={showAllResting}
              />
            )}
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

/**
 * Where you are in the queue, and the only two things you can do about it.
 * Rendered by LiveSession above the courts, not inside the queue list — the
 * whole point is not having to find yourself in a list of twenty.
 */
function SelfStatus({
  player,
  position,
  status,
  upNext,
  onCourtAt,
  now,
  names,
  pair,
  reload,
}: {
  player: SessionPlayer
  position: number
  status: SessionStatus
  /** The forecast lineup you're in, if any. */
  upNext: Upcoming | null
  /** Epoch ms you're expected on court, when there's enough to guess from. */
  onCourtAt: number | null
  now: number
  names: Map<string, string>
  /** Your accepted pairing, if you have one. */
  pair: PairRequest | null
  reload: () => void
}) {
  const [busy, error, run] = useAction()
  const move = (next: SessionPlayer['status']) =>
    run(async () => {
      await setPlayerStatus(player.id, next)
      reload()
    })

  const partnerId = pair
    ? pair.from_member === player.club_members.id
      ? pair.to_member
      : pair.from_member
    : null

  // Queue position means nothing until play starts — nobody is 1st in line for a
  // match that cannot be called yet. Sitting out still can be: arriving and not
  // wanting the first round is a real thing to say.
  const over = status === 'ended'
  const waiting = player.status === 'waiting' && !over
  const live = waiting && status === 'live'
  // A court already standing empty is a promise; one still being played on is a
  // forecast, and the wording is the only thing separating them.
  const called = live && upNext !== null && upNext.freeAt <= now

  const label = over
    ? 'This session has ended.'
    : player.status === 'playing'
      ? "You're on court"
      : player.status !== 'waiting'
        ? "You're sitting out"
        : status === 'draft'
          ? "You're in — the host hasn't started yet"
          : called
            ? `You're up · Court ${upNext!.court}`
            : upNext
              ? `You're next on Court ${upNext.court} · ${waitLabel(upNext.freeAt, now)}`
              : `You're ${ordinal(position)} in the queue${
                  onCourtAt === null ? '' : ` · ${waitLabel(onCourtAt, now)}`
                }`

  return (
    <div className="mt-4 rounded-card bg-tint px-4 py-3 ring-1 ring-primary/12">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {called && (
          <Pill tone="live" dot>
            Up next
          </Pill>
        )}
        <p className="min-w-0 flex-1 text-body font-medium text-primary">{label}</p>
        {waiting && (
          <Button variant="ghost" size="sm" loading={busy} onClick={() => move('resting')}>
            Sit out
          </Button>
        )}
        {player.status === 'resting' && !over && (
          <>
            <Button variant="primary" size="sm" loading={busy} onClick={() => move('waiting')}>
              I'm back
            </Button>
            <ConfirmButton
              variant="dangerQuiet"
              size="sm"
              label="Leave"
              confirmLabel="Leave for the night?"
              busy={busy}
              onConfirm={() => move('left')}
            />
          </>
        )}
      </div>
      {/* The part people were opening the app to guess at. */}
      {live && upNext && (
        <p className="mt-1 text-meta text-primary/75">
          {matchup(upNext.lineup, player.club_members.id, names)}
        </p>
      )}
      {pair && !over && (
        <PairedNote
          request={pair}
          partner={(partnerId && names.get(partnerId)) || 'your partner'}
          reload={reload}
        />
      )}
      {error && <p className="mt-1 text-meta font-medium text-danger">{error}</p>}
    </div>
  )
}

/**
 * Your live pairing, and the way out of it.
 *
 * Whichever of you is further back sets the position for both, so the one who
 * gave up their place should be able to see that they did and take it back.
 */
function PairedNote({
  request,
  partner,
  reload,
}: {
  request: PairRequest
  partner: string
  reload: () => void
}) {
  const [busy, error, run] = useAction()

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
      <Handshake size={15} className="shrink-0 text-primary/75" aria-hidden />
      <p className="min-w-0 flex-1 text-meta text-primary/75">
        Paired with {partner} for your next game
      </p>
      <Button
        variant="ghost"
        size="sm"
        loading={busy}
        onClick={() =>
          run(async () => {
            await respondPair(request.id, 'cancelled')
            reload()
          })
        }
      >
        Unpair
      </Button>
      {error && <p className="w-full text-meta font-medium text-danger">{error}</p>}
    </div>
  )
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
  return `${n}${suffix}`
}

/** What a row needs to offer, or not offer, the "play with" control. */
type PairContext = {
  sessionId: string
  requests: PairRequest[]
  meId: string | null
  canAsk: boolean
}

function PlayerRow({
  player,
  position,
  isMe,
  admin,
  wait,
  partnerName,
  pair,
  onRemoved,
  reload,
}: {
  player: SessionPlayer
  position?: number
  isMe: boolean
  admin: boolean
  /** "up next" or "~9 min". Absent for anyone not waiting on a court. */
  wait?: string
  /** Set when this player has an accepted pairing with someone also waiting. */
  partnerName?: string
  /** Absent on the sitting-out list, where there is nobody to ask. */
  pair?: PairContext
  onRemoved: (removed: { id: string; name: string }) => void
  reload: () => void
}) {
  const [busy, error, run] = useAction()
  const name = player.club_members.display_name

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      {position !== undefined && (
        <span className="tnum w-5 shrink-0 text-meta font-semibold text-muted">{position}</span>
      )}
      <Avatar
        id={player.club_members.id}
        name={name}
        badge={<TierBadge tier={player.club_members.skill_tier} />}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-medium text-ink">
          {name}
          {isMe && <span className="ml-1.5 text-meta text-muted">(you)</span>}
        </p>
        <p className="tnum mt-0.5 text-meta text-muted">
          {player.games_played} {player.games_played === 1 ? 'game' : 'games'} ·{' '}
          {TIER_LABEL[player.club_members.skill_tier]}
          {wait && <span className="font-medium text-primary"> · {wait}</span>}
          {partnerName && <span className="text-primary"> · with {partnerName}</span>}
        </p>
      </div>

      {pair && <PairButton player={player} isMe={isMe} pair={pair} reload={reload} />}

      {/* A guest has no phone, so the host does everything for them. */}
      {isGuest(player.club_members) && <Pill tone="neutral">Guest</Pill>}

      {admin && !isMe && player.status !== 'left' && (
        <ConfirmButton
          // Red from first paint, but a glyph rather than a filled block: this
          // repeats on every row of the roster.
          variant="dangerQuiet"
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

/**
 * "Play with" on somebody else's row, and the way to take it back.
 *
 * Deliberately quiet: it repeats down a list of twenty, and the queue's job is
 * still to tell you where you stand, not to sell you a favour.
 */
function PairButton({
  player,
  isMe,
  pair,
  reload,
}: {
  player: SessionPlayer
  isMe: boolean
  pair: PairContext
  reload: () => void
}) {
  const [busy, error, run] = useAction()
  const them = player.club_members.id

  const asked = pair.requests.find(
    (r) => r.status === 'pending' && r.from_member === pair.meId && r.to_member === them,
  )

  // Someone already spoken for cannot be asked, and the server would refuse it
  // anyway. A guest has no account to answer with.
  const spokenFor = pair.requests.some(
    (r) => r.status === 'accepted' && (r.from_member === them || r.to_member === them),
  )

  if (isMe || !pair.meId) return null

  if (asked) {
    return (
      <Button
        variant="ghost"
        size="sm"
        loading={busy}
        title={error ?? undefined}
        onClick={() =>
          run(async () => {
            await respondPair(asked.id, 'cancelled')
            reload()
          })
        }
      >
        Asked · undo
      </Button>
    )
  }

  if (!pair.canAsk || spokenFor || isGuest(player.club_members)) return null

  return (
    <Button
      variant="ghost"
      size="sm"
      icon={Handshake}
      loading={busy}
      title={error ?? undefined}
      aria-label={`Ask ${player.club_members.display_name} to play with you`}
      onClick={() =>
        run(async () => {
          await requestPair(pair.sessionId, them)
          reload()
        })
      }
    >
      Play with
    </Button>
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
  const [query, setQuery] = useState('')
  const inSession = new Set(
    data.players.filter((p) => p.status !== 'left').map((p) => p.club_members.id),
  )
  const absent = data.clubMembers.filter((m) => !inSession.has(m.id))

  const q = query.trim().toLowerCase()
  const matching = q
    ? absent.filter((m) => m.display_name.toLowerCase().includes(q))
    : absent
  // A whole club as chips is a wall to read through when the host is adding one
  // named person who just walked in.
  const [shown, showAll] = useShowAll(matching, 12)

  return (
    <Card className="kq-rise mt-3">
      {absent.length > 0 && (
        <>
          <Eyebrow>Already in the club</Eyebrow>
          <p className="mt-1 text-meta text-muted">
            Here tonight, but haven't joined on their own phone.
          </p>
          {absent.length > 12 && (
            <div className="mt-3">
              <SearchField
                label="Search club members"
                placeholder="Search members"
                value={query}
                onChange={setQuery}
              />
            </div>
          )}
          {matching.length === 0 ? (
            <p className="mt-3 text-meta text-muted">Nobody matching “{query.trim()}”.</p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {shown.map((member) => (
                <button
                  key={member.id}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await addPlayer(data.session.id, member.id)
                      reload()
                    })
                  }
                  className="kq-chip inline-flex items-center gap-2 rounded-full bg-fill px-3 py-1.5 text-meta font-medium text-ink transition-transform active:scale-95 disabled:opacity-40"
                >
                  <Plus size={14} strokeWidth={2.5} aria-hidden />
                  {member.display_name}
                </button>
              ))}
              {showAll && (
                <button
                  onClick={showAll}
                  className="kq-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-meta font-semibold text-primary"
                >
                  Show all {matching.length}
                </button>
              )}
            </div>
          )}
          {error && <p className="mt-2 text-meta font-medium text-danger">{error}</p>}
          <hr className="my-4 border-hairline" />
        </>
      )}

      <Eyebrow>Someone new, without a phone</Eyebrow>
      <p className="mt-1 mb-3 text-meta text-muted">
        They queue and get scored like everyone else. They can take over this name
        later with the join code.
      </p>
      <AddGuestForm
        clubId={data.session.club_id}
        // The whole club, not `absent` — the people already on tonight's queue
        // are the ones most likely to get typed in a second time.
        taken={data.clubMembers}
        submitLabel="Add to queue"
        onAdded={async (guest) => {
          await addPlayer(data.session.id, guest.id)
          reload()
        }}
        // A name clash here almost always means the host wants that person on
        // the queue, not a new record — so offer the thing they came to do.
        onDuplicate={(existing) =>
          inSession.has(existing.id) ? (
            <p className="text-meta text-muted">They're already in tonight's session.</p>
          ) : (
            <Button
              variant="secondary"
              icon={Plus}
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await addPlayer(data.session.id, existing.id)
                  reload()
                })
              }
            >
              Add {existing.display_name} to the queue
            </Button>
          )
        }
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
    <span className="tnum inline-flex items-center gap-1 rounded-full bg-fill px-2 py-0.5 text-caption font-semibold text-ink">
      <Timer size={12} strokeWidth={2.5} aria-hidden />
      {mm}:{String(ss).padStart(2, '0')}
    </span>
  )
}
