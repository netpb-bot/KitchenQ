import { useState } from 'react'
import { Banknote, Check, HandCoins, Pencil } from 'lucide-react'
import {
  money,
  recordPayment,
  recordPayments,
  setSessionFee,
  unsettled,
  useAction,
  type Club,
  type LedgerEntry,
  type Member,
  type Session,
  type SessionPlayer,
} from '../lib/db'
import { Avatar } from './Avatar'
import {
  Button,
  Card,
  ConfirmButton,
  EmptyState,
  Field,
  Input,
  Pill,
  SearchField,
  SectionHeading,
  StatCard,
  Tabs,
  UndoBar,
} from './ui'

/** What an undone write has to put back, and what to say while it can be. */
type Undo = { message: string; restore: { id: string; amount: number }[] }

/**
 * The host's collection sheet, filled in during the session while the cash is
 * actually in hand. A player sees only their own line — RLS returns nothing
 * else, and there is no write path for them at all.
 */
export function FeeSheet({
  session,
  club,
  me,
  players,
  ledger,
  admin,
  reload,
}: {
  session: Session
  club: Club | null
  me: Member | null
  players: SessionPlayer[]
  ledger: LedgerEntry[]
  admin: boolean
  reload: () => void
}) {
  const currency = club?.currency ?? 'PHP'
  const names = new Map(
    players.map((p) => [p.club_members.id, p.club_members.display_name]),
  )

  const rows = [...ledger].sort((x, y) =>
    (names.get(x.club_member_id) ?? '').localeCompare(names.get(y.club_member_id) ?? ''),
  )

  if (rows.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState
          icon={Banknote}
          message={
            session.fee_amount > 0
              ? `The fee is ${money(session.fee_amount, currency)} per player.`
              : 'This session is free.'
          }
          hint="Everyone who joins gets a line here."
        />
      </div>
    )
  }

  if (!admin) {
    return (
      <>
        <SectionHeading>Your fee</SectionHeading>
        <Card className="divide-y divide-hairline p-0">
          {rows.map((entry) => (
            <FeeRow
              key={entry.id}
              entry={entry}
              name={names.get(entry.club_member_id) ?? 'You'}
              currency={currency}
              isMe={entry.club_member_id === me?.id}
              admin={false}
              reload={reload}
            />
          ))}
        </Card>
        <p className="mt-3 text-meta leading-relaxed text-muted">
          The host records payments as they collect them. If this doesn't match what
          you handed over, tell them — only a host can change it.
        </p>
      </>
    )
  }

  return (
    <AdminSheet
      session={session}
      currency={currency}
      names={names}
      me={me}
      rows={rows}
      reload={reload}
    />
  )
}

/**
 * The host opens this screen to collect, so it opens on who still owes. The
 * counts sit in the filter labels — a row vanishing when you mark it paid has to
 * read as progress, not as something going missing.
 */
type Filter = 'unpaid' | 'partial' | 'paid' | 'all'

