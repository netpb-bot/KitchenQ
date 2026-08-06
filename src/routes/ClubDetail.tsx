import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Check,
  ChevronLeft,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Trophy,
  Users,
  X,
} from 'lucide-react'
import {
  TIERS,
  TIER_LABEL,
  createSession,
  deleteClub,
  getClub,
  isAdmin,
  isGuest,
  listClubLedger,
  listClubMatches,
  listMembers,
  listSessions,
  money,
  myMember,
  nameTaken,
  normalizeName,
  renameClub,
  updateMember,
  useAction,
  useAsync,
  type Club,
  type LedgerEntry,
  type Member,
  type Role,
  type Session,
  type Tier,
} from '../lib/db'
import { standings, type Standing } from '../lib/standings'
import { AddGuestForm } from '../components/AddGuestForm'
import { Avatar } from '../components/Avatar'
import { SessionCard } from '../components/SessionCard'
import { RankingNote, StandingsList } from '../components/StandingsList'
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Loading,
  Pill,
  Screen,
  SearchField,
  SectionHeading,
  Select,
  ShowAllRow,
  Tabs,
  useShowAll,
} from '../components/ui'

/**
 * Sessions, Standings, Dues and Members were four lists stacked on one page —
 * three of them the same twenty-eight names, five thousand pixels of scroll on a
 * normal club. They are tabs now: one list on screen, and the strip rides the
 * sticky header so switching never means scrolling back up.
 */
type Tab = 'sessions' | 'standings' | 'dues' | 'members'

export function ClubDetail() {
  const { clubId } = useParams<{ clubId: string }>()
  const id = clubId!

  // In parallel: six sequential round trips is most of a second on a phone.
  const [view, reload] = useAsync(async () => {
    const [club, me, members, sessions, ledger, matches] = await Promise.all([
      getClub(id),
      myMember(id),
      listMembers(id),
      listSessions(id),
      listClubLedger(id),
      listClubMatches(id),
    ])
    return { club, me, members, sessions, ledger, matches }
  }, [id])
  // Tab state is local, not a search param: Back should leave the club, which is
  // where it came from, rather than rewind through four tabs first.
  const [tab, setTab] = useState<Tab>('sessions')

  if (view.loading) return <Screen title="Club"><Loading /></Screen>
  if (view.error)
    return (
      <Screen title="Club">
        <ErrorNote onRetry={reload}>{view.error}</ErrorNote>
      </Screen>
    )

  const { club, me, members, sessions, ledger, matches } = view.data!
  const admin = isAdmin(me)
  const table = standings(
    members.map((m) => ({ memberId: m.id, name: m.display_name })),
    matches,
  )
  const dues = duesRows(ledger, new Map(members.map((m) => [m.id, m.display_name])))

  const tabs = [
    { value: 'sessions' as const, label: 'Sessions', count: sessions.length },
    { value: 'standings' as const, label: 'Standings' },
    // Only worth a tab once there is money on the books. The count is the number
    // of people who owe, which is the number a host acts on.
    ...(ledger.length > 0
      ? [{ value: 'dues' as const, label: admin ? 'Dues' : 'Balance', count: dues.length }]
      : []),
    { value: 'members' as const, label: 'Members', count: members.length },
  ]
  // A tab can leave the strip under you — the last fee gets voided and Dues is
  // gone. Falling back beats a tablist with nothing selected.
  const active = tabs.some((t) => t.value === tab) ? tab : 'sessions'

  return (
    <Screen
      title={club.name}
      subtitle={`${members.length} ${members.length === 1 ? 'member' : 'members'}`}
      lead={
        <Link
          to="/clubs"
          className="-ml-1 inline-flex min-h-11 items-center gap-1 pt-3 text-meta font-medium text-muted"
        >
          <ChevronLeft size={18} aria-hidden />
          Clubs
        </Link>
      }
      tabs={<Tabs label="Club sections" value={active} onChange={setTab} options={tabs} />}
    >
      {active === 'sessions' && (
        <SessionsTab clubId={id} sessions={sessions} admin={admin} reload={reload} />
      )}
      {active === 'standings' && (
        <StandingsTab table={table} matchCount={matches.length} meId={me?.id} />
      )}
      {active === 'dues' && <DuesTab rows={dues} currency={club.currency} admin={admin} />}
      {active === 'members' && (
        <MembersTab
          club={club}
          sessionCount={sessions.length}
          members={members}
          me={me}
          admin={admin}
          reload={reload}
        />
      )}
    </Screen>
  )
}

