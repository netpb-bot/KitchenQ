import { useEffect, useRef, useState, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarDays,
  ChevronRight,
  KeyRound,
  ListOrdered,
  Percent,
  Plus,
  Swords,
  Trophy,
  Wallet,
  WifiOff,
} from 'lucide-react'
import {
  TIER_LABEL,
  duration,
  listClubMatches,
  listClubs,
  listMembers,
  listMyLedger,
  listOpenSessions,
  money,
  myMemberships,
  useAsync,
  type Club,
  type Member,
  type Session,
} from '../lib/db'
import { standings, type Standing } from '../lib/standings'
import { Avatar } from '../components/Avatar'
import { ConnectionBanner, isUnreachable, useOffline } from '../components/ConnectionBanner'
import { InstallPrompt } from '../components/InstallPrompt'
import { firstName } from '../components/MatchRow'
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

export function Home() {
  const offline = useOffline()
  const [view, reload] = useAsync(async () => {
    const clubs = await listClubs()
    const [sessions, memberships] = await Promise.all([
      listOpenSessions(clubs.map((c) => c.id)),
      myMemberships(),
    ])
    const me = memberships[0] ?? null
    // The record on this card is club-scoped: a rating only means something
    // against the people you actually play. Profile lets you switch clubs.
    const [ledger, members, matches] = await Promise.all([
      listMyLedger(memberships.map((m) => m.id)),
      me ? listMembers(me.club_id) : Promise.resolve([]),
      me ? listClubMatches(me.club_id) : Promise.resolve([]),
    ])
    const club = clubs.find((c) => c.id === me?.club_id) ?? null
    const table = standings(
      members.map((m) => ({ memberId: m.id, name: m.display_name })),
      matches,
    )
    return {
      clubs,
      sessions,
      me,
      club,
      record: table.find((r) => r.memberId === me?.id) ?? null,
      rank: table.findIndex((r) => r.memberId === me?.id) + 1,
      ledger,
    }
  }, [])

  const d = view.data
  // The greeting is the lead, not the h1. As the h1 it made RouteFocus announce
  // "Good evening, Ken" as the name of the page on every return to Home.
  const greeting = d?.me ? `${timeOfDay()}, ${firstName(d.me.display_name)}` : null
  // `loading` is false on failure too, so every block below has to key off the
  // data itself — keying off `loading` alone is what made an error blank the app.
  const ready = Boolean(d)
  const unreachable = offline || isUnreachable(view.error)

  // ponytail: one currency, the primary club's. A player in two clubs on two
  // currencies would need this split per club — nobody is, yet.
  const owed = (d?.ledger ?? []).reduce(
    (sum, e) => sum + Math.max(0, e.amount_due - e.amount_paid),
    0,
  )
  const unpaidSessions = (d?.ledger ?? []).filter((e) => e.amount_due > e.amount_paid).length

  // Mid-session, this is the only thing on Home anyone wants. It rides above the
  // greeting so it is reachable without a scroll, and drops out of the Tonight
  // list below so the same session is not offered twice.
  const liveNow = d?.sessions.find((s) => s.status === 'live') ?? null
  const tonight = (d?.sessions ?? []).filter((s) => s.id !== liveNow?.id)

  // Once the live card leaves the top of the screen it comes back as a strip.
  const liveCard = useRef<HTMLAnchorElement>(null)
  const pastLiveCard = useScrolledPast(liveCard, Boolean(liveNow))

  return (
    <Screen
      title={d?.me ? 'Ready for your next match?' : 'Welcome to KitchenQ'}
      subtitle={d?.me ? undefined : 'Queue · Rankings · Fees'}
      // A greeting and a question are worth reading once, not worth a third of
      // the viewport for the whole scroll. Only the live session pins here, and
      // only once you have scrolled past its card.
      sticky={false}
      // -mb-4 pulls the greeting down onto the title: Screen's title row owns a
      // pt-5 that otherwise leaves the two reading as separate blocks.
      lead={
        greeting && <p className="-mb-4 pt-5 text-meta font-medium text-muted">{greeting}</p>
      }
    >
      {liveNow && pastLiveCard && <LiveNowStrip session={liveNow} />}

      {/* First thing in the body, not in the header: the header is greeting +
          title, and a black card wedged above the greeting made the screen open
          on its loudest element with the salutation as its caption. */}
      {liveNow && <LiveNowCard ref={liveCard} session={liveNow} />}

      {/* An unreachable server has its own plain-language banner; repeating it
          as "TypeError: Failed to fetch" tells the player nothing they can act
          on. Anything else is a real error and is shown as one. */}
      {view.error && !unreachable && <ErrorNote onRetry={reload}>{view.error}</ErrorNote>}
      <ConnectionBanner error={view.error} />
      <InstallPrompt />

      <SectionHeading>Tonight</SectionHeading>
      {view.loading ? (
        <Loading />
      ) : !ready ? (
        <EmptyState
          icon={unreachable ? WifiOff : CalendarDays}
          message={
            unreachable ? 'Tonight will show up once you have signal.' : "Couldn't load your sessions."
          }
          action={
            unreachable ? undefined : (
              <Button variant="secondary" size="sm" onClick={reload}>
                Try again
              </Button>
            )
          }
        />
      ) : tonight.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          message={liveNow ? 'Nothing else on tonight.' : 'No session running.'}
          hint="Sessions your clubs have open show up here."
        />
      ) : (
        <div className="kq-stagger space-y-3">
          {tonight.map((s) => (
            <SessionCard key={s.id} session={s} />
          ))}
        </div>
      )}

      <SectionHeading>Get started</SectionHeading>
      <div className="space-y-3">
        <ActionCard
          // Straight to the club when there is only one — the list would be a
          // single row standing between the host and the New button. With none,
          // straight into the create form: this card already promises it.
          to={
            d?.clubs.length === 1
              ? `/clubs/${d.clubs[0].id}`
              : d?.clubs.length === 0
                ? '/clubs?new=1'
                : '/clubs'
          }
          icon={Plus}
          title="Host a session"
          // The single-club path lands on the club, where the session form is.
          // With none or several it lands on the list first, and promising the
          // court settings there would be a lie.
          detail={
            d?.clubs.length === 1
              ? 'Set your courts and share the join code.'
              : d?.clubs.length === 0
                ? 'Create a club first — it takes one field.'
                : 'Pick which club is playing tonight.'
          }
          // Only one black card on screen at a time — while a session is live
          // that card is the live one, and two of them shouting cancel out.
          dark={!liveNow}
        />
        <ActionCard
          to="/join"
          icon={KeyRound}
          title="Join with a code"
          detail="Hop into a session someone else is running."
        />
      </div>

      <SectionHeading>Your player card</SectionHeading>
      {view.loading || !ready ? <Loading /> : <PlayerCard data={d!} />}

      {ready && owed > 0 && d!.club && (
        <>
          <SectionHeading>You owe</SectionHeading>
          <Link to={`/clubs/${d!.club.id}`} className="block">
            <Card interactive className="flex items-center gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-warn-tint text-warn">
                <Wallet size={19} strokeWidth={2} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="tnum text-title font-semibold text-warn">
                  {money(owed, d!.club.currency)}
                </p>
                <p className="tnum mt-0.5 text-meta text-muted">
                  Across {unpaidSessions} {unpaidSessions === 1 ? 'session' : 'sessions'}
                </p>
              </div>
              <ChevronRight size={18} className="text-muted" aria-hidden />
            </Card>
          </Link>
        </>
      )}
    </Screen>
  )
}

