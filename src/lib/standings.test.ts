import { describe, expect, it } from 'vitest'
import { SHRINKAGE, adjustedWinRate, playerMatches, standings } from './standings'
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

/** A whole match row, for the functions that need more than the score columns. */
function played(
  teamA: [string, string],
  teamB: [string, string],
  scoreA: number,
  scoreB: number,
  endedAt: string | null = '2026-08-04T12:00:00Z',
): Match {
  return {
    id: `${teamA.join('')}-${teamB.join('')}-${endedAt}`,
    session_id: 'session-1',
    court_number: 1,
    ...match(teamA, teamB, scoreA, scoreB),
    started_at: '2026-08-04T11:30:00Z',
    ended_at: endedAt,
  }
}

describe('playerMatches', () => {
  it('reads a win the same from either side of the net', () => {
    // The same result, with Ana's team entered as A in one and as B in the
    // other. Which side she was on is an accident of how the host tapped.
    const asTeamA = playerMatches('Ana', [played(['Ana', 'Ben'], ['Cara', 'Dan'], 11, 7)])[0]
    const asTeamB = playerMatches('Ana', [played(['Cara', 'Dan'], ['Ana', 'Ben'], 7, 11)])[0]

    for (const m of [asTeamA, asTeamB]) {
      expect(m.won).toBe(true)
      expect(m.scoreMine).toBe(11)
      expect(m.scoreTheirs).toBe(7)
      expect(m.partnerIds).toEqual(['Ben'])
      expect(m.opponentIds).toEqual(['Cara', 'Dan'])
    }
  })

  it('reads a loss as a loss from either side', () => {
    const asTeamA = playerMatches('Ana', [played(['Ana', 'Ben'], ['Cara', 'Dan'], 8, 11)])[0]
    const asTeamB = playerMatches('Ana', [played(['Cara', 'Dan'], ['Ana', 'Ben'], 11, 8)])[0]

    for (const m of [asTeamA, asTeamB]) {
      expect(m.won).toBe(false)
      expect(m.scoreMine).toBe(8)
      expect(m.scoreTheirs).toBe(11)
    }
  })

  it('leaves out matches the player was not in', () => {
    const all = [
      played(['Ana', 'Ben'], ['Cara', 'Dan'], 11, 7),
      played(['Cara', 'Dan'], ['Eve', 'Fay'], 11, 5),
    ]
    expect(playerMatches('Ana', all)).toHaveLength(1)
    expect(playerMatches('Eve', all)).toHaveLength(1)
    expect(playerMatches('Nobody', all)).toEqual([])
  })

  it('leaves out matches still on court', () => {
    const live: Match = {
      ...played(['Ana', 'Ben'], ['Cara', 'Dan'], 0, 0, null),
      score_a: null,
      score_b: null,
    }
    expect(playerMatches('Ana', [live])).toEqual([])
  })

  it('returns newest first regardless of input order', () => {
    const older = played(['Ana', 'Ben'], ['Cara', 'Dan'], 11, 7, '2026-08-04T19:00:00Z')
    const newer = played(['Ana', 'Cara'], ['Ben', 'Dan'], 9, 11, '2026-08-04T20:30:00Z')
    expect(playerMatches('Ana', [older, newer]).map((m) => m.match.ended_at)).toEqual([
      newer.ended_at,
      older.ended_at,
    ])
  })

  it('agrees with the standings table on the same matches', () => {
    // Two computations of one truth: if they ever disagree, a player's profile
    // and the leaderboard are telling them different things about the same night.
    const matches = [
      played(['Ana', 'Ben'], ['Cara', 'Dan'], 11, 7, '2026-08-04T19:00:00Z'),
      played(['Cara', 'Ana'], ['Ben', 'Dan'], 6, 11, '2026-08-04T19:40:00Z'),
      played(['Dan', 'Ana'], ['Ben', 'Cara'], 11, 9, '2026-08-04T20:20:00Z'),
    ]
    const mine = playerMatches('Ana', matches)
    const row = standings(roster('Ana', 'Ben', 'Cara', 'Dan'), matches).find(
      (r) => r.name === 'Ana',
    )!

    expect(mine).toHaveLength(row.games)
    expect(mine.filter((m) => m.won)).toHaveLength(row.wins)
    expect(mine.reduce((sum, m) => sum + m.scoreMine, 0)).toBe(row.pointsFor)
    expect(mine.reduce((sum, m) => sum + m.scoreTheirs, 0)).toBe(row.pointsAgainst)
  })
})
