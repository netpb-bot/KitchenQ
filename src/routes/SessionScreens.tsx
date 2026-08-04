import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import {
  Check,
  ChevronLeft,
  Clock,
  History,
  LayoutGrid,
  Pencil,
  Share2,
  Timer,
  Trophy,
  Users,
} from 'lucide-react'
import {
  getClub,
  getSession,
  isAdmin,
  listLedger,
  listMatches,
  listMembers,
  listSessionPlayers,
  myMember,
  setPlayerScoring,
  setSessionStatus,
  useAction,
  useAsync,
  watchSession,
  type Club,
  type Connection,
  type LedgerEntry,
  type Match,
  type Session,
} from '../lib/db'
import { standings, type Standing } from '../lib/standings'
import { ConnectionBanner, isUnreachable } from '../components/ConnectionBanner'
import { FeeSheet } from '../components/FeeSheet'
import { LiveSession, type LiveData } from '../components/LiveSession'
import { MatchResult } from '../components/MatchRow'
import { RankingNote, StandingsList } from '../components/StandingsList'
import { ScoreEntry } from '../components/ScoreEntry'
import { Avatar } from '../components/Avatar'
import {
  Button,
  Card,
  DarkCard,
  EmptyState,
  ErrorNote,
  Loading,
  Pill,
  Screen,
  SectionHeading,
  StatTile,
} from '../components/ui'

type View = LiveData & { club: Club | null; ledger: LedgerEntry[] }

/** Session, viewer's membership, roster, matches and fees, kept live by realtime. */
function useSessionView(): [
  { loading: boolean; data?: View; error?: string },
  () => void,
  Connection,
] {
  const { sessionId } = useParams<{ sessionId: string }>()
  const id = sessionId!
  const [connection, setConnection] = useState<Connection>('connecting')

  const [view, reload] = useAsync(async (): Promise<View> => {
    const session = await getSession(id)
    const [me, players, matches, clubMembers, club, ledger] = await Promise.all([
      myMember(session.club_id),
      listSessionPlayers(id),
      listMatches(id),
      listMembers(session.club_id),
      // Only members may read the club, and this screen is reachable by someone
      // who hasn't joined yet. Its currency is a nicety; the screen is not.
      getClub(session.club_id).catch(() => null),
      listLedger(id),
    ])
    return { session, me, players, matches, clubMembers, club, ledger }
  }, [id])

  useEffect(() => watchSession(id, reload, setConnection), [id])

  return [view, reload, connection]
}

/**
 * Session shell: back link, live header, then the tab's own content. M2 fills
 * in courts and the court diagram, M3 the ranks, M4 the fees.
 */
function SessionScreen({
  title,
  children,
}: {
  title: string
  children: (view: View, reload: () => void) => ReactNode
}) {
  const [view, reload, connection] = useSessionView()

  return (
    <Screen
      title={title}
      lead={
        <Link
          to="/"
          className="-ml-1 inline-flex min-h-11 items-center gap-1 pt-3 text-sm font-semibold text-muted"
        >
          <ChevronLeft size={18} aria-hidden />
          Home
        </Link>
      }
    >
      {view.loading ? (
        <Loading label="Loading session…" />
      ) : view.error ? (
        // A session that can't be reached is a connection problem, not a stack
        // trace the host can do anything with.
        isUnreachable(view.error) ? (
          <ConnectionBanner error={view.error} />
        ) : (
          <ErrorNote>{view.error}</ErrorNote>
        )
      ) : (
        <>
          <SessionHeader view={view.data!} reload={reload} />
          <ConnectionBanner state={connection} />
          {children(view.data!, reload)}
        </>
      )}
    </Screen>
  )
}