/**
 * The first thing in the body while a session is running: one tap back into the
 * night in progress. It used to be a row in the Tonight list, which meant the
 * app's most urgent state looked exactly like its least urgent.
 *
 * "LIVE NOW" is its own line rather than the head of a run-on uppercase meta
 * line — the status is the label, the courts and clock are the detail.
 *
 * ponytail: elapsed time is rendered once on mount, not ticked. Home remounts
 * on every navigation back to it, and this is ambient context, not a stopwatch
 * — the running one lives on the court card where a match is actually timed.
 */
function LiveNowCard({
  session,
  ref,
}: {
  session: Session
  ref?: RefObject<HTMLAnchorElement | null>
}) {
  return (
    <Link ref={ref} to={`/session/${session.id}`} className="mt-5 block">
      <DarkCard watermark={Swords} className="transition-transform active:scale-[0.99]">
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-caption font-semibold uppercase text-brand">
              <span className="kq-pulse h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
              Live now
            </p>
            <p className="mt-1.5 truncate text-title font-semibold text-white">{session.name}</p>
            <p className="tnum mt-0.5 truncate text-meta text-white/60">
              {session.court_count} {session.court_count === 1 ? 'court' : 'courts'}
              {session.started_at && ` · ${duration(session)} in`}
            </p>
          </div>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-fill-on-dark text-white">
            <ChevronRight size={19} strokeWidth={2} aria-hidden />
          </span>
        </div>
      </DarkCard>
    </Link>
  )
}

/**
 * The live card, compressed to a bar, once the real one has scrolled off the
 * top. Nothing else on Home is worth pinning — the header scrolls away with the
 * content — so this appears against page content rather than under a chrome bar
 * and carries its own dark surface to say it is not part of the list below.
 */
function LiveNowStrip({ session }: { session: Session }) {
  return (
    <Link
      to={`/session/${session.id}`}
      // Fixed, so it must re-do the shell's centred column itself — the same
      // inset-x-0 + mx-auto + max-w trio UndoBar uses at the other end.
      className="kq-rise fixed inset-x-0 top-0 z-30 mx-auto w-full max-w-[30rem] bg-surface-dark pt-[env(safe-area-inset-top)] text-white shadow-pop"
    >
      <span className="flex items-center gap-2.5 px-5 py-3">
        <span className="kq-pulse h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-meta font-medium">{session.name}</span>
        {session.started_at && (
          <span className="tnum shrink-0 text-caption text-white/60">{duration(session)}</span>
        )}
        <ChevronRight size={17} className="shrink-0 text-white/55" aria-hidden />
      </span>
    </Link>
  )
}

