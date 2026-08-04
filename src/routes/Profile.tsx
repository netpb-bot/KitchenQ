import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ChevronRight,
  CalendarDays,
  ListOrdered,
  Percent,
  Sigma,
  Swords,
  Trophy,
  XCircle,
} from 'lucide-react'
import {
  listClubMatches,
  listClubs,
  listMembers,
  listSessions,
  myMemberships,
  useAsync,
  type Member,
} from '../lib/db'
import { playerMatches, standings, type PlayerMatch } from '../lib/standings'
import { TIER_LABEL } from '../components/AddGuestForm'
import { Avatar } from '../components/Avatar'
import { MatchResult } from '../components/MatchRow'
import { RankingNote } from '../components/StandingsList'
import {
  Card,
  DarkCard,
  EmptyState,
  ErrorNote,
  Field,
  Loading,
  Pill,
  Screen,
  SectionHeading,
  Select,
  StatTile,
} from '../components/ui'

/** How many of a player's matches the record shows before it stops being a record. */
const RECENT_MATCHES = 10

export function Profile() {
  const [clubId, setClubId] = useState<string | null>(null)

  const [view] = useAsync(async () => {
    const memberships = await myMemberships()
    const me = memberships.find((m) => m.club_id === clubId) ?? memberships[0] ?? null
    if (!me) return { memberships, me: null, clubNames: new Map<string, string>() }

    const [members, matches, sessions, clubs] = await Promise.all([
      listMembers(me.club_id),
      listClubMatches(me.club_id),
      listSessions(me.club_id),
      listClubs(),
    ])
    const table = standings(
      members.map((m) => ({ memberId: m.id, name: m.display_name })),
      matches,
    )
    return {
      memberships,
      me,
      clubNames: new Map(clubs.map((c) => [c.id, c.name])),
      names: new Map(members.map((m) => [m.id, m.display_name])),
      sessionNames: new Map(sessions.map((s) => [s.id, s.name])),
      record: table.find((r) => r.memberId === me.id) ?? null,
      rank: table.findIndex((r) => r.memberId === me.id) + 1,
      fieldSize: table.length,
      mine: playerMatches(me.id, matches),
    }
  }, [clubId])

  if (view.loading) {
    return (
      <Screen title="Profile">
        <Loading />
      </Screen>
    )
  }
  if (view.error) {
    return (
      <Screen title="Profile">
        <ErrorNote>{view.error}</ErrorNote>
      </Screen>
    )
  }

  const { memberships, me, clubNames } = view.data!

  if (!me) {
    return (
      <Screen title="Profile">
        <EmptyState
          icon={Trophy}
          message="You're not in a club yet."
          hint="Join one with a code, or create your own from the Clubs tab."
        />
      </Screen>
    )
  }

  const { names, sessionNames, record, rank, fieldSize, mine } = view.data!
  const sessionsPlayed = new Set(mine!.map((m) => m.match.session_id)).size

  return (
    <Screen title="Profile">
      {memberships.length > 1 && (
        <div className="mt-2">
          <Field label="Club">
            <Select
              value={me.club_id}
              onChange={(e) => setClubId(e.target.value)}
              aria-label="Club these stats cover"
            >
              {memberships.map((m) => (
                <option key={m.id} value={m.club_id}>
                  {clubNames.get(m.club_id) ?? 'Club'}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}

      <div className="mt-4">
        <ProfileHero me={me} record={record ?? null} />
      </div>

      {record ? (
        <>
          <Card className="mt-3 grid grid-cols-3 gap-2">
            <StatTile icon={ListOrdered} value={`#${rank}`} label={`of ${fieldSize}`} />
            <StatTile icon={CalendarDays} value={sessionsPlayed} label="Sessions" />
            <StatTile
              icon={Sigma}
              value={`${record.diff >= 0 ? '+' : ''}${record.diff}`}
              label="Point diff"
            />
          </Card>
          <RankingNote />

          <SectionHeading
            action={
              <Link
                to={`/clubs/${me.club_id}`}
                className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary"
              >
                Leaderboard
                <ChevronRight size={16} aria-hidden />
              </Link>
            }
          >
            Recent matches
          </SectionHeading>
          <div className="space-y-3">
            {mine!.slice(0, RECENT_MATCHES).map((m) => (
              <PlayedMatch
                key={m.match.id}
                played={m}
                names={names!}
                sessionName={sessionNames!.get(m.match.session_id) ?? 'Session'}
              />
            ))}
          </div>
          {mine!.length > RECENT_MATCHES && (
            <p className="tnum mt-3 text-center text-xs text-muted">
              Showing the last {RECENT_MATCHES} of {mine!.length} matches.
            </p>
          )}
        </>
      ) : (
        <>
          <SectionHeading>Record</SectionHeading>
          <EmptyState
            icon={Trophy}
            message="No matches yet."
            hint="Your record starts the first time a score is recorded for you."
          />
        </>
      )}
    </Screen>
  )
}

function ProfileHero({
  me,
  record,
}: {
  me: Member
  record: { games: number; wins: number; losses: number; rate: number } | null
}) {
  return (
    <DarkCard>
      <div className="flex items-center gap-4">
        <Avatar name={me.display_name} size="xl" />
        <div className="min-w-0">
          <p className="truncate text-lg font-bold text-white">{me.display_name}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Pill tone="onDark">{TIER_LABEL[me.skill_tier]}</Pill>
            {me.role !== 'member' && (
              <Pill tone="onDark">{me.role === 'owner' ? 'Owner' : 'Co-host'}</Pill>
            )}
          </div>
        </div>
      </div>

      {record && (
        <div className="mt-4 grid grid-cols-4 gap-2 border-t border-white/10 pt-4">
          <StatTile icon={Swords} value={record.games} label="Games" tone="onDark" />
          <StatTile icon={Trophy} value={record.wins} label="Wins" tone="onDark" />
          <StatTile icon={XCircle} value={record.losses} label="Losses" tone="onDark" />
          <StatTile
            icon={Percent}
            value={Math.round(record.rate * 100)}
            label="Win rate"
            tone="onDark"
          />
        </div>
      )}
    </DarkCard>
  )
}

/** One match from the player's own side, with the night it belonged to. */
function PlayedMatch({
  played,
  names,
  sessionName,
}: {
  played: PlayerMatch
  names: Map<string, string>
  sessionName: string
}) {
  const { match } = played
  return (
    <Link to={`/session/${match.session_id}/history`} className="block">
      <Card>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-muted">{sessionName}</p>
            <p className="tnum mt-0.5 text-xs text-muted">
              {new Date(match.ended_at!).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </p>
          </div>
          <Pill tone={played.won ? 'neutral' : 'warn'}>{played.won ? 'Won' : 'Lost'}</Pill>
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
      </Card>
    </Link>
  )
}
