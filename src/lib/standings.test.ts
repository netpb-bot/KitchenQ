import { describe, expect, it } from 'vitest'
import { SHRINKAGE, adjustedWinRate, standings } from './standings'
import type { Match } from './db'

function roster(...names: string[]) {
  return names.map((name) => ({ memberId: name, name }))
}

/** A finished match. Team ids double as names, so the tables read directly. */
function match(
  teamA: [string, string],
  teamB: [string, string],
  scoreA: number,
  scoreB: number,
): Pick<Match, 'team_a_ids' | 'team_b_ids' | 'score_a' | 'score_b' | 'ended_at'> {
  return {
    team_a_ids: teamA,
    team_b_ids: teamB,
    score_a: scoreA,
    score_b: scoreB,
    ended_at: '2026-08-04T12:00:00Z',
  }
}

describe('adjustedWinRate', () => {
  it('shrinks toward 50% so one game cannot top the table', () => {
    // The case the whole constant exists for: 1–0 must not outrank 12–3.
    const lucky = adjustedWinRate(1, 1)
    const solid = adjustedWinRate(12, 15)
    expect(lucky).toBeCloseTo(3.5 / 6, 10) // 0.5833
    expect(solid).toBeCloseTo(14.5 / 20, 10) // 0.7250
    expect(solid).toBeGreaterThan(lucky)
  })

  it('is exactly 50% with no games played', () => {
    expect(adjustedWinRate(0, 0)).toBe(0.5)
  })

  it('never reaches 0 or 1', () => {
    expect(adjustedWinRate(50, 50)).toBeLessThan(1)
    expect(adjustedWinRate(0, 50)).toBeGreaterThan(0)
    expect(SHRINKAGE).toBe(5)
  })
})

describe('standings', () => {
  it('is empty before anything is played', () => {
    expect(standings(roster('Ana', 'Ben'), [])).toEqual([])
  })

  it('credits both teams with a game, a result and their points', () => {
    const table = standings(
      roster('Ana', 'Ben', 'Cara', 'Dan'),
      [match(['Ana', 'Ben'], ['Cara', 'Dan'], 11, 7)],
    )
    const ana = table.find((r) => r.name === 'Ana')!
    const dan = table.find((r) => r.name === 'Dan')!

    expect(ana).toMatchObject({
      games: 1,
      wins: 1,
      losses: 0,
      pointsFor: 11,
      pointsAgainst: 7,
      diff: 4,
    })
    expect(dan).toMatchObject({
      games: 1,
      wins: 0,
      losses: 1,
      pointsFor: 7,
      pointsAgainst: 11,
      diff: -4,
    })
    expect(ana.rate).toBeCloseTo(3.5 / 6, 10)
    expect(dan.rate).toBeCloseTo(2.5 / 6, 10)
  })

  it('ranks by adjusted win rate, not by raw wins', () => {
    // Ana goes 1–0, Ben 3–3. Ben has three times the wins and still ranks below.
    const table = standings(roster('Ana', 'Ben', 'Cara', 'Dan', 'Eve'), [
      match(['Ana', 'Cara'], ['Ben', 'Dan'], 11, 5),
      match(['Ben', 'Cara'], ['Dan', 'Eve'], 11, 5),
      match(['Ben', 'Cara'], ['Dan', 'Eve'], 11, 5),
      match(['Ben', 'Cara'], ['Dan', 'Eve'], 11, 5),
      match(['Ben', 'Dan'], ['Cara', 'Eve'], 5, 11),
      match(['Ben', 'Dan'], ['Cara', 'Eve'], 5, 11),
    ])
    const ana = table.find((r) => r.name === 'Ana')!
    const ben = table.find((r) => r.name === 'Ben')!

    expect([ana.wins, ana.games]).toEqual([1, 1])
    expect([ben.wins, ben.games]).toEqual([3, 6])
    expect(ana.rate).toBeCloseTo(3.5 / 6, 10)
    expect(ben.rate).toBeCloseTo(5.5 / 11, 10)
    expect(table.findIndex((r) => r.name === 'Ana')).toBeLessThan(
      table.findIndex((r) => r.name === 'Ben'),
    )
  })

  it('breaks a tie on point differential', () => {
    // Ana and Ben both go 1–0, but Ana won by more.
    const table = standings(roster('Ana', 'Ben', 'Cara', 'Dan'), [
      match(['Ana', 'Cara'], ['Dan', 'Ben'], 11, 2),
      match(['Ben', 'Dan'], ['Cara', 'Ana'], 11, 9),
    ])
    const ana = table.find((r) => r.name === 'Ana')!
    const ben = table.find((r) => r.name === 'Ben')!
    expect(ana.rate).toBeCloseTo(ben.rate, 10)
    expect(ana.diff).toBe(11 - 2 + 9 - 11) // +7
    expect(ben.diff).toBe(2 - 11 + 11 - 9) // -7
    expect(table[0].name).toBe('Ana')
  })

  it('ignores matches still in progress', () => {
    const live = { ...match(['Ana', 'Ben'], ['Cara', 'Dan'], 0, 0), score_a: null, score_b: null, ended_at: null }
    expect(standings(roster('Ana', 'Ben', 'Cara', 'Dan'), [live])).toEqual([])
  })

  it('leaves out players who have not finished a game', () => {
    const table = standings(roster('Ana', 'Ben', 'Cara', 'Dan', 'Late'), [
      match(['Ana', 'Ben'], ['Cara', 'Dan'], 11, 9),
    ])
    expect(table.map((r) => r.name)).not.toContain('Late')
    expect(table).toHaveLength(4)
  })

  it('skips ids with no roster row rather than throwing', () => {
    const table = standings(roster('Ana'), [
      match(['Ana', 'Deleted'], ['Gone', 'Vanished'], 11, 4),
    ])
    expect(table).toHaveLength(1)
    expect(table[0]).toMatchObject({ name: 'Ana', wins: 1, diff: 7 })
  })
})
