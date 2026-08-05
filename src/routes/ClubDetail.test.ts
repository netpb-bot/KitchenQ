import { describe, expect, it } from 'vitest'
import { duesRows } from './ClubDetail'
import type { LedgerEntry } from '../lib/db'

const entry = (
  club_member_id: string,
  amount_due: number,
  amount_paid: number,
): LedgerEntry => ({
  id: `${club_member_id}-${amount_due}-${amount_paid}`,
  session_id: 's',
  club_member_id,
  amount_due,
  amount_paid,
  status: amount_paid >= amount_due ? 'paid' : amount_paid > 0 ? 'partial' : 'unpaid',
})

const names = new Map([
  ['a', 'Bea'],
  ['b', 'Carlo'],
])

describe('duesRows', () => {
  it('sums what is still owed across sessions, biggest debt first', () => {
    const rows = duesRows(
      [entry('a', 250, 0), entry('b', 250, 0), entry('b', 250, 0), entry('a', 250, 100)],
      names,
    )
    expect(rows).toEqual([
      { memberId: 'b', name: 'Carlo', owed: 500, sessions: 2 },
      { memberId: 'a', name: 'Bea', owed: 400, sessions: 2 },
    ])
  })

  it('drops settled lines, and never lets an overpayment cancel a real debt', () => {
    // 50 over on one night must not shrink the 250 still owed for another.
    const rows = duesRows([entry('a', 250, 250), entry('a', 250, 300), entry('a', 250, 0)], names)
    expect(rows).toEqual([{ memberId: 'a', name: 'Bea', owed: 250, sessions: 1 }])
  })

  it('is empty when everyone is square, and names a member it cannot resolve', () => {
    expect(duesRows([entry('a', 250, 250)], names)).toEqual([])
    expect(duesRows([entry('ghost', 250, 0)], names)[0].name).toBe('Unknown')
  })
})
