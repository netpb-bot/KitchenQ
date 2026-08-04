import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  ShieldCheck,
  Trophy,
  Users,
} from 'lucide-react'
import {
  TIERS,
  createSession,
  getClub,
  isAdmin,
  isGuest,
  listClubLedger,
  listClubMatches,
  listMembers,
  listSessions,
  money,
  myMember,
  updateMember,
  useAsync,
  type Club,
  type LedgerEntry,
  type Member,
  type Role,
  type Tier,
} from '../lib/db'
import { standings } from '../lib/standings'
import { AddGuestForm, TIER_LABEL } from '../components/AddGuestForm'
import { Avatar } from '../components/Avatar'
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
  SectionHeading,
  Select,
} from '../components/ui'

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
  const [creating, setCreating] = useState(false)

  if (view.loading) return <Screen title="Club"><Loading /></Screen>
  if (view.error)
    return (
      <Screen title="Club">
        <ErrorNote>{view.error}</ErrorNote>
      </Screen>
    )

  const { club, me, members, sessions, ledger, matches } = view.data!
  const admin = isAdmin(me)
  const table = standings(
    members.map((m) => ({ memberId: m.id, name: m.display_name })),
    matches,
  )

  return (
    <Screen
      title={club.name}
      subtitle={`${members.length} ${members.length === 1 ? 'member' : 'members'}`}
      lead={
        <Link
          to="/clubs"
          className="-ml-1 inline-flex min-h-11 items-center gap-1 pt-3 text-sm font-semibold text-muted"
        >
          <ChevronLeft size={18} aria-hidden />
          Clubs
        </Link>
      }
    >
      <SectionHeading
        action={
          admin && !creating ? (
            <Button variant="secondary" icon={Plus} onClick={() => setCreating(true)}>
              New
            </Button>
          ) : undefined
        }
      >
        Sessions
      </SectionHeading>

      {creating && (
        <div className="mb-3">
          <CreateSessionForm
            clubId={id}
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
        <div className="space-y-3">
          {sessions.map((s) => (
            <Link key={s.id} to={`/session/${s.id}`} className="block">
              <Card className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{s.name}</p>
                  <p className="tnum mt-0.5 text-sm text-muted">
                    {s.court_count} {s.court_count === 1 ? 'court' : 'courts'} · code{' '}
                    {s.join_code}
                  </p>
                </div>
                {s.status === 'live' ? (
                  <Pill tone="live" dot>
                    LIVE
                  </Pill>
                ) : (
                  <Pill tone={s.status === 'draft' ? 'warn' : 'neutral'}>
                    {s.status === 'draft' ? 'Not started' : 'Ended'}
                  </Pill>
                )}
                <ChevronRight size={20} className="text-muted" aria-hidden />
              </Card>
            </Link>
          ))}
        </div>
      )}

      <SectionHeading>Leaderboard</SectionHeading>
      {table.length === 0 ? (
        <EmptyState
          icon={Trophy}
          message="Nothing played yet."
          hint="The all-time table builds itself as sessions are scored."
        />
      ) : (
        <>
          <p className="tnum -mt-1 mb-3 text-sm text-muted">
            All time · {matches.length} {matches.length === 1 ? 'match' : 'matches'}
          </p>
          <StandingsList table={table} meId={me?.id} />
          <RankingNote />
        </>
      )}

      <Dues club={club} members={members} ledger={ledger} admin={admin} />

      <SectionHeading>Members</SectionHeading>
      {members.length === 0 ? (
        <EmptyState icon={Users} message="No members yet." />
      ) : (
        <Card className="divide-y divide-hairline p-0">
          {members.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              isMe={m.id === me?.id}
              canEdit={admin && m.role !== 'owner'}
              onChanged={reload}
            />
          ))}
        </Card>
      )}

      {admin && (
        <>
          <SectionHeading>Add a guest</SectionHeading>
          <Card>
            <p className="mb-3 text-sm text-muted">
              For a regular who never brings a phone. They keep a record across
              sessions, and can take the name over themselves later with a join code.
            </p>
            <AddGuestForm clubId={id} onAdded={reload} submitLabel="Add guest" />
          </Card>
        </>
      )}
    </Screen>
  )
}

/**
 * What the club is owed, across every session. RLS decides the scope, not this
 * component: a host gets every member's balance, a member gets only their own.
 */
