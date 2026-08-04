import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
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
  useAsync,
  watchSession,
  type Club,
  type LedgerEntry,
  type Match,
  type Session,
} from '../lib/db'
import { standings, type Standing } from '../lib/standings'
import { FeeSheet } from '../components/FeeSheet'
import { LiveSession, type LiveData } from '../components/LiveSession'
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
] {
  const { sessionId } = useParams<{ sessionId: string }>()
  const id = sessionId!

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

  useEffect(() => watchSession(id, reload), [id])

  return [view, reload]
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
  const [view, reload] = useSessionView()

  return (
    <Screen
      title={title}
      lead={
        <Link
          to="/"
          className="-ml-1 inline-flex items-center gap-1 pt-3 text-sm font-semibold text-muted"
        >
          <ChevronLeft size={18} aria-hidden />
          Home
        </Link>
      }
    >
      {view.loading ? (
        <Loading label="Loading session…" />
      ) : view.error ? (
        <ErrorNote>{view.error}</ErrorNote>
      ) : (
        <>
          <SessionHeader view={view.data!} reload={reload} />
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
  const [busy, setBusy] = useState(false)

  async function move(status: Session['status']) {
    setBusy(true)
    await setSessionStatus(session.id, status)
    reload()
    setBusy(false)
  }

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
            <Button variant="brand" full disabled={busy} onClick={() => void move('live')}>
              Start session
            </Button>
          ) : (
            <Button variant="danger" full disabled={busy} onClick={() => void move('ended')}>
              End session
            </Button>
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
  const [busy, setBusy] = useState(false)

  return (
    <label className="mt-3 flex items-center justify-between gap-3">
      <span className="text-sm font-medium text-white/80">
        Players can enter their own score
      </span>
      <input
        type="checkbox"
        className="h-6 w-6 shrink-0 accent-brand"
        checked={session.allow_player_scoring}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true)
          await setPlayerScoring(session.id, e.target.checked)
          reload()
          setBusy(false)
        }}
      />
    </label>
  )
}

/**
 * Native share sheet where there is one, clipboard everywhere else. Returns
 * true when the link was copied, so the caller can say so — the share sheet
 * needs no confirmation of its own.
 */
async function shareLink(url: string, title: string): Promise<boolean> {
  if (navigator.share) {
    // Cancelling the share sheet rejects; that is not an error worth showing.
    await navigator.share({ title, url }).catch(() => {})
    return false
  }
  await navigator.clipboard.writeText(url)
  return true
}

function ShareCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const url = `${location.origin}/join?code=${code}`

  async function share() {
    if (!(await shareLink(url, 'Join our pickleball session'))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={() => void share()}
      className="shrink-0 rounded-xl bg-white/10 px-3 py-2 text-center"
    >
      <span className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-white/60">
        {copied ? <Check size={11} aria-hidden /> : <Share2 size={11} aria-hidden />}
        {copied ? 'Copied' : 'Code'}
      </span>
      <span className="tnum block text-base font-bold tracking-widest text-accent">{code}</span>
    </button>
  )
}

/** Shown to anyone viewing a session they haven't entered yet. */
function NotJoined({ code }: { code: string }) {
  return (
    <div className="mt-6">
      <EmptyState
        icon={Users}
        message="You're not in this session yet."
        hint="Join to appear on the queue."
        action={
          <Link to={`/join?code=${code}`}>
            <Button>Join session</Button>
          </Link>
        }
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
            <Card className="divide-y divide-hairline p-0">
              {table.map((row, i) => (
                <div key={row.memberId} className="flex items-center gap-3 px-4 py-3">
                  <span className="tnum w-5 shrink-0 text-sm font-bold text-muted">
                    {i + 1}
                  </span>
                  <Avatar name={row.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink">
                      {row.name}
                      {row.memberId === view.me?.id && (
                        <span className="ml-1.5 text-sm font-medium text-muted">(you)</span>
                      )}
                    </p>
                    <p className="tnum mt-0.5 text-xs text-muted">
                      {row.wins}–{row.losses} · {row.diff >= 0 ? '+' : ''}
                      {row.diff} pts
                    </p>
                  </div>
                  <span className="tnum text-base font-bold text-primary">
                    {Math.round(row.rate * 100)}%
                  </span>
                </div>
              ))}
            </Card>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Ranked by adjusted win rate — a record is pulled toward 50% until you
              have played enough games for it to mean something, so one lucky win
              doesn't top the table. Ties break on point difference.
            </p>
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
  const [copied, setCopied] = useState(false)
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
            icon={copied ? Check : Share2}
            onClick={async () => {
              if (await shareLink(location.href, `${session.name} — session wrapped`)) {
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              }
            }}
          >
            {copied ? 'Link copied' : 'Share recap'}
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
  const aWon = (match.score_a ?? 0) > (match.score_b ?? 0)

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
      <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <TeamLine ids={match.team_a_ids} names={names} won={aWon} />
        <p className="tnum text-lg font-bold text-ink">
          {match.score_a}–{match.score_b}
        </p>
        <TeamLine ids={match.team_b_ids} names={names} won={!aWon} align="right" />
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

function TeamLine({
  ids,
  names,
  won,
  align = 'left',
}: {
  ids: string[]
  names: Map<string, string>
  won: boolean
  align?: 'left' | 'right'
}) {
  return (
    <div className={align === 'right' ? 'text-right' : ''}>
      <div
        className={`flex items-center gap-1.5 ${align === 'right' ? 'justify-end' : ''}`}
      >
        {ids.map((id) => (
          <Avatar key={id} name={names.get(id) ?? 'Unknown'} size="sm" />
        ))}
      </div>
      <p
        className={`mt-1 truncate text-xs ${won ? 'font-bold text-primary' : 'font-medium text-muted'}`}
      >
        {ids.map((id) => firstName(names.get(id) ?? 'Unknown')).join(' & ')}
      </p>
    </div>
  )
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
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