/**
 * True once `ref`'s element has scrolled off the top of the viewport. An
 * observer rather than a scroll handler: no listener firing on every frame of
 * every scroll to compute something that changes twice.
 *
 * `enabled` is what re-runs this when the async data lands — the observed card
 * does not exist on the first render, so the ref is still null then.
 */
function useScrolledPast(ref: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [past, setPast] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!enabled || !el) {
      setPast(false)
      return
    }
    // The card sits at the top of the body, so the only way out of view is up.
    const io = new IntersectionObserver(([entry]) => setPast(!entry.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [ref, enabled])

  return past
}

/** Name, tier and the record — the answer to "what have I actually done?". */
function PlayerCard({
  data,
}: {
  data: { me: Member | null; club: Club | null; record: Standing | null; rank: number }
}) {
  const { me, club, record, rank } = data

  if (!me) {
    return (
      <DarkCard className="flex items-center gap-4">
        <Avatar name="?" size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-body font-medium text-white">Not a member yet</p>
          <p className="mt-1 text-meta text-white/70">
            Join a club to start tracking matches.
          </p>
        </div>
      </DarkCard>
    )
  }

  return (
    <Link to="/profile" className="block">
      <DarkCard watermark={Swords} className="transition-transform active:scale-[0.99]">
        <div className="flex items-center gap-4">
          <Avatar name={me.display_name} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-medium text-white">{me.display_name}</p>
            <div className="mt-2 flex items-center gap-2">
              <Pill tone="onDark">{TIER_LABEL[me.skill_tier]}</Pill>
              {club && <span className="truncate text-meta text-white/70">{club.name}</span>}
            </div>
          </div>
          <ChevronRight size={18} className="text-white/55" aria-hidden />
        </div>

        {record ? (
          <div className="mt-5 grid grid-cols-4 gap-2 border-t border-white/10 pt-5">
            <StatTile icon={Swords} value={record.games} label="Games" tone="onDark" />
            <StatTile icon={Trophy} value={record.wins} label="Wins" tone="onDark" />
            <StatTile
              icon={Percent}
              value={Math.round(record.rate * 100)}
              label="Win rate"
              tone="onDark"
            />
            <StatTile icon={ListOrdered} value={`#${rank}`} label="Club rank" tone="onDark" />
          </div>
        ) : (
          <p className="mt-5 border-t border-white/10 pt-5 text-meta text-white/70">
            No matches yet — your record starts with your first recorded score.
          </p>
        )}
      </DarkCard>
    </Link>
  )
}

function timeOfDay(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function SessionCard({ session }: { session: Session }) {
  return (
    <Link to={`/session/${session.id}`} className="block">
      {/* No live-ring here any more: a running session is pinned to the top of
          the screen by LiveNowBar, so this list is the not-yet-started ones. */}
      <Card interactive className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-ink">{session.name}</p>
          <p className="tnum mt-0.5 text-meta text-muted">
            {session.court_count} {session.court_count === 1 ? 'court' : 'courts'} · code{' '}
            {session.join_code}
          </p>
        </div>
        {session.status === 'live' ? (
          <Pill tone="live" dot>
            LIVE
          </Pill>
        ) : (
          <Pill tone="warn">Not started</Pill>
        )}
        <ChevronRight size={18} className="text-muted" aria-hidden />
      </Card>
    </Link>
  )
}

function ActionCard({
  to,
  icon: Icon,
  title,
  detail,
  dark,
}: {
  to: string
  icon: typeof Plus
  title: string
  detail: string
  dark?: boolean
}) {
  return (
    <Link to={to} className="block">
      {dark ? (
        <DarkCard
          watermark={Icon}
          className="flex items-center gap-4 transition-transform active:scale-[0.99]"
        >
          <ActionBody icon={Icon} title={title} detail={detail} dark />
        </DarkCard>
      ) : (
        <Card interactive className="flex items-center gap-4">
          <ActionBody icon={Icon} title={title} detail={detail} />
        </Card>
      )}
    </Link>
  )
}

function ActionBody({
  icon: Icon,
  title,
  detail,
  dark,
}: {
  icon: typeof Plus
  title: string
  detail: string
  dark?: boolean
}) {
  return (
    <>
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${dark ? 'bg-fill-on-dark text-accent' : 'bg-fill text-ink'}`}
      >
        <Icon size={19} strokeWidth={2} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-body font-medium ${dark ? 'text-white' : 'text-ink'}`}>{title}</p>
        <p className={`mt-0.5 text-meta ${dark ? 'text-white/70' : 'text-muted'}`}>{detail}</p>
      </div>
      <ChevronRight size={18} className={dark ? 'text-white/55' : 'text-muted'} aria-hidden />
    </>
  )
}
