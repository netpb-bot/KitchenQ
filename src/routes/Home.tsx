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
  const [view] = useAsync(async () => {
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
  const greeting = d?.me ? `${timeOfDay()}, ${firstName(d.me.display_name)}` : 'KitchenQ'
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

  return (
    <Screen
      title={greeting}
      subtitle={d?.me ? 'Ready for your next match?' : 'Queue · Rankings · Fees'}
    >
      {/* An unreachable server has its own plain-language banner; repeating it
          as "TypeError: Failed to fetch" tells the player nothing they can act
          on. Anything else is a real error and is shown as one. */}
      {view.error && !unreachable && <ErrorNote>{view.error}</ErrorNote>}
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
          hint={unreachable ? undefined : 'Reload the page to try again.'}
        />
      ) : d!.sessions.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          message="No session running."
          hint="Sessions your clubs have open show up here."
        />
      ) : (
        <div className="space-y-3">
          {d!.sessions.map((s) => (
            <SessionCard key={s.id} session={s} />
          ))}
        </div>
      )}

      <SectionHeading>Get started</SectionHeading>
      <div className="space-y-3">
        <ActionCard
          // Straight to the club when there is only one — the list would be a
          // single row standing between the host and the New button.
          to={d?.clubs.length === 1 ? `/clubs/${d.clubs[0].id}` : '/clubs'}
          icon={Plus}
          title="Host a session"
          detail="Set your courts and share the join code."
          dark
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
            <Card className="flex items-center gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-danger-tint text-danger">
                <Wallet size={20} strokeWidth={2.25} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="tnum font-semibold text-danger">
                  {money(owed, d!.club.currency)}
                </p>
                <p className="tnum mt-0.5 text-sm text-muted">
                  Across {unpaidSessions} {unpaidSessions === 1 ? 'session' : 'sessions'}
                </p>
              </div>
              <ChevronRight size={20} className="text-muted" aria-hidden />
            </Card>
          </Link>
        </>
      )}
    </Screen>
  )
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
          <p className="font-semibold text-white">Not a member yet</p>
          <p className="mt-0.5 text-sm text-white/70">
            Join a club to start tracking matches.
          </p>
        </div>
      </DarkCard>
    )
  }

  return (
    <Link to="/profile" className="block">
      <DarkCard>
        <div className="flex items-center gap-4">
          <Avatar name={me.display_name} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-white">{me.display_name}</p>
            <div className="mt-1.5 flex items-center gap-2">
              <Pill tone="onDark">{me.skill_tier}</Pill>
              {club && <span className="truncate text-sm text-white/70">{club.name}</span>}
            </div>
          </div>
          <ChevronRight size={20} className="text-white/50" aria-hidden />
        </div>

        {record ? (
          <div className="mt-4 grid grid-cols-4 gap-2 border-t border-white/10 pt-4">
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
          <p className="mt-4 border-t border-white/10 pt-4 text-sm text-white/70">
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
      <Card className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-ink">{session.name}</p>
          <p className="tnum mt-0.5 text-sm text-muted">
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
        <ChevronRight size={20} className="text-muted" aria-hidden />
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
  const Surface = dark ? DarkCard : Card
  return (
    <Link to={to} className="block">
      <Surface className="flex items-center gap-4">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${dark ? 'bg-white/15 text-accent' : 'bg-tint text-primary'}`}
        >
          <Icon size={20} strokeWidth={2.25} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className={`font-semibold ${dark ? 'text-white' : 'text-ink'}`}>{title}</p>
          <p className={`mt-0.5 text-sm ${dark ? 'text-white/70' : 'text-muted'}`}>{detail}</p>
        </div>
        <ChevronRight size={20} className={dark ? 'text-white/50' : 'text-muted'} aria-hidden />
      </Surface>
    </Link>
  )
}
