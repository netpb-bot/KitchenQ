import { describe, expect, it } from 'vitest'
import { courtState, matchup, waitLabel } from './LiveSession'
import type { Lineup } from '../lib/queue'

describe('courtState', () => {
  it('never offers a startable court before the session is live', () => {
    // The bug: a draft session with four people waiting rendered a live-looking
    // "Start match" that only Postgres could refuse.
    expect(courtState('draft', true, true)).toBe('locked')
    expect(courtState('draft', true, false)).toBe('open')
    expect(courtState('draft', false, true)).toBe('open')
  })

  it('shows no lineup at all once the night is over', () => {
    expect(courtState('ended', true, true)).toBe('open')
    expect(courtState('ended', false, true)).toBe('open')
  })

  it('is startable only for the host, only while live, only with four players', () => {
    expect(courtState('live', true, true)).toBe('ready')
    expect(courtState('live', true, false)).toBe('open')
  })

  // The bug this fixes: a player waiting on a free court read "Waiting on the
  // next match" while the host was looking at that player's name in the lineup.
  // `locked` shows the four names without the Start and Swap buttons.
  it('shows a live lineup to players, without the host controls', () => {
    expect(courtState('live', false, true)).toBe('locked')
    expect(courtState('live', false, false)).toBe('open')
  })
})

describe('waitLabel', () => {
  const MIN = 60_000

  it('rounds to whole minutes — the estimate is a median, not a promise', () => {
    expect(waitLabel(9.4 * MIN, 0)).toBe('~9 min')
    expect(waitLabel(9.6 * MIN, 0)).toBe('~10 min')
  })

  // "~1 min" held for five minutes reads as a stuck clock, and it is exactly
  // what an overrunning match produces: courtFreeAt clamps it to now + 1 min
  // and leaves it there. Anything that rounds to a minute or less stops
  // counting instead.
  it('stops counting once the wait is down to nothing', () => {
    expect(waitLabel(0, 0)).toBe('any minute')
    expect(waitLabel(MIN, 0)).toBe('any minute')
    expect(waitLabel(1.4 * MIN, 0)).toBe('any minute')
    expect(waitLabel(-5 * MIN, 0)).toBe('any minute')
  })
})

describe('matchup', () => {
  const names = new Map([
    ['me', 'Kenneth'],
    ['ally', 'Ana'],
    ['x', 'Ben'],
    ['y', 'Carla'],
  ])
  const lineup = (a: string, b: string, c: string, d: string): Lineup => ({
    teamA: [a, b],
    teamB: [c, d],
  })

  it('reads from your own side of the net, whichever team you are on', () => {
    expect(matchup(lineup('me', 'ally', 'x', 'y'), 'me', names)).toBe(
      'with Ana vs Ben & Carla',
    )
    expect(matchup(lineup('x', 'y', 'me', 'ally'), 'me', names)).toBe(
      'with Ana vs Ben & Carla',
    )
  })

  // Guests are added by the host and may not be in the name map yet. A lineup
  // is still worth showing with a hole in it; "undefined" is not.
  it('never prints a missing name', () => {
    expect(matchup(lineup('me', 'ghost', 'x', 'y'), 'me', names)).toBe(
      'with a guest vs Ben & Carla',
    )
  })
})
