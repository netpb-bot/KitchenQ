import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  debounce,
  nameTaken,
  normalizeName,
  randomCode,
  unsettled,
  type LedgerEntry,
} from './db'

describe('randomCode', () => {
  const codes = Array.from({ length: 500 }, randomCode)

  it('is six characters', () => {
    for (const code of codes) expect(code).toHaveLength(6)
  })

  // These get read aloud across a gym and typed on a phone: I/1 and O/0 are
  // the pairs people mishear and mistype, so the alphabet excludes all four.
  it('never contains an ambiguous character', () => {
    for (const code of codes) expect(code).not.toMatch(/[IO01]/)
  })

  it('is uppercase alphanumeric', () => {
    for (const code of codes) expect(code).toMatch(/^[A-Z2-9]{6}$/)
  })

  it('does not repeat', () => {
    expect(new Set(codes).size).toBe(codes.length)
  })
})

describe('unsettled', () => {
  const entry = (id: string, due: number, paid: number): LedgerEntry => ({
    id,
    session_id: 's',
    club_member_id: `m-${id}`,
    amount_due: due,
    amount_paid: paid,
    status: paid >= due ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
  })

  const rows = [
    entry('a', 100, 0), // unpaid
    entry('b', 100, 40), // partial — still owes 60
    entry('c', 100, 100), // settled
    entry('d', 0, 0), // free line, nothing to collect
    entry('e', 100, 120), // overpaid; leave the extra alone
  ]

  it('takes the unpaid and the partial, and nothing else', () => {
    expect(unsettled(rows).map((u) => u.id)).toEqual(['a', 'b'])
  })

  // "Settle all" collects the rest of what is owed, so a partial goes to the
  // full amount due — not to its own amount_paid, which would be a no-op.
  it('targets the full amount due', () => {
    expect(unsettled(rows)).toEqual([
      { id: 'a', amount: 100 },
      { id: 'b', amount: 100 },
    ])
  })

  it('is empty once everyone is square', () => {
    expect(unsettled([entry('c', 100, 100), entry('d', 0, 0)])).toEqual([])
  })
})

// These two are the client half of club_members_unique_name. The index is what
// actually prevents a duplicate; what is being checked here is that the forms
// agree with it, so a host is told before they submit rather than after.
describe('normalizeName', () => {
  it('trims, collapses runs of whitespace and folds case', () => {
    expect(normalizeName('  Mike  ')).toBe('mike')
    expect(normalizeName('Jo  Ann')).toBe('jo ann')
    expect(normalizeName('Jo\tAnn')).toBe('jo ann')
  })

  // The trigger translates nbsp to a space before its own \s pass, because
  // Postgres's \s does not match it and this one does. Same result either way.
  it('treats a non-breaking space as a space', () => {
    expect(normalizeName(`Jo${String.fromCharCode(160)}Ann`)).toBe('jo ann')
  })
})

describe('nameTaken', () => {
  const roster = ['Mike', 'Jo Ann', 'Priya']

  it('catches the same name in a different case or with padding', () => {
    expect(nameTaken(roster, 'mike')).toBe(true)
    expect(nameTaken(roster, ' Mike ')).toBe(true)
    expect(nameTaken(roster, 'MIKE')).toBe(true)
    expect(nameTaken(roster, 'Jo  Ann')).toBe(true)
  })

  it('leaves genuinely different names alone', () => {
    expect(nameTaken(roster, 'Mike R')).toBe(false)
    expect(nameTaken(roster, 'Michael')).toBe(false)
    expect(nameTaken(roster, 'Joann')).toBe(false)
  })

  // An empty field is the starting state of every one of these forms; flagging
  // it would put a red line under a name nobody has typed yet.
  it('never flags an empty name', () => {
    expect(nameTaken(roster, '')).toBe(false)
    expect(nameTaken(roster, '   ')).toBe(false)
  })

  // Renaming Mike to "Mike" is a no-op, not a collision with himself. Fixing the
  // capitalisation of your own name has to stay possible.
  it('excludes the name being renamed', () => {
    expect(nameTaken(roster, 'Mike', 'Mike')).toBe(false)
    expect(nameTaken(roster, 'mike', 'Mike')).toBe(false)
    expect(nameTaken(roster, 'Jo Ann', 'Mike')).toBe(true)
  })
})

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('does not run until the quiet period has passed', () => {
    const fn = vi.fn()
    debounce(fn, 250)()
    vi.advanceTimersByTime(249)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('collapses a burst into one call', () => {
    // The case this exists for: ending a match fires roughly nine realtime
    // events, and each one used to cost a seven-request refetch.
    const fn = vi.fn()
    const run = debounce(fn, 250)
    for (let i = 0; i < 9; i++) run()
    vi.advanceTimersByTime(250)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('restarts the clock on every call', () => {
    const fn = vi.fn()
    const run = debounce(fn, 250)
    run()
    vi.advanceTimersByTime(200)
    run()
    vi.advanceTimersByTime(200)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(50)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('runs again for a later, separate change', () => {
    const fn = vi.fn()
    const run = debounce(fn, 250)
    run()
    vi.advanceTimersByTime(250)
    run()
    vi.advanceTimersByTime(250)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('cancel stops a pending call, so unmounting cannot refetch', () => {
    const fn = vi.fn()
    const run = debounce(fn, 250)
    run()
    run.cancel()
    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()
  })
})