function SessionHeader({ view, reload }: { view: View; reload: () => void }) {
  const { session, me, players, matches } = view
  const waiting = players.filter((p) => p.status === 'waiting').length
  const played = matches.filter((m) => m.ended_at).length
  const admin = isAdmin(me)
  const [busy, error, run] = useAction()

  const move = (status: Session['status']) =>
    run(async () => {
      await setSessionStatus(session.id, status)
      reload()
    })

  return (
    <DarkCard>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {session.status === 'live' ? (
            <Pill tone="live" dot>
              LIVE
            </Pill>
          ) : (
            <Pill tone="onDark">{session.status === 'draft' ? 'Not started' : 'Ended'}</Pill>
          )}
          <p className="mt-2 truncate text-xl font-bold text-white">{session.name}</p>
        </div>
        <ShareCode code={session.join_code} />
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2 border-t border-white/10 pt-4">
        <StatTile icon={Users} value={players.length} label="Players" tone="onDark" />
        <StatTile icon={LayoutGrid} value={session.court_count} label="Courts" tone="onDark" />
        <StatTile icon={Timer} value={waiting} label="In queue" tone="onDark" />
        <StatTile icon={Trophy} value={played} label="Matches" tone="onDark" />
      </div>

      {admin && session.status !== 'ended' && (
        <div className="mt-4 border-t border-white/10 pt-4">
          {session.status === 'draft' ? (
            <Button variant="brand" full disabled={busy} onClick={() => move('live')}>
              Start session
            </Button>
          ) : (
            <Button variant="danger" full disabled={busy} onClick={() => move('ended')}>
              End session
            </Button>
          )}
          {error && (
            <p role="alert" className="mt-2 text-sm font-medium text-accent">
              {error}
            </p>
          )}
          <PlayerScoringToggle session={session} reload={reload} />
        </div>
      )}
    </DarkCard>
  )
}

/**
 * Off by default: on a busy night one person with the phone is faster and more
 * consistent than four people arguing over who taps Save.
 */
function PlayerScoringToggle({
  session,
  reload,
}: {
  session: Session
  reload: () => void
}) {
  const [busy, error, run] = useAction()

  return (
    <>
      {/* The whole row is the target: the box itself is only 24px wide. */}
      <label className="mt-3 flex min-h-11 items-center justify-between gap-3">
        <span className="text-sm font-medium text-white/80">
          Players can enter their own score
        </span>
        <input
          type="checkbox"
          className="h-6 w-6 shrink-0 accent-brand"
          checked={session.allow_player_scoring}
          disabled={busy}
          onChange={(e) => {
            const allow = e.target.checked
            run(async () => {
              await setPlayerScoring(session.id, allow)
              reload()
            })
          }}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm font-medium text-accent">
          {error}
        </p>
      )}
    </>
  )
}

/**
 * Native share sheet where there is one, clipboard everywhere else. Returns
 * 'copied' when the link went to the clipboard so the caller can say so — the
 * share sheet needs no confirmation of its own.
 *
 * Clipboard writes reject on Safari without a user-gesture chain and wherever
 * the permission is denied, so this reports the failure instead of letting it
 * become an unhandled rejection and a button that appears to do nothing.
 */