/* --------------------------------------------------------------------- tabs */

function SessionsTab({
  clubId,
  sessions,
  admin,
  reload,
}: {
  clubId: string
  sessions: Session[]
  admin: boolean
  reload: () => void
}) {
  const [creating, setCreating] = useState(false)
  const [shown, showAll] = useShowAll(sessions, 8)

  return (
    <>
      {/* No "Sessions" heading: the tab you just tapped already says so, and a
          duplicate h2 is seventy pixels off the top of every tab on the one
          screen whose problem is height. Same reasoning in the other three. */}
      {admin && !creating && (
        <div className="mb-3 flex justify-end">
          <Button variant="secondary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
            New session
          </Button>
        </div>
      )}

      {creating && (
        <div className="mb-3">
          <CreateSessionForm
            clubId={clubId}
            onCancel={() => setCreating(false)}
            onCreated={() => {
              setCreating(false)
              reload()
            }}
          />
        </div>
      )}

      {sessions.length === 0 ? (
        <EmptyState
          message="No sessions yet."
          hint={
            admin
              ? 'Create one and share its join code with the club.'
              : 'A host will create one when the next open play is set.'
          }
        />
      ) : (
        <div className="kq-stagger space-y-3">
          {shown.map((s) => (
            <SessionCard key={s.id} session={s} />
          ))}
          {showAll && (
            <Card className="p-0">
              <ShowAllRow count={sessions.length} noun="sessions" onClick={showAll} />
            </Card>
          )}
        </div>
      )}
    </>
  )
}

/**
 * "Standings" everywhere. This table was called three different things across
 * the app — Ranks, Standings and Leaderboard — for one list.
 */
function StandingsTab({
  table,
  matchCount,
  meId,
}: {
  table: Standing[]
  matchCount: number
  meId?: string
}) {
  const [shown, showAll] = useShowAll(table, 10)

  if (table.length === 0)
    return (
      <EmptyState
        icon={Trophy}
        message="Nothing played yet."
        hint="The all-time table builds itself as sessions are scored."
      />
    )

  return (
    <>
      <p className="tnum mb-3 text-meta text-muted">
        All time · {matchCount} {matchCount === 1 ? 'match' : 'matches'}
      </p>
      <StandingsList table={shown} meId={meId}>
        {showAll && <ShowAllRow count={table.length} noun="players" onClick={showAll} />}
      </StandingsList>
      <RankingNote />
    </>
  )
}

export type DueRow = { memberId: string; name: string; owed: number; sessions: number }

/**
 * What the club is owed, across every session. RLS decides the scope, not this
 * component: a host gets every member's balance, a member gets only their own.
 *
 * Overpaid and settled lines drop out rather than netting off against what
 * someone still owes for a different night — a credit on one session is not a
 * payment on another, and the host is collecting per session.
 */
export function duesRows(ledger: LedgerEntry[], names: Map<string, string>): DueRow[] {
  const owing = new Map<string, { owed: number; sessions: number }>()
  for (const entry of ledger) {
    const outstanding = entry.amount_due - entry.amount_paid
    if (outstanding <= 0) continue
    const row = owing.get(entry.club_member_id) ?? { owed: 0, sessions: 0 }
    row.owed += outstanding
    row.sessions++
    owing.set(entry.club_member_id, row)
  }

  return [...owing.entries()]
    .map(([memberId, row]) => ({
      memberId,
      name: names.get(memberId) ?? 'Unknown',
      ...row,
    }))
    .sort((x, y) => y.owed - x.owed)
}

