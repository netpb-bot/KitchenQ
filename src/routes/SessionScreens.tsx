import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import {
  Banknote,
  Check,
  ChevronLeft,
  Clock,
  Crown,
  ImagePlus,
  LayoutGrid,
  Pencil,
  RotateCcw,
  Share2,
  Sparkles,
  Timer,
  Trash2,
  Trophy,
  Users,
} from 'lucide-react'
import {
  duration,
  getClub,
  getSession,
  isAdmin,
  listLedger,
  listMatches,
  listMembers,
  listSessionPlayers,
  myMember,
  reopenSession,
  setPlayerScoring,
  setSessionPhoto,
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
import { downscale } from '../lib/image'
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
  ConfirmButton,
  DarkCard,
  EmptyState,
  ErrorNote,
  Eyebrow,
  Loading,
  Pill,
  Screen,
  SectionHeading,
  ShowAllRow,
  StatCard,
  StatTile,
  useShowAll,
} from '../components/ui'
import { palette } from '../theme'

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
      action={view.data && <FeesLink view={view.data} />}
      lead={
        <Link
          to="/"
          className="-ml-1 inline-flex min-h-11 items-center gap-1 pt-3 text-meta font-medium text-muted"
        >
          <ChevronLeft size={17} aria-hidden />
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
          <ErrorNote onRetry={reload}>{view.error}</ErrorNote>
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

/**
 * Fees lives in the header, not in the tab bar: it is a once-a-night host job,
 * and a permanent tab for it cost a quarter of the app's most-tapped control.
 * It carries its label, though — a lone banknote glyph said neither "tap me"
 * nor "money". The dot is the part that matters beyond that: it says "there is
 * money outstanding" without anyone having to go and look.
 *
 * An admin sees the dot when anyone owes; a player only when they do.
 */
function FeesLink({ view }: { view: View }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // Every session screen shares this header, Fees included — and a control
  // that points at the page you are on is at best dead, at worst a dead end.
  if (pathname.endsWith('/fees')) return null

  const mine = isAdmin(view.me)
    ? view.ledger
    : view.ledger.filter((e) => e.club_member_id === view.me?.id)
  const owing = mine.some((e) => e.amount_due > e.amount_paid)

  return (
    <Button
      variant="secondary"
      size="sm"
      icon={Banknote}
      className="relative"
      // Absolute, not `to="fees"`: a relative path resolves against the current
      // screen, so from Standings it aimed at /standings/fees and 404'd.
      onClick={() => navigate(`/session/${view.session.id}/fees`)}
      aria-label={owing ? 'Fees — payments outstanding' : undefined}
    >
      Fees
      {owing && (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-warn-fill ring-2 ring-page"
        />
      )}
    </Button>
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
    <DarkCard watermark={Trophy} photo={session.photo_url}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {session.status === 'live' ? (
            <Pill tone="live" dot>
              LIVE
            </Pill>
          ) : (
            // A draft is unresolved and an ended session is finished. Both were
            // rendering as the same grey chip, which said neither.
            <Pill tone={session.status === 'draft' ? 'warnOnDark' : 'onDark'}>
              {session.status === 'draft' ? 'Not started' : 'Ended'}
            </Pill>
          )}
          <p className="mt-2.5 truncate text-title font-semibold text-white">{session.name}</p>
        </div>
        <ShareCode code={session.join_code} />
      </div>

      <div className="mt-5 grid grid-cols-4 gap-2 border-t border-white/10 pt-5">
        <StatTile icon={Users} value={players.length} label="Players" tone="onDark" />
        <StatTile icon={LayoutGrid} value={session.court_count} label="Courts" tone="onDark" />
        <StatTile icon={Timer} value={waiting} label="In queue" tone="onDark" />
        <StatTile icon={Trophy} value={played} label="Matches" tone="onDark" />
      </div>

      {admin && (
        <div className="mt-5 border-t border-white/10 pt-5">
          {session.status === 'draft' && (
            <Button variant="brand" full loading={busy} onClick={() => move('live')}>
              Start session
            </Button>
          )}
          {/* Ending is the one irreversible-looking action on this screen, so it
              confirms — and reopening exists, so it is not irreversible at all. */}
          {session.status === 'live' && (
            <ConfirmButton
              variant="danger"
              full
              label="End session"
              confirmLabel="End it for everyone?"
              busy={busy}
              onConfirm={() => move('ended')}
            />
          )}
          {session.status === 'ended' && (
            <Button
              variant="secondaryOnDark"
              icon={RotateCcw}
              full
              loading={busy}
              onClick={() =>
                run(async () => {
                  await reopenSession(session.id)
                  reload()
                })
              }
            >
              Reopen session
            </Button>
          )}
          {error && (
            <p role="alert" className="mt-2 text-meta font-medium text-danger-on-dark">
              {error}
            </p>
          )}
          {session.status !== 'ended' && (
            <PlayerScoringToggle session={session} reload={reload} />
          )}
          {/* No status check: the group shot gets taken at the end of the
              night, which is after the host has already tapped End session. */}
          <SessionPhotoButton session={session} reload={reload} />
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
        <span className="text-meta font-medium text-white/70">
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
        <p role="alert" className="text-meta font-medium text-danger-on-dark">
          {error}
        </p>
      )}
    </>
  )
}

/**
 * The night's group photo, which becomes the background of this session's cards.
 *
 * No cropping step, unlike AvatarPicker: that circle throws away most of a
 * photo, so choosing what survives is the whole job. This is a full-width
 * background — the picture arrives roughly as it was taken, and a host who
 * wants it framed differently picks a different photo.
 */
function SessionPhotoButton({ session, reload }: { session: Session; reload: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, error, run] = useAction()

  const save = (file: File | undefined) => {
    if (!file) return
    run(async () => {
      await setSessionPhoto(session.id, await downscale(file))
      reload()
    })
  }

  return (
    <div className="mt-3">
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          save(e.target.files?.[0])
          // Cleared so picking the same file twice still fires a change.
          e.target.value = ''
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondaryOnDark"
          size="sm"
          icon={ImagePlus}
          loading={busy}
          onClick={() => fileInput.current?.click()}
        >
          {session.photo_url ? 'Change photo' : 'Add photo'}
        </Button>
        {session.photo_url && (
          <Button
            variant="ghostOnDark"
            size="sm"
            icon={Trash2}
            disabled={busy}
            onClick={() =>
              run(async () => {
                await setSessionPhoto(session.id, null)
                reload()
              })
            }
          >
            Remove
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-meta font-medium text-danger-on-dark">
          {error}
        </p>
      )}
    </div>
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
      className="min-h-11 shrink-0 rounded-xl bg-fill-on-dark px-3 py-2 text-center ring-1 ring-white/10 transition-colors active:scale-95 md:hover:bg-fill-on-dark-strong"
    >
      <span
        aria-hidden
        className="flex items-center justify-center gap-1 text-caption font-semibold uppercase text-white/55"
      >
        {result === 'copied' ? <Check size={11} /> : <Share2 size={11} />}
        {result === 'copied' ? 'Copied' : result === 'failed' ? 'Copy failed' : 'Code'}
      </span>
      <span
        aria-hidden
        className="tnum mt-0.5 block text-body font-semibold tracking-[0.18em] text-accent"
      >
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

/**
 * A one-line prompt rather than a full empty state: it used to sit *above* the
 * working queue, telling you you were not in the session while you looked at
 * the whole thing.
 */
function NotJoined({ code }: { code: string }) {
  const navigate = useNavigate()
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-card bg-tint px-4 py-3 ring-1 ring-primary/12">
      <p className="min-w-0 flex-1 text-meta font-medium text-primary">
        You're watching, not playing.
      </p>
      <Button size="sm" onClick={() => navigate(`/join?code=${code}`)}>
        Join the queue
      </Button>
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

/**
 * Standings, then the matches that produced them. These used to be two tabs,
 * which meant checking *why* someone was top cost a tab switch — the results
 * are the evidence for the table, so they live directly under it.
 */
export function SessionStandings() {
  return (
    <SessionScreen title="Standings">
      {(view, reload) => <StandingsBody view={view} reload={reload} />}
    </SessionScreen>
  )
}

function StandingsBody({ view, reload }: { view: View; reload: () => void }) {
  const table = standings(
    view.players.map((p) => ({
      memberId: p.club_members.id,
      name: p.club_members.display_name,
    })),
    view.matches,
  )
  const played = view.matches.filter((m) => m.ended_at)

  // Twenty-eight players and a four-court night is a table plus sixty cards. The
  // headings carry the true totals, so a capped list reads as a cap rather than
  // as results that failed to load.
  const [shownTable, showAllPlayers] = useShowAll(table, 10)
  const [shownMatches, showAllMatches] = useShowAll(played, 5)

  if (table.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState
          icon={Trophy}
          message="No matches finished yet."
          hint="Standings and results appear as soon as the first score is recorded."
        />
      </div>
    )
  }

  const names = new Map(
    view.players.map((p) => [p.club_members.id, p.club_members.display_name]),
  )

  return (
    <>
      {view.session.status === 'ended' && <Recap view={view} table={table} />}

      <SectionHeading>Standings</SectionHeading>
      <StandingsList table={shownTable} meId={view.me?.id}>
        {showAllPlayers && (
          <ShowAllRow count={table.length} noun="players" onClick={showAllPlayers} />
        )}
      </StandingsList>
      <RankingNote />

      <SectionHeading>
        {played.length} {played.length === 1 ? 'match' : 'matches'}
      </SectionHeading>
      <div className="space-y-3">
        {shownMatches.map((match) => (
          <FinishedMatch
            key={match.id}
            match={match}
            names={names}
            session={view.session}
            admin={isAdmin(view.me)}
            reload={reload}
          />
        ))}
        {showAllMatches && (
          <Card className="p-0">
            <ShowAllRow count={played.length} noun="matches" onClick={showAllMatches} />
          </Card>
        )}
      </div>
    </>
  )
}

/**
 * Colour and height are a function of place and nothing else. Height driven by
 * wins — as it used to be — contradicts the table, which ranks on adjusted win
 * rate (see standings()): a player with more raw wins can legitimately place
 * second and got the taller block for it. It also collapsed to three identical
 * slabs whenever the top three were level on wins, which on a club night is the
 * common case rather than the edge one.
 *
 * `order` puts 2nd–1st–3rd on screen while the DOM stays in rank order.
 */
const PLACES = [
  { fill: palette.warnFill, height: '6.5rem', order: 'order-2' },
  { fill: palette.silver, height: '4.5rem', order: 'order-1' },
  { fill: palette.bronze, height: '3.25rem', order: 'order-3' },
]

/** Shown once the session has ended. The only celebration surface in the app. */
function Recap({ view, table }: { view: View; table: Standing[] }) {
  const { session, players, matches } = view
  const played = matches.filter((m) => m.ended_at)
  const [shared, setShared] = useState<'copied' | 'failed' | null>(null)
  const winner = table[0]
  const podium = table.slice(0, 3)

  return (
    <div className="mt-6 space-y-3">
      {/* The eyebrow says what this is, so the headline is free to say who won
          — naming the person is the whole point of a recap. */}
      <div className="text-center">
        <Eyebrow className="inline-flex items-center gap-1.5 text-primary">
          <Sparkles size={12} strokeWidth={2.5} aria-hidden />
          Session wrapped
        </Eyebrow>
        <h2 className="mt-1.5 text-display font-bold text-balance text-ink">
          {winner ? `${winner.name} took the night!` : 'That’s a wrap!'}
        </h2>
        <p className="mt-1 text-meta text-muted">{session.name}</p>
      </div>

      {winner && (
        <Card className="kq-pop relative overflow-hidden bg-tint ring-1 ring-primary/12">
          <Trophy
            size={130}
            strokeWidth={1.25}
            aria-hidden
            className="pointer-events-none absolute -right-5 -bottom-7 text-primary/10"
          />
          <div className="relative flex items-center gap-3">
            <span className="relative">
              <Crown
                size={22}
                aria-hidden
                className="absolute -top-3 -left-1 -rotate-12 text-warn-fill"
                fill="currentColor"
              />
              <Avatar id={winner.memberId} name={winner.name} size="lg" ring />
            </span>
            <div className="min-w-0 flex-1">
              <Pill tone="neutral">#1</Pill>
              <p className="mt-1.5 truncate text-title font-semibold text-ink">{winner.name}</p>
              {/* The win/loss trio that used to sit here is on the podium now,
                  for all three players. What's left is the one number nothing
                  else on this screen states.
                  ponytail: raw wins/games, not the shrunk `rate` the table
                  ranks on — a recap celebrates what actually happened, and
                  RankingNote explains why the table disagrees. */}
              <p className="tnum text-meta text-muted">
                {Math.round((winner.wins / Math.max(1, winner.games)) * 100)}% win rate · out of{' '}
                {table.length} players
              </p>
            </div>
          </div>
        </Card>
      )}

      {podium.length > 1 && (
        // pb-0 stands the blocks on the card's bottom edge; overflow-hidden
        // lets the card's own radius clip their square corners.
        <Card className="overflow-hidden pb-0">
          <Eyebrow>Podium</Eyebrow>
          {/* items-end is what makes the staircase: unequal blocks push each
              column's name and avatar to a different height for free. */}
          <ol aria-label="Podium" className="mt-4 flex items-end justify-center gap-2">
            {podium.map((row, i) => {
              const { fill, height, order } = PLACES[i]
              const first = i === 0
              return (
                <li
                  key={row.memberId}
                  className={`flex min-w-0 flex-1 flex-col items-center ${order}`}
                >
                  <Avatar id={row.memberId} name={row.name} size={first ? 'lg' : 'md'} />
                  <p className="mt-1.5 w-full truncate text-center text-meta font-medium text-ink">
                    {row.name}
                  </p>
                  {/* W–L, not "1 win": on a club night the top three are often
                      level on wins and the old label said nothing. */}
                  <p className="tnum text-caption text-muted">
                    {row.wins}–{row.losses}
                  </p>
                  <div
                    className="kq-grow mt-2 flex w-full items-center justify-center rounded-t-xl"
                    style={{
                      height,
                      backgroundColor: fill,
                      animationDelay: `${(3 - i) * 0.12}s`,
                    }}
                  >
                    <span
                      className={`tnum font-bold text-ink ${first ? 'text-display' : 'text-title'}`}
                    >
                      {i + 1}
                    </span>
                  </div>
                </li>
              )
            })}
          </ol>
        </Card>
      )}

      <Eyebrow className="pt-2">Session stats</Eyebrow>
      <div className="grid grid-cols-4 gap-2">
        <StatCard icon={Clock} value={duration(session)} label="Duration" />
        <StatCard icon={Trophy} value={played.length} label="Matches" tone="good" />
        <StatCard icon={Users} value={players.length} label="Players" />
        <StatCard icon={LayoutGrid} value={session.court_count} label="Courts" />
      </div>

      <Button
        // `brand` is the on-dark green. This sits on the page, so `primary`.
        variant="primary"
        full
        icon={shared === 'copied' ? Check : Share2}
        onClick={() => {
          void shareLink(location.href, `${session.name} — session wrapped`).then((outcome) => {
            if (outcome === 'shared') return
            setShared(outcome)
            setTimeout(() => setShared(null), 2000)
          })
        }}
      >
        {shared === 'copied'
          ? 'Link copied'
          : shared === 'failed'
            ? 'Copy failed — long-press the address bar'
            : 'Share recap'}
      </Button>
    </div>
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
      <div className="flex items-center justify-between gap-2 text-caption font-semibold uppercase text-muted">
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
            <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setFixing(true)}>
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