function Dues({
  club,
  members,
  ledger,
  admin,
}: {
  club: Club
  members: Member[]
  ledger: LedgerEntry[]
  admin: boolean
}) {
  const owing = new Map<string, { owed: number; sessions: number }>()
  for (const entry of ledger) {
    const outstanding = entry.amount_due - entry.amount_paid
    if (outstanding <= 0) continue
    const row = owing.get(entry.club_member_id) ?? { owed: 0, sessions: 0 }
    row.owed += outstanding
    row.sessions++
    owing.set(entry.club_member_id, row)
  }

  const total = [...owing.values()].reduce((sum, r) => sum + r.owed, 0)
  const names = new Map(members.map((m) => [m.id, m.display_name]))
  const rows = [...owing.entries()].sort((x, y) => y[1].owed - x[1].owed)

  if (ledger.length === 0) return null

  return (
    <>
      <SectionHeading>{admin ? 'Dues' : 'Your balance'}</SectionHeading>
      {rows.length === 0 ? (
        <EmptyState
          icon={Check}
          message={admin ? 'Everyone is square.' : "You're all paid up."}
          hint={
            admin ? 'Nothing outstanding across any session.' : undefined
          }
        />
      ) : (
        <>
          <Card className="divide-y divide-hairline p-0">
            {rows.map(([memberId, row]) => (
              <div key={memberId} className="flex items-center gap-3 px-4 py-3">
                <Avatar name={names.get(memberId) ?? 'Unknown'} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">
                    {names.get(memberId) ?? 'Unknown'}
                  </p>
                  <p className="tnum mt-0.5 text-xs text-muted">
                    {row.sessions} unpaid {row.sessions === 1 ? 'session' : 'sessions'}
                  </p>
                </div>
                <span className="tnum font-bold text-danger">
                  {money(row.owed, club.currency)}
                </span>
              </div>
            ))}
          </Card>
          {admin && (
            <p className="tnum mt-3 text-right text-sm font-semibold text-ink">
              Total outstanding {money(total, club.currency)}
            </p>
          )}
        </>
      )}
    </>
  )
}

function MemberRow({
  member,
  isMe,
  canEdit,
  onChanged,
}: {
  member: Member
  isMe: boolean
  canEdit: boolean
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const guest = isGuest(member)

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
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <Avatar name={member.display_name} />
      <div className="min-w-0 flex-1">
        {renaming === null ? (
          <p className="truncate font-semibold text-ink">
            {member.display_name}
            {isMe && <span className="ml-1.5 text-sm font-medium text-muted">(you)</span>}
          </p>
        ) : (
          <div className="flex gap-2">
            <Input
              value={renaming}
              onChange={(e) => setRenaming(e.target.value)}
              maxLength={40}
              autoFocus
              aria-label={`Rename ${member.display_name}`}
              className="flex-1"
            />
            <Button
              icon={Check}
              disabled={busy || !renaming.trim()}
              className="px-3"
              aria-label="Save name"
              onClick={async () => {
                await patch({ display_name: renaming.trim() })
                setRenaming(null)
              }}
            />
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {member.role !== 'member' && (
            <Pill tone="neutral">{member.role === 'owner' ? 'Owner' : 'Co-host'}</Pill>
          )}
          {guest && <Pill tone="neutral">Guest</Pill>}
          {!canEdit && <Pill tone="neutral">{TIER_LABEL[member.skill_tier]}</Pill>}
        </div>
      </div>

      {canEdit && (
        <div className="flex items-center gap-2">
          {/* Controls fill their container, so the width lives on the wrapper. */}
          <div className="w-36">
            <Select
              aria-label={`Skill level for ${member.display_name}`}
              value={member.skill_tier}
              disabled={busy}
              onChange={(e) => void patch({ skill_tier: e.target.value as Tier })}
              className="text-sm"
            >
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {TIER_LABEL[t]}
                </option>
              ))}
            </Select>
          </div>

          {/* A guest has no login, so there is nothing to promote. Renaming is
              the affordance they need instead — the host typed the name in and
              may well have got it wrong. */}
          {guest ? (
            renaming === null && (
              <Button
                variant="ghost"
                icon={Pencil}
                disabled={busy}
                className="px-3"
                aria-label={`Rename ${member.display_name}`}
                onClick={() => setRenaming(member.display_name)}
              />
            )
          ) : (
            <Button
              variant={member.role === 'admin' ? 'ghost' : 'secondary'}
              icon={ShieldCheck}
              disabled={busy}
              onClick={() => void patch({ role: member.role === 'admin' ? 'member' : 'admin' })}
              className="px-3"
            >
              {member.role === 'admin' ? 'Remove' : 'Co-host'}
            </Button>
          )}
        </div>
      )}

      {error && <p className="w-full text-sm font-medium text-danger">{error}</p>}
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
        {error && <p className="text-sm font-medium text-danger">{error}</p>}
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