function DuesTab({
  rows,
  currency,
  admin,
}: {
  rows: DueRow[]
  currency: string
  admin: boolean
}) {
  const [query, setQuery] = useState('')

  if (rows.length === 0)
    return (
      <EmptyState
        icon={Check}
        message={admin ? 'Everyone is square.' : "You're all paid up."}
        hint={admin ? 'Nothing outstanding across any session.' : undefined}
      />
    )

  const total = rows.reduce((sum, r) => sum + r.owed, 0)
  const q = query.trim().toLowerCase()
  const shown = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows

  return (
    <>
      {/* The total used to sit under the list, which on a club this size meant
          scrolling twenty-eight rows to find out how much was outstanding. */}
      {admin && (
        <p className="tnum mb-3 text-meta text-muted">
          <span className="font-semibold text-ink">{money(total, currency)}</span> outstanding
          across {rows.length} {rows.length === 1 ? 'player' : 'players'}
        </p>
      )}

      {rows.length > 8 && (
        <div className="mb-3">
          <SearchField
            label="Search players who owe"
            placeholder="Search players"
            value={query}
            onChange={setQuery}
          />
        </div>
      )}

      {shown.length === 0 ? (
        <EmptyState message={`Nobody matching “${query.trim()}”.`} />
      ) : (
        <Card className="divide-y divide-hairline p-0">
          {shown.map((row) => (
            <div key={row.memberId} className="flex items-center gap-3 px-4 py-3">
              <Avatar id={row.memberId} name={row.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-medium text-ink">{row.name}</p>
                <p className="tnum mt-0.5 text-meta text-muted">
                  {row.sessions} unpaid {row.sessions === 1 ? 'session' : 'sessions'}
                </p>
              </div>
              <span className="tnum text-body font-semibold text-warn">
                {money(row.owed, currency)}
              </span>
            </div>
          ))}
        </Card>
      )}
    </>
  )
}

function MembersTab({
  club,
  sessionCount,
  members,
  me,
  admin,
  reload,
}: {
  club: Club
  sessionCount: number
  members: Member[]
  me: Member | null
  admin: boolean
  reload: () => void
}) {
  const clubId = club.id
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  // No cap here: this is the roster, and search — not a "show all" button — is
  // what you reach for when you came looking for one person.
  const shown = q ? members.filter((m) => m.display_name.toLowerCase().includes(q)) : members

  return (
    <>
      {members.length > 8 && (
        <div className="mb-3">
          <SearchField
            label="Search members"
            placeholder="Search members"
            value={query}
            onChange={setQuery}
          />
        </div>
      )}

      {members.length === 0 ? (
        <EmptyState icon={Users} message="No members yet." />
      ) : shown.length === 0 ? (
        <EmptyState message={`Nobody matching “${query.trim()}”.`} />
      ) : (
        <Card className="divide-y divide-hairline p-0">
          {shown.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              isMe={m.id === me?.id}
              canEdit={admin && m.role !== 'owner'}
              taken={members}
              onChanged={reload}
            />
          ))}
        </Card>
      )}

      {admin && (
        <>
          <SectionHeading>Add a guest</SectionHeading>
          <Card>
            <p className="mb-3 text-meta text-muted">
              For a regular who never brings a phone. They keep a record across
              sessions, and can take the name over themselves later with a join code.
            </p>
            {/* `members`, not `shown` — a name typed in the search box above
                must not narrow what counts as already taken. */}
            <AddGuestForm
              clubId={clubId}
              taken={members}
              onAdded={reload}
              submitLabel="Add guest"
            />
          </Card>

          {/* Last on the tab, deliberately: the destructive control should not
              sit above the things a host uses every week. */}
          <SectionHeading>Club settings</SectionHeading>
          <Card className="space-y-3">
            <RenameClub club={club} reload={reload} />
            {/* Owner only, matching clubs_delete in 0003 — a co-host tapping
                this would be refused by RLS anyway, so it is not rendered. */}
            {me?.role === 'owner' && (
              <div className="border-t border-hairline pt-3">
                <DeleteClub club={club} sessionCount={sessionCount} />
              </div>
            )}
          </Card>
        </>
      )}
    </>
  )
}

