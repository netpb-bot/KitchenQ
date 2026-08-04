import { Link } from 'react-router-dom'
import { CalendarDays, ChevronRight, KeyRound, Plus } from 'lucide-react'
import {
  listClubs,
  listOpenSessions,
  myMemberships,
  useAsync,
  type Session,
} from '../lib/db'
import { Avatar } from '../components/Avatar'
import {
  Card,
  DarkCard,
  EmptyState,
  ErrorNote,
  Loading,
  Pill,
  Screen,
  SectionHeading,
} from '../components/ui'

export function Home() {
  const [view] = useAsync(async () => {
    const clubs = await listClubs()
    const [sessions, memberships] = await Promise.all([
      listOpenSessions(clubs.map((c) => c.id)),
      myMemberships(),
    ])
    return { clubs, sessions, memberships }
  }, [])

  const me = view.data?.memberships[0] ?? null

  return (
    <Screen title="KitchenQ" subtitle="Queue · Rankings · Fees">
      {view.error && <ErrorNote>{view.error}</ErrorNote>}

      <SectionHeading>Get started</SectionHeading>
      <div className="space-y-3">
        <ActionCard
          to="/clubs"
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

      <SectionHeading>Tonight</SectionHeading>
      {view.loading ? (
        <Loading />
      ) : view.data!.sessions.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          message="No session running."
          hint="Sessions your clubs have open show up here."
        />
      ) : (
        <div className="space-y-3">
          {view.data!.sessions.map((s) => (
            <SessionCard key={s.id} session={s} />
          ))}
        </div>
      )}

      <SectionHeading>Your player card</SectionHeading>
      <DarkCard className="flex items-center gap-4">
        <Avatar name={me?.display_name ?? '?'} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-white">
            {me?.display_name ?? 'Not a member yet'}
          </p>
          <p className="mt-0.5 text-sm text-white/70">
            {me
              ? `${me.skill_tier} · ${view.data!.clubs.length} ${view.data!.clubs.length === 1 ? 'club' : 'clubs'}`
              : 'Join a club to start tracking matches.'}
          </p>
        </div>
      </DarkCard>
    </Screen>
  )
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
