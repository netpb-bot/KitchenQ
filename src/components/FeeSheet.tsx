import { useState } from 'react'
import { Banknote, Check, HandCoins, Pencil } from 'lucide-react'
import {
  money,
  recordPayment,
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
  SectionHeading,
  StatCard,
} from './ui'

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
        <p className="mt-3 text-xs leading-relaxed text-muted">
          The host records payments as they collect them. If this doesn't match what
          you handed over, tell them — only a host can change it.
        </p>
      </>
    )
  }

  const due = rows.reduce((sum, e) => sum + e.amount_due, 0)
  const collected = rows.reduce((sum, e) => sum + e.amount_paid, 0)
  const settled = rows.filter((e) => e.status === 'paid').length

  const outstanding = Math.max(0, due - collected)

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
          tone={outstanding > 0 ? 'danger' : 'default'}
        />
        <StatCard icon={Check} value={`${settled}/${rows.length}`} label="Settled" />
      </div>
      {session.fee_amount > 0 && (
        <p className="mt-3 text-center text-xs text-muted">
          {money(session.fee_amount, currency)} per player. Change the fee and every
          unpaid line updates with it.
        </p>
      )}

      <SectionHeading>Players</SectionHeading>
      <Card className="divide-y divide-hairline p-0">
        {rows.map((entry) => (
          <FeeRow
            key={entry.id}
            entry={entry}
            name={names.get(entry.club_member_id) ?? 'Unknown'}
            currency={currency}
            isMe={entry.club_member_id === me?.id}
            admin
            reload={reload}
          />
        ))}
      </Card>
    </>
  )
}

function FeeRow({
  entry,
  name,
  currency,
  isMe,
  admin,
  reload,
}: {
  entry: LedgerEntry
  name: string
  currency: string
  isMe: boolean
  admin: boolean
  reload: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function pay(amount: number) {
    setBusy(true)
    setError('')
    try {
      await recordPayment(entry.id, amount)
      setEditing(false)
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setBusy(false)
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <Avatar name={name} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-ink">
            {name}
            {isMe && <span className="ml-1.5 text-sm font-medium text-muted">(you)</span>}
          </p>
          {/* Pill sits on the amount line, not as its own flex child — beside the
              buttons it starved the name column and the amount overflowed. */}
          <div className="mt-0.5 flex items-center gap-2">
            <p className="tnum truncate text-xs text-muted">
              {entry.status === 'paid'
                ? `Paid ${money(entry.amount_paid, currency)}`
                : entry.status === 'partial'
                  ? `${money(entry.amount_paid, currency)} of ${money(entry.amount_due, currency)}`
                  : `Owes ${money(entry.amount_due, currency)}`}
            </p>
            {entry.status === 'paid' ? (
              <Pill tone="neutral" className="shrink-0">
                Paid
              </Pill>
            ) : (
              <Pill
                tone={entry.status === 'partial' ? 'warn' : 'danger'}
                className="shrink-0"
              >
                {entry.status === 'partial' ? 'Partial' : 'Unpaid'}
              </Pill>
            )}
          </div>
        </div>

        {admin && !editing && (
          <div className="flex shrink-0 items-center gap-1">
            {entry.status === 'paid' ? (
              // Confirmed: this wipes a recorded payment and sits one finger-width
              // from "Mark paid".
              <ConfirmButton
                variant="ghost"
                size="sm"
                label="Undo"
                confirmLabel="Clear this payment?"
                busy={busy}
                onConfirm={() => void pay(0)}
              />
            ) : (
              <Button
                size="sm"
                loading={busy}
                onClick={() => void pay(entry.amount_due)}
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
        <PartialForm
          entry={entry}
          name={name}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSave={pay}
        />
      )}
      {error && <p className="mt-2 text-sm font-medium text-danger">{error}</p>}
    </div>
  )
}

function PartialForm({
  entry,
  name,
  busy,
  onCancel,
  onSave,
}: {
  entry: LedgerEntry
  name: string
  busy: boolean
  onCancel: () => void
  onSave: (amount: number) => Promise<void>
}) {
  const [amount, setAmount] = useState(String(entry.amount_paid))

  return (
    <form
      className="mt-3 border-t border-hairline pt-3"
      onSubmit={(e) => {
        e.preventDefault()
        void onSave(Number(amount))
      }}
    >
      <Field label={`Amount collected from ${name}`}>
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