function RenameClub({ club, reload }: { club: Club; reload: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(club.name)
  const [busy, error, run] = useAction()

  if (!open)
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption font-semibold uppercase text-muted">Club name</p>
          <p className="mt-0.5 truncate text-body font-semibold text-ink">{club.name}</p>
        </div>
        <Button
          variant="ghost"
          icon={Pencil}
          className="shrink-0 px-2"
          aria-label="Rename club"
          onClick={() => {
            setName(club.name)
            setOpen(true)
          }}
        />
      </div>
    )

  return (
    <form
      className="kq-rise space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        run(async () => {
          await renameClub(club.id, name)
          reload()
          setOpen(false)
        })
      }}
    >
      {/* The slug keeps its original wording. Nothing links by it, so a rename
          that left it behind is invisible everywhere it could be noticed. */}
      <Field label="Club name">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
          maxLength={60}
        />
      </Field>
      {error && (
        <p role="alert" className="text-meta font-medium text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" full loading={busy} disabled={!name.trim()}>
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/**
 * Two taps is the confirmation for ending a session, which is reversible. This
 * is not: it takes every session, member, match and payment the club has. So it
 * asks for the club's name to be typed — the one confirmation that cannot be
 * cleared by a thumb moving faster than the person attached to it.
 *
 * Compared with normalizeName, the same trimmed/case-folded comparison the
 * database uses for member names: someone who types their own club's name
 * correctly should not be blocked by a capital letter or a trailing space.
 */
function DeleteClub({ club, sessionCount }: { club: Club; sessionCount: number }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, error, run] = useAction()

  if (!open)
    return (
      <Button variant="dangerQuiet" icon={Trash2} onClick={() => setOpen(true)}>
        Delete club
      </Button>
    )

  return (
    <form
      className="kq-rise space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        run(async () => {
          await deleteClub(club.id)
          navigate('/clubs')
        })
      }}
    >
      <p className="text-meta text-muted">
        {sessionCount === 0
          ? 'This club has no sessions yet.'
          : `This deletes ${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'} and everything recorded in ${sessionCount === 1 ? 'it' : 'them'} — matches, standings and fees.`}{' '}
        It cannot be undone.
      </p>
      <Field label={`Type “${club.name}” to confirm`}>
        <Input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoFocus
          aria-label={`Type ${club.name} to confirm`}
        />
      </Field>
      {error && (
        <p role="alert" className="text-meta font-medium text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="danger"
          full
          loading={busy}
          disabled={normalizeName(typed) !== normalizeName(club.name)}
        >
          Delete club
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setTyped('')
            setOpen(false)
          }}
          disabled={busy}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}

/**
 * One line per member, with the host's controls behind a tap.
 *
 * They used to sit in the row — a 44px tier `<select>` and a "Make co-host"
 * button — which wrapped onto a second line on a narrow phone and made this the
 * tallest row in the app. Twenty-eight of those is a screen and a half of
 * scrolling spent on controls nobody is currently using.
 */
