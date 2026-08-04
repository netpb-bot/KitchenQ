import { useEffect, useMemo, useState } from 'react'
import { LayoutGrid, Play, Plus, Shuffle, Timer, UserMinus, X } from 'lucide-react'
import {
  addPlayer,
  cancelMatch,
  isGuest,
  setPlayerStatus,
  startMatch,
  type Match,
  type Member,
  type Session,
  type SessionPlayer,
} from '../lib/db'
import { pickNextMatch, queueOrder, type Lineup, type QueuePlayer } from '../lib/queue'
import { AddGuestForm } from './AddGuestForm'
import { Avatar } from './Avatar'
import { CourtDiagram } from './CourtDiagram'
import { ScoreEntry } from './ScoreEntry'
import { Button, Card, EmptyState, Pill, SectionHeading } from './ui'

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

  const names = useMemo(
    () => new Map(players.map((p) => [p.club_members.id, p.club_members.display_name])),
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

  const live = matches.filter((m) => !m.ended_at)
  const finished = matches.filter((m) => m.ended_at)

  // Empty courts are filled in order, each suggestion excluding the players the
  // previous suggestion already claimed — otherwise two free courts propose the
  // same four people.
  const suggestions = new Map<number, Lineup>()
  const claimed = new Set<string>()
  for (let court = 1; court <= session.court_count; court++) {
    if (live.some((m) => m.court_number === court)) continue
    const available = waiting.filter((p) => !claimed.has(p.memberId))
    const lineup = pickNextMatch(
      available,
      finished.map((m) => ({ teamA: m.team_a_ids, teamB: m.team_b_ids })),
    )
    if (!lineup) break
    suggestions.set(court, lineup)
    ;[...lineup.teamA, ...lineup.teamB].forEach((id) => claimed.add(id))
  }

  return (
    <>
      <SectionHeading>Courts</SectionHeading>
      <div className="space-y-3">
        {Array.from({ length: session.court_count }, (_, i) => i + 1).map((court) => {
          const match = live.find((m) => m.court_number === court)
          return match ? (
            <LiveCourt
              key={court}
              match={match}
              names={names}
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

      <Queue players={players} me={me} admin={admin} reload={reload} />

      {admin && <AddPlayer data={data} reload={reload} />}
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

/* -------------------------------------------------------------- live court */

function LiveCourt({
  match,
  names,
  session,
  admin,
  reload,
}: {
  match: Match
  names: Map<string, string>
  session: Session
  admin: boolean
  reload: () => void
}) {
  const [scoring, setScoring] = useState(false)
  const elapsed = useElapsed(match.started_at)
  const name = (id: string) => ({ name: names.get(id) ?? 'Unknown' })
  // The host always scores; players only when the session says they may.
  const canScore = admin || session.allow_player_scoring

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold text-ink">Court {match.court_number}</p>
        <span className="tnum inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
          <Timer size={16} strokeWidth={2.25} aria-hidden />
          {elapsed}
        </span>
      </div>

      <div className="mt-3">
        <CourtDiagram
          teamA={match.team_a_ids.map(name)}
          teamB={match.team_b_ids.map(name)}
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
          <div className="mt-3 flex gap-2">
            <Button full onClick={() => setScoring(true)}>
              End match · enter score
            </Button>
            {admin && <CancelMatchButton matchId={match.id} reload={reload} />}
          </div>
        ))}
    </Card>
  )
}

function CancelMatchButton({ matchId, reload }: { matchId: string; reload: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!confirming) {
    return (
      <Button variant="ghost" icon={X} onClick={() => setConfirming(true)} className="px-3">
        Cancel
      </Button>
    )
  }
  return (
    <Button
      variant="danger"
      disabled={busy}
      className="px-3"
      onClick={async () => {
        setBusy(true)
        await cancelMatch(matchId)
        reload()
      }}
    >
      Undo start?
    </Button>
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

  if (!admin) {
    return (
      <Card className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-tint text-primary">
          <LayoutGrid size={20} strokeWidth={2.25} aria-hidden />
        </span>
        <p className="min-w-0 flex-1 font-semibold text-ink">Court {court} is open</p>
      </Card>
    )
  }

  if (!lineup) {
    return (
      <Card>
        <p className="font-semibold text-ink">Court {court} is open</p>
        <p className="mt-1 text-sm text-muted">
          {session.status === 'live'
            ? 'Four players need to be in the queue before a match can start.'
            : 'Start the session to put a match on court.'}
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
        <p className="font-semibold text-ink">Court {court}</p>
        <Pill tone="neutral">Next up</Pill>
      </div>

      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <TeamSlots ids={lineup.slice(0, 2)} offset={0} byId={byId} slot={slot} onPick={setSlot} />
        <span className="text-xs font-bold text-muted">vs</span>
        <TeamSlots ids={lineup.slice(2, 4)} offset={2} byId={byId} slot={slot} onPick={setSlot} />
      </div>

      {slot !== null && (
        <div className="mt-3 rounded-xl bg-tint p-3">
          <p className="text-sm font-semibold text-ink">
            {bench.length > 0 ? 'Swap in a player from the queue' : 'Nobody else is waiting'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {bench.map((p) => (
              <button
                key={p.memberId}
                onClick={() => substitute(p.memberId)}
                className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-sm font-semibold text-ink"
              >
                <Avatar name={p.name} size="sm" />
                {p.name}
              </button>
            ))}
            <button
              onClick={() => setSlot(null)}
              className="rounded-full px-3 py-1.5 text-sm font-semibold text-muted"
            >
              Keep
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm font-medium text-danger">{error}</p>}

      <div className="mt-3 flex gap-2">
        <Button icon={Play} full disabled={busy} onClick={() => void start()}>
          {busy ? 'Starting…' : 'Start match'}
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
            className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left ${selected ? 'bg-tint ring-2 ring-primary' : ''}`}
          >
            <Avatar name={player?.name ?? '?'} size="sm" />
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
  reload,
}: {
  players: SessionPlayer[]
  me: Member | null
  admin: boolean
  reload: () => void
}) {
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

  return (
    <>
      <SectionHeading>
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
          {order.map((entry, index) => {
            const player = byId.get(entry.memberId)!
            return (
              <PlayerRow
                key={player.id}
                player={player}
                position={index + 1}
                isMe={player.club_members.id === me?.id}
                admin={admin}
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
                reload={reload}
              />
            ))}
          </Card>
        </>
      )}
    </>
  )
}

function PlayerRow({
  player,
  position,
  isMe,
  admin,
  reload,
}: {
  player: SessionPlayer
  position?: number
  isMe: boolean
  admin: boolean
  reload: () => void
}) {
  const [busy, setBusy] = useState(false)

  async function move(status: SessionPlayer['status']) {
    setBusy(true)
    await setPlayerStatus(player.id, status)
    reload()
    setBusy(false)
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {position !== undefined && (
        <span className="tnum w-5 shrink-0 text-sm font-bold text-muted">{position}</span>
      )}
      <Avatar name={player.club_members.display_name} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-ink">
          {player.club_members.display_name}
          {isMe && <span className="ml-1.5 text-sm font-medium text-muted">(you)</span>}
        </p>
        <p className="tnum mt-0.5 text-xs text-muted">
          {player.games_played} {player.games_played === 1 ? 'game' : 'games'} ·{' '}
          {player.club_members.skill_tier}
        </p>
      </div>

      {/* A guest has no phone, so the host does everything for them. */}
      {isGuest(player.club_members) && <Pill tone="neutral">Guest</Pill>}

      {isMe && player.status === 'waiting' && (
        <Button variant="ghost" disabled={busy} className="px-3" onClick={() => void move('resting')}>
          Sit out
        </Button>
      )}
      {isMe && player.status === 'resting' && (
        <Button variant="secondary" disabled={busy} className="px-3" onClick={() => void move('waiting')}>
          I'm back
        </Button>
      )}
      {admin && !isMe && player.status !== 'left' && (
        <Button
          variant="ghost"
          icon={UserMinus}
          disabled={busy}
          className="px-3"
          aria-label={`Remove ${player.club_members.display_name}`}
          onClick={() => void move('left')}
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------- add players */

function AddPlayer({ data, reload }: { data: LiveData; reload: () => void }) {
  const [busy, setBusy] = useState(false)
  const inSession = new Set(
    data.players.filter((p) => p.status !== 'left').map((p) => p.club_members.id),
  )
  const absent = data.clubMembers.filter((m) => !inSession.has(m.id))

  return (
    <>
      <SectionHeading>Add players</SectionHeading>
      <Card>
        {absent.length > 0 && (
          <>
            <p className="text-sm text-muted">
              Club members who are here but haven't joined on their own phone.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {absent.map((member) => (
                <button
                  key={member.id}
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    await addPlayer(data.session.id, member.id)
                    reload()
                    setBusy(false)
                  }}
                  className="inline-flex items-center gap-2 rounded-full bg-tint px-3 py-1.5 text-sm font-semibold text-primary"
                >
                  <Plus size={14} strokeWidth={2.5} aria-hidden />
                  {member.display_name}
                </button>
              ))}
            </div>
            <hr className="my-4 border-hairline" />
          </>
        )}

        <p className="text-sm font-semibold text-ink">Someone new, without a phone</p>
        <p className="mt-0.5 mb-3 text-sm text-muted">
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
      </Card>
    </>
  )
}

/* -------------------------------------------------------------------- timer */

/** Wall-clock elapsed time as mm:ss, ticking once a second. */
function useElapsed(since: string): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const seconds = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000))
  const mm = Math.floor(seconds / 60)
  const ss = seconds % 60
  return `${mm}:${String(ss).padStart(2, '0')}`
}
