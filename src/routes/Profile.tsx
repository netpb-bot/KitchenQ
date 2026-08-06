import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ChevronRight,
  CalendarDays,
  Camera,
  ListOrdered,
  Pencil,
  Percent,
  Sigma,
  Swords,
  Trophy,
  XCircle,
} from 'lucide-react'
import {
  TIERS,
  TIER_LABEL,
  lastName,
  listClubMatches,
  listClubs,
  listMembers,
  listSessions,
  myMemberships,
  updateMember,
  useAction,
  useAsync,
  type Member,
  type Tier,
} from '../lib/db'
import { playerMatches, standings, type PlayerMatch } from '../lib/standings'
import { Avatar } from '../components/Avatar'
import { AvatarPicker } from '../components/AvatarPicker'
import { MatchResult } from '../components/MatchRow'
import { RankingNote } from '../components/StandingsList'
import {
  Button,
  Card,
  DarkCard,
  EmptyState,
  ErrorNote,
  Field,
  Input,
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

  const [view, reload] = useAsync(async () => {
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
        <ErrorNote onRetry={reload}>{view.error}</ErrorNote>
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
        <ProfileHero me={me} record={record ?? null} onChanged={reload} />
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
                className="inline-flex min-h-11 items-center gap-1 text-meta font-medium text-primary"
              >
                Standings
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
            <p className="tnum mt-3 text-center text-meta text-muted">
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
  onChanged,
}: {
  me: Member
  record: { games: number; wins: number; losses: number; rate: number } | null
  onChanged: () => void
}) {
  // One panel at a time: the photo cropper and the name form both open in the
  // same slot, and two of them at once is a card taller than the screen.
  const [panel, setPanel] = useState<'none' | 'name' | 'photo'>('none')
  const editing = panel === 'name'

  return (
    <DarkCard watermark={Swords}>
      <div className="flex items-center gap-4">
        <button
          type="button"
          aria-label="Change your profile photo"
          aria-expanded={panel === 'photo'}
          onClick={() => setPanel((p) => (p === 'photo' ? 'none' : 'photo'))}
          className="relative shrink-0 rounded-full transition-transform active:scale-95"
        >
          <Avatar id={me.id} name={me.display_name} size="xl" />
          {/* The glyph is dark on the brand fill, like every `brand` button —
              written as surface-dark rather than ink because this badge lives
              inside a DarkCard, where theme.test bans ink outright. Same
              colour to the eye, and it cannot be copied onto the card itself. */}
          <span className="absolute -right-0.5 -bottom-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand text-surface-dark ring-2 ring-surface-dark">
            <Camera size={14} strokeWidth={2.5} aria-hidden />
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-title font-semibold text-white">{me.display_name}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Pill tone="onDark">{TIER_LABEL[me.skill_tier]}</Pill>
            {me.role !== 'member' && (
              <Pill tone="onDark">{me.role === 'owner' ? 'Owner' : 'Co-host'}</Pill>
            )}
          </div>
        </div>
        {/* Nobody could change their own name or level anywhere in the app: a
            host could rename guests, but never themselves. */}
        {!editing && (
          <Button
            variant="ghostOnDark"
            size="sm"
            icon={Pencil}
            className="shrink-0 px-2"
            aria-label="Edit your name and level"
            onClick={() => setPanel('name')}
          />
        )}
      </div>

      {editing && (
        <SelfEdit
          me={me}
          onDone={() => setPanel('none')}
          onChanged={() => {
            setPanel('none')
            onChanged()
          }}
        />
      )}

      {panel === 'photo' && (
        <AvatarPicker
          hasPhoto={Boolean(me.avatar_url)}
          onDone={() => setPanel('none')}
          onSaved={() => {
            setPanel('none')
            onChanged()
          }}
        />
      )}

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

/**
 * Rename yourself, and set your own level. Scoped to one club membership on
 * purpose — the same person can be "Ken" at one club and "Kenneth A." at
 * another, and the level that matters is the one their club plays them at.
 */
function SelfEdit({
  me,
  onDone,
  onChanged,
}: {
  me: Member
  onDone: () => void
  onChanged: () => void
}) {
  const [name, setName] = useState(me.display_name)
  const [tier, setTier] = useState<Tier>(me.skill_tier)
  const [busy, error, run] = useAction()

  const dirty = name.trim() !== me.display_name || tier !== me.skill_tier

  return (
    <form
      className="kq-rise mt-4 space-y-3 border-t border-white/10 pt-4"
      onSubmit={(e) => {
        e.preventDefault()
        run(async () => {
          await updateMember(me.id, { display_name: name.trim(), skill_tier: tier })
          lastName.set(name.trim())
          onChanged()
        })
      }}
    >
      <label className="block">
        <span className="text-caption font-semibold uppercase text-white/55">Your name</span>
        <span className="mt-1 block text-meta text-white/55">
          Shown on the queue, the courts and the standings.
        </span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          autoFocus
          required
          className="mt-1.5"
        />
      </label>
      <label className="block">
        <span className="text-caption font-semibold uppercase text-white/55">Skill level</span>
        <Select
          value={tier}
          onChange={(e) => setTier(e.target.value as Tier)}
          className="mt-1.5"
        >
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {TIER_LABEL[t]}
            </option>
          ))}
        </Select>
      </label>
      {error && (
        <p role="alert" className="text-meta font-medium text-danger-on-dark">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="brand" full loading={busy} disabled={!dirty || !name.trim()}>
          Save
        </Button>
        <Button type="button" variant="ghostOnDark" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
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
            <p className="truncate text-caption font-semibold uppercase text-muted">{sessionName}</p>
            <p className="tnum mt-0.5 text-meta text-muted">
              {new Date(match.ended_at!).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </p>
          </div>
          {/* A loss is finished, not outstanding — amber said it still needed
              doing something about. */}
          <Pill tone={played.won ? 'good' : 'neutral'}>{played.won ? 'Won' : 'Lost'}</Pill>
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
