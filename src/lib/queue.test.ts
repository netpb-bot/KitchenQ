import { describe, expect, it } from 'vitest'
import { pickNextMatch, queueOrder, type PastMatch, type QueuePlayer } from './queue'
import type { Tier } from './db'

function player(
  memberId: string,
  opts: Partial<Omit<QueuePlayer, 'memberId'>> = {},
): QueuePlayer {
  return {
    memberId,
    name: memberId,
    tier: 'intermediate',
    queuedAt: 0,
    gamesPlayed: 0,
    ...opts,
  }
}

/** Twelve interchangeable players, all waiting the same length of time. */
function roster(count: number, tiers: Tier[] = []): QueuePlayer[] {
  return Array.from({ length: count }, (_, i) =>
    player(`p${i}`, { queuedAt: i, tier: tiers[i] ?? 'intermediate' }),
  )
}

function everyone(lineup: { teamA: string[]; teamB: string[] }): string[] {
  return [...lineup.teamA, ...lineup.teamB]
}

describe('pickNextMatch', () => {
  it('returns null below four waiting players', () => {
    expect(pickNextMatch(roster(3))).toBeNull()
  })

  // The hard fairness rule. Balance and variety may reshuffle a lineup, but
  // never at the cost of somebody who has played less.
  it('never picks a player while somebody with fewer games is still waiting', () => {
    const players = [
      ...roster(3), // p0, p1, p2 — no games yet
      player('busy1', { gamesPlayed: 1, queuedAt: 0 }),
      player('busy2', { gamesPlayed: 1, queuedAt: 1 }),
      player('busy3', { gamesPlayed: 1, queuedAt: 2 }),
    ]
    const picked = everyone(pickNextMatch(players)!)
    expect(picked).toEqual(expect.arrayContaining(['p0', 'p1', 'p2']))
    expect(picked.filter((id) => id.startsWith('busy'))).toHaveLength(1)
  })

  it('puts four distinct players on court', () => {
    const picked = everyone(pickNextMatch(roster(8))!)
    expect(new Set(picked).size).toBe(4)
  })

  it('prefers the player who has played fewer games over the one who waited longer', () => {
    const players = [
      player('busy', { queuedAt: 0, gamesPlayed: 3 }),
      ...roster(4).map((p) => ({ ...p, queuedAt: 100, gamesPlayed: 0 })),
    ]
    // 'busy' waited longest but has three games; the four fresh players go on.
    expect(everyone(pickNextMatch(players)!)).not.toContain('busy')
  })
})

describe('team balance', () => {
  it('splits two strong and two weak players across both teams', () => {
    const players = [
      player('strong1', { tier: 'advanced', queuedAt: 0 }),
      player('strong2', { tier: 'advanced', queuedAt: 1 }),
      player('new1', { tier: 'beginner', queuedAt: 2 }),
      player('new2', { tier: 'beginner', queuedAt: 3 }),
    ]
    const { teamA, teamB } = pickNextMatch(players)!
    // Each team must hold exactly one of the two strong players.
    expect(teamA.filter((id) => id.startsWith('strong'))).toHaveLength(1)
    expect(teamB.filter((id) => id.startsWith('strong'))).toHaveLength(1)
  })
})

describe('variety', () => {
  it('avoids repeating the partnership that just played', () => {
    // Eight equal players; p0 and p1 just partnered. With everything else tied,
    // the engine must not pair them again.
    const players = roster(8)
    const recent: PastMatch[] = [{ teamA: ['p0', 'p1'], teamB: ['p2', 'p3'] }]
    const { teamA, teamB } = pickNextMatch(players, recent)!
    const partnered = (a: string, b: string) =>
      (teamA.includes(a) && teamA.includes(b)) || (teamB.includes(a) && teamB.includes(b))
    expect(partnered('p0', 'p1')).toBe(false)
  })

  it('avoids an immediate rematch of the same four', () => {
    const players = roster(8)
    const recent: PastMatch[] = [{ teamA: ['p0', 'p1'], teamB: ['p2', 'p3'] }]
    const picked = new Set(everyone(pickNextMatch(players, recent)!))
    const sameFour = ['p0', 'p1', 'p2', 'p3'].every((id) => picked.has(id))
    expect(sameFour).toBe(false)
  })
})

/**
 * The fairness guarantee, checked the only way that really counts: run a whole
 * night and look at the spread. This is the test that fails if someone
 * "optimises" the cost function and quietly breaks rotation.
 */
describe('a full session rotates fairly', () => {
  function playNight(playerCount: number, courts: number, rounds: number) {
    let players = roster(playerCount)
    const history: PastMatch[] = []
    let clock = 1000

    for (let round = 0; round < rounds; round++) {
      const onCourt = new Set<string>()
      for (let court = 0; court < courts; court++) {
        const available = players.filter((p) => !onCourt.has(p.memberId))
        const lineup = pickNextMatch(available, history)
        if (!lineup) break
        everyone(lineup).forEach((id) => onCourt.add(id))
        history.unshift(lineup)
      }

      // Every match finishes: all four requeue at the back, one more game each.
      players = players.map((p) =>
        onCourt.has(p.memberId)
          ? { ...p, gamesPlayed: p.gamesPlayed + 1, queuedAt: ++clock }
          : p,
      )
    }
    return players
  }

  it('keeps every player within one game of every other (8 players, 1 court)', () => {
    const played = playNight(8, 1, 20).map((p) => p.gamesPlayed)
    expect(Math.max(...played) - Math.min(...played)).toBeLessThanOrEqual(1)
  })

  it('keeps every player within one game of every other (11 players, 2 courts)', () => {
    const played = playNight(11, 2, 20).map((p) => p.gamesPlayed)
    expect(Math.max(...played) - Math.min(...played)).toBeLessThanOrEqual(1)
  })

  it('nobody sits out two rounds while somebody else plays twice', () => {
    const played = playNight(9, 2, 15).map((p) => p.gamesPlayed)
    expect(Math.max(...played) - Math.min(...played)).toBeLessThanOrEqual(1)
  })
})

describe('queueOrder', () => {
  it('sorts by games played, then by wait', () => {
    const order = queueOrder([
      player('c', { gamesPlayed: 1, queuedAt: 0 }),
      player('a', { gamesPlayed: 0, queuedAt: 50 }),
      player('b', { gamesPlayed: 0, queuedAt: 10 }),
    ]).map((p) => p.memberId)
    expect(order).toEqual(['b', 'a', 'c'])
  })
})