function AdminSheet({
  session,
  currency,
  names,
  me,
  rows,
  reload,
}: {
  session: Session
  currency: string
  names: Map<string, string>
  me: Member | null
  rows: LedgerEntry[]
  reload: () => void
}) {
  const [filter, setFilter] = useState<Filter>('unpaid')
  const [query, setQuery] = useState('')
  // One bar for the whole sheet rather than one per row: on the Unpaid filter
  // the row that was just settled leaves the list, and an undo it owned would
  // unmount with it — the offer would vanish at the moment it is needed.
  const [undo, setUndo] = useState<Undo | null>(null)
  const [bulkBusy, bulkError, runBulk] = useAction()

  const due = rows.reduce((sum, e) => sum + e.amount_due, 0)
  const collected = rows.reduce((sum, e) => sum + e.amount_paid, 0)
  const settled = rows.filter((e) => e.status === 'paid').length
  const outstanding = Math.max(0, due - collected)

  const q = query.trim().toLowerCase()
  const shown = rows.filter((e) => {
    if (filter !== 'all' && e.status !== filter) return false
    if (!q) return true
    return (names.get(e.club_member_id) ?? '').toLowerCase().includes(q)
  })

  const count = (status: LedgerEntry['status']) =>
    rows.filter((e) => e.status === status).length

  const owing = rows.filter((e) => e.amount_paid < e.amount_due)

  const settleAll = () =>
    runBulk(async () => {
      const before = owing.map((e) => ({ id: e.id, amount: e.amount_paid }))
      await recordPayments(unsettled(owing))
      setUndo({
        message: `${before.length} ${before.length === 1 ? 'line' : 'lines'} marked paid`,
        restore: before,
      })
      reload()
    })

  const undoAll = (restore: Undo['restore']) => {
    setUndo(null)
    runBulk(async () => {
      await recordPayments(restore)
      reload()
    })
  }

  return (
    <>
      <SectionHeading>Collection</SectionHeading>
      {/* Player count lives on the session header two rows up; repeating it here
          bought a fourth card and no new information. */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard
          icon={HandCoins}
          value={money(collected, currency)}
          label="Collected"
          tone="good"
        />
        <StatCard
          icon={Banknote}
          value={money(outstanding, currency)}
          label="Outstanding"
          // Amber, not red: money still to collect is unresolved, not wrong.
          tone={outstanding > 0 ? 'warn' : 'default'}
        />
        <StatCard icon={Check} value={`${settled}/${rows.length}`} label="Settled" />
      </div>
      <FeeEditor session={session} currency={currency} reload={reload} />

      <SectionHeading
        action={
          owing.length > 0 && (
            // The one action here that writes every line at once, so it is the
            // one that earns a confirm on top of the undo bar — and the only
            // filled button on the screen, with the tinted rows beneath it.
            // Not red when armed: settling is a positive act the bar can undo.
            <ConfirmButton
              variant="primary"
              confirmVariant="positive"
              size="sm"
              label={`Settle all (${owing.length})`}
              confirmLabel={`Mark all ${owing.length} paid?`}
              busy={bulkBusy}
              error={bulkError}
              onConfirm={settleAll}
            />
          )
        }
      >
        Players
      </SectionHeading>
      <div className="mb-3">
        <Tabs
          label="Payment status"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'unpaid', label: 'Unpaid', count: count('unpaid') },
            ...(count('partial') > 0
              ? [{ value: 'partial' as const, label: 'Partial', count: count('partial') }]
              : []),
            { value: 'paid', label: 'Paid', count: settled },
            { value: 'all', label: 'All', count: rows.length },
          ]}
        />
      </div>

      {rows.length > 8 && (
        <div className="mb-3">
          <SearchField
            label="Search players"
            placeholder="Search players"
            value={query}
            onChange={setQuery}
          />
        </div>
      )}

      {shown.length === 0 ? (
        <EmptyState
          icon={Check}
          message={
            q
              ? `Nobody matching “${query.trim()}”.`
              : filter === 'unpaid'
                ? 'Everyone is square.'
                : filter === 'paid'
                  ? 'Nothing collected yet.'
                  : 'No partial payments.'
          }
        />
      ) : (
        <Card className="divide-y divide-hairline p-0">
          {shown.map((entry) => (
            <FeeRow
              key={entry.id}
              entry={entry}
              name={names.get(entry.club_member_id) ?? 'Unknown'}
              currency={currency}
              isMe={entry.club_member_id === me?.id}
              admin
              reload={reload}
              onDone={setUndo}
            />
          ))}
        </Card>
      )}

      {undo && (
        <UndoBar
          message={undo.message}
          onAction={() => undoAll(undo.restore)}
          onDismiss={() => setUndo(null)}
        />
      )}
    </>
  )
}

/**
 * The fee typed into the create form is a guess, and the host finds out it was
 * wrong while standing on this screen reading it — so the number they are
 * reading is the control that changes it. The trigger in 0007 re-prices the
 * unpaid lines from here.
 */
