import { describe, expect, it } from 'vitest'
import { canEnterScore, courtState, matchup, waitLabel, waitLabels } from './LiveSession'
import type { Forecast, Lineup } from '../lib/queue'
import type { Match, Session } from '../lib/db'

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

describe('waitLabels', () => {
  const MIN = 60_000
  const NOW = 1_000 * MIN

  const plan = (freeAt: number, tail: [string, number][] = []): Forecast => ({
    courts: [
      { court: 2, freeAt, lineup: { teamA: ['ana', 'ben'], teamB: ['cara', 'dan'] } },
    ],
    onCourtAt: new Map<string, number>([
      // forecast() stamps every lineup member with their court's own freeAt.
      ['ana', freeAt],
      ['ben', freeAt],
      ['cara', freeAt],
      ['dan', freeAt],
      ...tail,
    ]),
  })

  // The bug: ending a session leaves its open matches open, so the forecast kept
  // running and the queue kept telling a room that had gone home they were "up
  // next". A draft session was the same lie told before the fact.
  it('says nothing at all unless the session is live', () => {
    expect(waitLabels(plan(NOW), 'ended', NOW).size).toBe(0)
    expect(waitLabels(plan(NOW), 'draft', NOW).size).toBe(0)
  })

  it('promises a court already standing empty, and names it', () => {
    expect(waitLabels(plan(NOW), 'live', NOW).get('ana')).toEqual({
      label: 'Up next',
      called: true,
      court: 2,
    })
  })

  it('only forecasts a court still being played on', () => {
    expect(waitLabels(plan(NOW + 9 * MIN), 'live', NOW).get('ana')).toEqual({
      label: '~9 min',
      called: false,
      court: 2,
    })
  })

  // Past the first round there is a time but no court yet: which one comes free
  // second is a guess on top of a guess, and naming it would be a promise.
  it('gives the tail of the queue a time and no court', () => {
    const waits = waitLabels(plan(NOW, [['eve', NOW + 21 * MIN]]), 'live', NOW)
    expect(waits.get('eve')).toEqual({ label: '~21 min', called: false })
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

describe('canEnterScore', () => {
  // Only the fields the predicate reads; the rest of Match/Session is noise here.
  const match = { team_a_ids: ['ana', 'ben'], team_b_ids: ['cara', 'dan'] } as Match
  const session = (allow: boolean) => ({ allow_player_scoring: allow }) as Session

  it('lets the host score whatever the toggle says', () => {
    expect(canEnterScore(match, session(false), true, 'host')).toBe(true)
    expect(canEnterScore(match, session(true), true, 'host')).toBe(true)
  })

  it('lets a player on either side of the net score, once the toggle is on', () => {
    expect(canEnterScore(match, session(true), false, 'ana')).toBe(true)
    expect(canEnterScore(match, session(true), false, 'dan')).toBe(true)
    expect(canEnterScore(match, session(false), false, 'ana')).toBe(false)
  })

  // The bug: "players can enter their own score" was read as "anyone may score",
  // so someone in the queue could end a match they were nowhere near.
  it('never lets someone off the court end the match', () => {
    expect(canEnterScore(match, session(true), false, 'eve')).toBe(false)
    expect(canEnterScore(match, session(true), false, null)).toBe(false)
  })
})