async function shareLink(url: string, title: string): Promise<'shared' | 'copied' | 'failed'> {
  if (navigator.share) {
    // Cancelling the share sheet rejects; that is not an error worth showing.
    await navigator.share({ title, url }).catch(() => {})
    return 'shared'
  }
  try {
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch {
    return 'failed'
  }
}

function ShareCode({ code }: { code: string }) {
  const [result, setResult] = useState<'copied' | 'failed' | null>(null)
  const url = `${location.origin}/join?code=${code}`

  async function share() {
    const outcome = await shareLink(url, 'Join our pickleball session')
    if (outcome === 'shared') return
    setResult(outcome)
    setTimeout(() => setResult(null), 2000)
  }

  return (
    <button
      onClick={() => void share()}
      aria-label={`Share join code ${code.split('').join(' ')}`}
      className="min-h-11 shrink-0 rounded-xl bg-white/10 px-3 py-2 text-center"
    >
      <span
        aria-hidden
        className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-white/60"
      >
        {result === 'copied' ? <Check size={11} /> : <Share2 size={11} />}
        {result === 'copied' ? 'Copied' : result === 'failed' ? 'Copy failed' : 'Code'}
      </span>
      <span aria-hidden className="tnum block text-base font-bold tracking-widest text-accent">
        {code}
      </span>
      {/* Announced only when it changes; the button's own name stays stable. */}
      <span role="status" className="sr-only">
        {result === 'copied'
          ? 'Join link copied'
          : result === 'failed'
            ? 'Could not copy the link'
            : ''}
      </span>
    </button>
  )
}

/** Shown to anyone viewing a session they haven't entered yet. */
function NotJoined({ code }: { code: string }) {
  const navigate = useNavigate()
  return (
    <div className="mt-6">
      <EmptyState
        icon={Users}
        message="You're not in this session yet."
        hint="Join to appear on the queue."
        action={<Button onClick={() => navigate(`/join?code=${code}`)}>Join session</Button>}
      />
    </div>
  )
}

export function SessionLive() {
  return (
    <SessionScreen title="Live">
      {(view, reload) => {
        const active = view.players.filter((p) => p.status !== 'left')
        const inSession = active.some((p) => p.club_members.id === view.me?.id)
        return (
          <>
            {!inSession && <NotJoined code={view.session.join_code} />}
            {active.length === 0 ? (
              <>
                <SectionHeading>Players</SectionHeading>
                <EmptyState
                  icon={Users}
                  message="Nobody has joined yet."
                  hint={`Share code ${view.session.join_code} and players appear here as they arrive.`}
                />
              </>
            ) : (
              <LiveSession data={view} admin={isAdmin(view.me)} reload={reload} />
            )}
          </>
        )
      }}
    </SessionScreen>
  )
}

export function SessionRanks() {
  return (
    <SessionScreen title="Ranks">
      {(view) => {
        const table = standings(
          view.players.map((p) => ({
            memberId: p.club_members.id,
            name: p.club_members.display_name,
          })),
          view.matches,
        )

        if (table.length === 0) {
          return (
            <div className="mt-6">
              <EmptyState
                icon={Trophy}
                message="No matches finished yet."
                hint="Standings appear as soon as the first score is recorded."
              />
            </div>
          )
        }

        return (
          <>
            {view.session.status === 'ended' && <Recap view={view} table={table} />}

            <SectionHeading>Standings</SectionHeading>
            <StandingsList table={table} meId={view.me?.id} />
            <RankingNote />
          </>
        )
      }}
    </SessionScreen>
  )
}

/** Shown once the session has ended. The only celebration surface in the app. */
function Recap({ view, table }: { view: View; table: Standing[] }) {
  const { session, players, matches } = view
  const played = matches.filter((m) => m.ended_at)
  const [shared, setShared] = useState<'copied' | 'failed' | null>(null)
  // Second, first, third — the podium reads left to right as it stands.
  const podium = [table[1], table[0], table[2]].filter(Boolean)

  return (
    <div className="mt-6">
      <DarkCard>
        <p className="text-center text-2xl font-bold text-white">Session wrapped!</p>
        <p className="mt-1 text-center text-sm text-white/70">{session.name}</p>

        <div className="mt-6 flex items-end justify-center gap-3">
          {podium.map((row) => {
            const place = table.indexOf(row) + 1
            return (
              <div key={row.memberId} className="flex flex-col items-center gap-2">
                <Avatar name={row.name} size={place === 1 ? 'lg' : 'md'} />
                <p className="max-w-20 truncate text-center text-xs font-semibold text-white">
                  {row.name}
                </p>
                <div
                  className={`flex w-20 flex-col items-center justify-start rounded-t-xl bg-white/10 pt-2 ${
                    place === 1 ? 'h-20' : place === 2 ? 'h-14' : 'h-10'
                  }`}
                >
                  <span className="tnum text-lg font-bold text-accent">{place}</span>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-6 grid grid-cols-4 gap-2 border-t border-white/10 pt-4">
          <StatTile icon={Clock} value={duration(session)} label="Duration" tone="onDark" />
          <StatTile icon={Trophy} value={played.length} label="Matches" tone="onDark" />
          <StatTile icon={Users} value={players.length} label="Players" tone="onDark" />
          <StatTile icon={LayoutGrid} value={session.court_count} label="Courts" tone="onDark" />
        </div>

        <div className="mt-4">
          <Button
            variant="brand"
            full
            icon={shared === 'copied' ? Check : Share2}
            onClick={() => {
              void shareLink(location.href, `${session.name} — session wrapped`).then(
                (outcome) => {
                  if (outcome === 'shared') return
                  setShared(outcome)
                  setTimeout(() => setShared(null), 2000)
                },
              )
            }}
          >
            {shared === 'copied'
              ? 'Link copied'
              : shared === 'failed'
                ? 'Copy failed — long-press the address bar'
                : 'Share recap'}
          </Button>
        </div>
      </DarkCard>
    </div>
  )
}

/** Wall-clock length of the session, as "1h 45m". Blank if it never started. */
function duration(session: Session): string {
  if (!session.started_at) return '—'
  const end = session.ended_at ? new Date(session.ended_at) : new Date()
  const minutes = Math.max(0, Math.round((end.getTime() - new Date(session.started_at).getTime()) / 60000))
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

export function SessionHistory() {
  return (
    <SessionScreen title="History">
      {(view, reload) => {
        const { players, matches, session } = view
        const played = matches.filter((m) => m.ended_at)
        const names = new Map(
          players.map((p) => [p.club_members.id, p.club_members.display_name]),
        )

        if (played.length === 0) {
          return (
            <div className="mt-6">
              <EmptyState
                icon={History}
                message="No matches finished yet."
                hint="Every match shows up here once its score is recorded."
              />
            </div>
          )
        }

        return (
          <>
            <SectionHeading>
              {played.length} {played.length === 1 ? 'match' : 'matches'}
            </SectionHeading>
            <div className="space-y-3">
              {played.map((match) => (
                <FinishedMatch
                  key={match.id}
                  match={match}
                  names={names}
                  session={session}
                  admin={isAdmin(view.me)}
                  reload={reload}
                />
              ))}
            </div>
          </>
        )
      }}
    </SessionScreen>
  )
}

/** One recorded result. The host can reopen the score to fix a typo. */
function FinishedMatch({
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
  const [fixing, setFixing] = useState(false)

  return (
    <Card>
      <div className="flex items-center justify-between gap-2 text-xs font-semibold text-muted">
        <span>Court {match.court_number}</span>
        <span className="tnum">
          {new Date(match.ended_at!).toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </span>
      </div>
      <div className="mt-2">
        <MatchResult
          teamA={match.team_a_ids}
          teamB={match.team_b_ids}
          scoreA={match.score_a ?? 0}
          scoreB={match.score_b ?? 0}
          names={names}
        />
      </div>

      {admin &&
        (fixing ? (
          <ScoreEntry
            match={match}
            session={session}
            names={names}
            mode="correct"
            onCancel={() => setFixing(false)}
            onSaved={() => {
              setFixing(false)
              reload()
            }}
          />
        ) : (
          <div className="mt-2 flex justify-end">
            <Button variant="ghost" icon={Pencil} onClick={() => setFixing(true)}>
              Fix score
            </Button>
          </div>
        ))}
    </Card>
  )
}

export function SessionFees() {
  return (
    <SessionScreen title="Fees">
      {(view, reload) => (
        <FeeSheet
          session={view.session}
          club={view.club}
          me={view.me}
          players={view.players}
          ledger={view.ledger}
          admin={isAdmin(view.me)}
          reload={reload}
        />
      )}
    </SessionScreen>
  )
}