function FeeEditor({
  session,
  currency,
  reload,
}: {
  session: Session
  currency: string
  reload: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [busy, error, run] = useAction()

  const save = (amount: number) =>
    run(async () => {
      await setSessionFee(session.id, amount)
      setEditing(false)
      reload()
    })

  return (
    <div className="mt-3">
      {editing ? (
        <AmountForm
          label="Fee per player"
          hint="Every unpaid line re-prices to this. Anything already collected stays as it was."
          value={session.fee_amount}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSave={save}
        />
      ) : (
        <div className="text-center">
          <button
            type="button"
            className="kq-chip inline-flex items-center gap-1.5 rounded-full px-3 text-meta text-muted transition-colors hover:bg-fill"
            onClick={() => setEditing(true)}
          >
            {session.fee_amount > 0
              ? `${money(session.fee_amount, currency)} per player`
              : 'Free session'}
            <Pencil size={14} strokeWidth={2.25} aria-hidden />
            <span className="sr-only">Change the fee</span>
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-center text-meta font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

function FeeRow({
  entry,
  name,
  currency,
  isMe,
  admin,
  reload,
  onDone,
}: {
  entry: LedgerEntry
  name: string
  currency: string
  isMe: boolean
  admin: boolean
  reload: () => void
  /** Absent on a player's own line, which has no write path to undo. */
  onDone?: (undo: Undo) => void
}) {
  const [editing, setEditing] = useState(false)
  const [busy, error, run] = useAction()

  const pay = (amount: number, message: string) =>
    run(async () => {
      const before = entry.amount_paid
      await recordPayment(entry.id, amount)
      setEditing(false)
      onDone?.({ message, restore: [{ id: entry.id, amount: before }] })
      reload()
    })

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <Avatar name={name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-ink">
            {name}
            {isMe && <span className="ml-1.5 text-meta font-medium text-muted">(you)</span>}
          </p>
          {/* One amount, no "Owes" prefix and no Unpaid pill: the filter the host
              is standing on already says unpaid, and saying it a third time is
              what buried the name. Partial still earns its pill. */}
          <div className="mt-0.5 flex items-center gap-2">
            {entry.status === 'paid' && (
              <Check size={15} strokeWidth={2.5} className="shrink-0 text-primary" aria-hidden />
            )}
            <p className="tnum truncate text-meta text-muted">
              {entry.status === 'paid'
                ? `Paid ${money(entry.amount_paid, currency)}`
                : entry.status === 'partial'
                  ? `${money(entry.amount_paid, currency)} of ${money(entry.amount_due, currency)}`
                  : money(entry.amount_due, currency)}
            </p>
            {entry.status === 'partial' && (
              <Pill tone="warn" className="shrink-0">
                Partial
              </Pill>
            )}
          </div>
        </div>

        {admin && !editing && (
          <div className="flex shrink-0 items-center gap-1">
            {entry.status === 'paid' ? (
              // One tap, and no armed danger button landing where "Mark paid"
              // just was. The undo bar is the net, and it works both ways.
              // Red because it wipes money someone recorded, quiet because it
              // repeats on every settled row.
              <Button
                variant="dangerQuiet"
                size="sm"
                loading={busy}
                onClick={() => pay(0, `${name} set back to unpaid`)}
              >
                Undo
              </Button>
            ) : (
              // Tinted, not filled: on the Unpaid filter every row carries this
              // button, and a column of solid green outshouted the names it was
              // meant to sit beside. Still green, because collecting is the good
              // outcome — just at the weight a repeated action deserves.
              <Button
                variant="positive"
                size="sm"
                loading={busy}
                onClick={() => pay(entry.amount_due, `${name} marked paid`)}
              >
                Mark paid
              </Button>
            )}
            {/* Partial payments are the exception, so they sit behind a tap. */}
            <Button
              variant="ghost"
              size="sm"
              icon={Pencil}
              disabled={busy}
              className="px-2"
              aria-label={`Enter an exact amount for ${name}`}
              onClick={() => setEditing(true)}
            />
          </div>
        )}
      </div>

      {editing && (
        <div className="mt-3 border-t border-hairline pt-3">
          <AmountForm
            label={`Amount collected from ${name}`}
            value={entry.amount_paid}
            busy={busy}
            onCancel={() => setEditing(false)}
            onSave={(amount) => pay(amount, `${name} set to ${money(amount, currency)}`)}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-meta font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

/** The one money input on this screen — a player's line, and the session fee. */
function AmountForm({
  label,
  hint,
  value,
  busy,
  onCancel,
  onSave,
}: {
  label: string
  hint?: string
  value: number
  busy: boolean
  onCancel: () => void
  onSave: (amount: number) => void
}) {
  const [amount, setAmount] = useState(String(value))

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSave(Number(amount))
      }}
    >
      <Field label={label} hint={hint}>
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="tnum"
          autoFocus
          required
        />
      </Field>
      <div className="mt-3 flex gap-2">
        <Button type="submit" full loading={busy} disabled={amount === ''}>
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