function MemberRow({
  member,
  isMe,
  canEdit,
  taken,
  onChanged,
}: {
  member: Member
  isMe: boolean
  canEdit: boolean
  /** The whole roster, so a rename cannot land on a name someone else holds. */
  taken: Member[]
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(member.display_name)
  const guest = isGuest(member)
  const clash = nameTaken(taken.map((m) => m.display_name), name, member.display_name)

  async function patch(change: { role?: Role; skill_tier?: Tier; display_name?: string }) {
    setBusy(true)
    setError('')
    try {
      await updateMember(member.id, change)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setBusy(false)
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <Avatar id={member.id} name={member.display_name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-ink">
            {member.display_name}
            {isMe && <span className="ml-1.5 text-meta text-muted">(you)</span>}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span className="text-meta text-muted">{TIER_LABEL[member.skill_tier]}</span>
            {member.role !== 'member' && (
              <Pill tone="neutral">{member.role === 'owner' ? 'Owner' : 'Co-host'}</Pill>
            )}
            {guest && <Pill tone="neutral">Guest</Pill>}
          </div>
        </div>

        {canEdit && (
          <Button
            variant="ghost"
            icon={editing ? X : Pencil}
            disabled={busy}
            className="shrink-0 px-2"
            aria-expanded={editing}
            aria-label={editing ? `Done editing ${member.display_name}` : `Edit ${member.display_name}`}
            onClick={() => {
              setName(member.display_name)
              setError('')
              setEditing((open) => !open)
            }}
          />
        )}
      </div>

      {editing && (
        <div className="kq-rise mt-3 space-y-3 border-t border-hairline pt-3">
          {/* A guest has no login, so there is nothing to promote. Renaming is
              the affordance they need instead — the host typed the name in and
              may well have got it wrong. */}
          {guest && (
            <Field label="Name">
              <div className="flex gap-2">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={40}
                  autoFocus
                  aria-label={`Rename ${member.display_name}`}
                  aria-invalid={clash || undefined}
                  className="flex-1"
                />
                <Button
                  icon={Check}
                  loading={busy}
                  disabled={!name.trim() || name.trim() === member.display_name || clash}
                  className="shrink-0 px-3"
                  aria-label="Save name"
                  onClick={() => void patch({ display_name: name.trim() })}
                />
              </div>
              {clash && (
                <p className="mt-1.5 text-meta font-medium text-danger" role="alert">
                  Someone in this club already uses that name.
                </p>
              )}
            </Field>
          )}

          <Field label="Skill level">
            <Select
              aria-label={`Skill level for ${member.display_name}`}
              value={member.skill_tier}
              disabled={busy}
              onChange={(e) => void patch({ skill_tier: e.target.value as Tier })}
            >
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {TIER_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>

          {!guest && (
            // "Remove" here demoted a co-host, while "Remove" on a queue row
            // removes the person. One of them had to change its word.
            <Button
              // Taking privileges away is the destructive direction, so it is
              // the one that says so — it used to be the quieter of the two.
              variant={member.role === 'admin' ? 'dangerQuiet' : 'primary'}
              icon={ShieldCheck}
              full
              disabled={busy}
              onClick={() => void patch({ role: member.role === 'admin' ? 'member' : 'admin' })}
            >
              {member.role === 'admin' ? 'Make member' : 'Make co-host'}
            </Button>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-meta font-medium text-danger">{error}</p>}
    </div>
  )
}

function CreateSessionForm({
  clubId,
  onCancel,
  onCreated,
}: {
  clubId: string
  onCancel: () => void
  onCreated: () => void
}) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [courts, setCourts] = useState('2')
  const [fee, setFee] = useState('0')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const created = await createSession({
        club_id: clubId,
        name: name.trim(),
        court_count: Number(courts),
        fee_amount: Number(fee),
      })
      onCreated()
      navigate(`/session/${created.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Session name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={defaultSessionName()}
            autoFocus
            required
            maxLength={60}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Courts">
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={12}
              value={courts}
              onChange={(e) => setCourts(e.target.value)}
              required
            />
          </Field>
          <Field label="Fee per player">
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              required
            />
          </Field>
        </div>
        {error && <p className="text-meta font-medium text-danger">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || !name.trim()} full>
            {busy ? 'Creating…' : 'Create session'}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  )
}

/** Placeholder only — the host still types the real name. */
function defaultSessionName(): string {
  return new Date().toLocaleDateString(undefined, { weekday: 'long' }) + ' open play'
}
