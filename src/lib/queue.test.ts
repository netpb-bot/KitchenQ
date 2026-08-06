import { describe, expect, it } from 'vitest'
import {
  applyPairs,
  courtFreeAt,
  forecast,
  pickNextMatch,
  queueOrder,
  typicalMatchMs,
  type PastMatch,
  type QueuePlayer,
} from './queue'
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

/**
 * Two players agreeing to partner up. The rule that has to hold under all of
 * this: pairing can cost you your place in line, and can never buy you one.
 */
describe('pairing up', () => {
  const partnered = (lineup: { teamA: string[]; teamB: string[] }, a: string, b: string) =>
    (lineup.teamA.includes(a) && lineup.teamA.includes(b)) ||
    (lineup.teamB.includes(a) && lineup.teamB.includes(b))

  it('puts partners on the same team', () => {
    // p0/p2 is deliberately not the split the engine reaches for on its own —
    // with four interchangeable players it cuts them p0+p1 against p2+p3.
    expect(partnered(pickNextMatch(roster(4))!, 'p0', 'p2')).toBe(false)

    const players = applyPairs(roster(4), [['p0', 'p2']])
    expect(partnered(pickNextMatch(players)!, 'p0', 'p2')).toBe(true)
  })

  it('keeps them together against the balance the engine would otherwise want', () => {
    const players = applyPairs(
      [
        player('strong1', { tier: 'advanced', queuedAt: 0 }),
        player('strong2', { tier: 'advanced', queuedAt: 1 }),
        player('new1', { tier: 'beginner', queuedAt: 2 }),
        player('new2', { tier: 'beginner', queuedAt: 3 }),
      ],
      [['strong1', 'strong2']],
    )
    expect(partnered(pickNextMatch(players)!, 'strong1', 'strong2')).toBe(true)
  })

  // The whole point of taking the later of the two positions.
  it('drops the fresher player back to their partner, never the reverse', () => {
    const paired = applyPairs(
      [player('fresh', { gamesPlayed: 0, queuedAt: 0 }), player('busy', { gamesPlayed: 2, queuedAt: 90 })],
      [['fresh', 'busy']],
    )
    expect(paired.map((p) => p.gamesPlayed)).toEqual([2, 2])
    expect(paired.map((p) => p.queuedAt)).toEqual([90, 90])
  })

  it('does not let a pair jump the queue past somebody with fewer games', () => {
    const players = applyPairs(
      [
        player('fresh', { gamesPlayed: 0, queuedAt: 0 }),
        player('busy', { gamesPlayed: 2, queuedAt: 0 }),
        ...roster(4).map((p) => ({ ...p, gamesPlayed: 1, queuedAt: 10 })),
      ],
      [['fresh', 'busy']],
    )
    // 'fresh' had the strongest claim on court and gave it up; the four players
    // on one game go on ahead of both of them.
    const picked = everyone(pickNextMatch(players)!)
    expect(picked).not.toContain('fresh')
    expect(picked).not.toContain('busy')
  })

  it('never takes one half of a pair and leaves the other waiting', () => {
    // Three required, one slot free, and the pair is competing for it. Taking
    // either one alone is the failure this guards.
    const players = applyPairs(
      [
        ...roster(3).map((p) => ({ ...p, gamesPlayed: 0 })),
        player('a', { gamesPlayed: 1, queuedAt: 5 }),
        player('b', { gamesPlayed: 1, queuedAt: 6 }),
        player('solo', { gamesPlayed: 1, queuedAt: 7 }),
      ],
      [['a', 'b']],
    )
    const picked = everyone(pickNextMatch(players)!)
    expect(picked.includes('a')).toBe(picked.includes('b'))
    expect(picked).toContain('solo')
  })

  // A court standing empty is worse for everyone than an arrangement waiting
  // one more round.
  it('starts the match anyway when the pair cannot be fitted', () => {
    const players = applyPairs(
      [
        ...roster(3).map((p) => ({ ...p, gamesPlayed: 0 })),
        player('a', { gamesPlayed: 1, queuedAt: 5 }),
        player('b', { gamesPlayed: 1, queuedAt: 6 }),
      ],
      [['a', 'b']],
    )
    const lineup = pickNextMatch(players)
    expect(lineup).not.toBeNull()
    expect(everyone(lineup!)).toHaveLength(4)
  })

  it('ignores a pairing whose other half is not in the queue', () => {
    const players = applyPairs(roster(4), [['p0', 'gone']])
    expect(players.every((p) => p.partnerId === undefined)).toBe(true)
  })

  it('sorts partners next to each other even on identical timestamps', () => {
    // end_match stamps one queued_at across all four players of a match, so
    // exact ties are the normal case rather than a contrived one.
    const tied = [
      player('zz', { queuedAt: 100 }),
      player('mm', { queuedAt: 100 }),
      player('aa', { queuedAt: 100 }),
    ]
    const order = queueOrder(applyPairs(tied, [['zz', 'aa']])).map((p) => p.memberId)
    expect(Math.abs(order.indexOf('zz') - order.indexOf('aa'))).toBe(1)
  })

  it('still rotates everyone fairly with a pair in the queue all night', () => {
    let players = applyPairs(roster(9), [['p0', 'p8']])
    const history: PastMatch[] = []
    let clock = 1000

    for (let round = 0; round < 20; round++) {
      const lineup = pickNextMatch(players, history)
      if (!lineup) break
      const onCourt = new Set(everyone(lineup))
      history.unshift(lineup)
      players = players.map((p) =>
        onCourt.has(p.memberId)
          ? { ...p, gamesPlayed: p.gamesPlayed + 1, queuedAt: ++clock }
          : p,
      )
      // The pairing is spent after one game, exactly as end_match clears it.
      players = applyPairs(
        players.map(({ partnerId: _, ...p }) => p),
        onCourt.has('p0') && onCourt.has('p8') ? [] : [['p0', 'p8']],
      )
    }

    const played = players.map((p) => p.gamesPlayed)
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

const MIN = 60_000

describe('typicalMatchMs', () => {
  function match(startMin: number, endMin: number | null) {
    return {
      started_at: new Date(startMin * MIN).toISOString(),
      ended_at: endMin === null ? null : new Date(endMin * MIN).toISOString(),
    }
  }

  it('falls back to a default before the night has finished a match', () => {
    expect(typicalMatchMs([])).toBe(12 * MIN)
    expect(typicalMatchMs([match(0, null)])).toBe(12 * MIN)
  })

  // The reason this is a median: a match somebody forgot to score sat "running"
  // for two hours, and a mean would have put every estimate on screen at 40min.
  it('ignores the outlier a mean would swallow', () => {
    const matches = [match(0, 10), match(20, 31), match(40, 52), match(60, 180)]
    expect(typicalMatchMs(matches)).toBe(11.5 * MIN)
  })

  it('takes the middle value of an odd number of matches', () => {
    expect(typicalMatchMs([match(0, 8), match(10, 30), match(40, 52)])).toBe(12 * MIN)
  })
})

describe('courtFreeAt', () => {
  it('estimates one typical match from the start', () => {
    expect(courtFreeAt(1000, 10 * MIN, 1000)).toBe(1000 + 10 * MIN)
  })

  // A game gone to 15-13 must not report "~0 min" for the rest of its life.
  it('never reports a running match as already over', () => {
    const now = 100 * MIN
    expect(courtFreeAt(0, 10 * MIN, now)).toBe(now + MIN)
  })
})

describe('forecast', () => {
  const NOW = 1_000_000
  const courts = (...freeAt: number[]) =>
    freeAt.map((at, i) => ({ court: i + 1, freeAt: at }))

  it('fills every court with a different four', () => {
    const { courts: up } = forecast(roster(8), courts(NOW, NOW), [], 10 * MIN)
    expect(up).toHaveLength(2)
    const picked = [...everyone(up[0].lineup), ...everyone(up[1].lineup)]
    expect(new Set(picked).size).toBe(8)
  })

  it('says nothing at all below four waiting', () => {
    const { courts: up, onCourtAt } = forecast(roster(3), courts(NOW), [], 10 * MIN)
    expect(up).toEqual([])
    expect(onCourtAt.size).toBe(0)
  })

  it('stops at the last court it can fill', () => {
    const { courts: up } = forecast(roster(7), courts(NOW, NOW), [], 10 * MIN)
    expect(up).toHaveLength(1)
  })

  // The court freeing first gets first pick, whatever its number — otherwise
  // court 1's forecast holds back players who could be on court 2 sooner.
  it('gives the soonest-free court first pick of the queue', () => {
    const { courts: up } = forecast(roster(8), courts(NOW + 20 * MIN, NOW), [], 10 * MIN)
    expect(up[0].court).toBe(2)
    expect(up[0].freeAt).toBe(NOW)
    // p0..p3 waited longest, so they belong to the court that frees first.
    expect(everyone(up[0].lineup).sort()).toEqual(['p0', 'p1', 'p2', 'p3'])
  })

  it('puts a forecast player on court when their court frees', () => {
    const { onCourtAt } = forecast(roster(4), courts(NOW + 6 * MIN), [], 10 * MIN)
    expect(onCourtAt.get('p0')).toBe(NOW + 6 * MIN)
  })

  // The whole point of the leftover estimate: the 5th player is not "waiting
  // for the court to free", they are waiting for the court to free *and* for a
  // full match to be played on it.
  it('puts everyone else a full round behind', () => {
    const { onCourtAt } = forecast(roster(9), courts(NOW), [], 10 * MIN)
    expect(onCourtAt.get('p4')).toBe(NOW + 10 * MIN)
    expect(onCourtAt.get('p7')).toBe(NOW + 10 * MIN)
    // Ninth in line is two rounds out on a single court.
    expect(onCourtAt.get('p8')).toBe(NOW + 20 * MIN)
  })

  it('gives every waiting player an estimate', () => {
    const { onCourtAt } = forecast(roster(11), courts(NOW, NOW), [], 10 * MIN)
    expect(onCourtAt.size).toBe(11)
  })
})

describe('forecast with host pins', () => {
  const NOW = 1_000_000
  const courts = (...freeAt: number[]) =>
    freeAt.map((at, i) => ({ court: i + 1, freeAt: at }))
  const pins = (entries: Record<number, (string | undefined)[]>) =>
    new Map(Object.entries(entries).map(([court, slots]) => [Number(court), slots]))

  // The host looked at eight people and named four. The engine's opinion about
  // balance and repeats does not get to overrule that, and neither does the
  // order it would have put them in — the slots are the teams.
  it('uses a full pin verbatim, in slot order', () => {
    const { courts: up } = forecast(
      roster(8),
      courts(NOW),
      [],
      10 * MIN,
      pins({ 1: ['p7', 'p2', 'p5', 'p0'] }),
    )
    expect(up[0].lineup).toEqual({ teamA: ['p7', 'p2'], teamB: ['p5', 'p0'] })
  })

  // The reason pins are stored per slot rather than per lineup. One player
  // going home used to invalidate the host's whole edit; now it costs the one
  // slot, and the longest-waiting player left fills it.
  it('drops only the slot whose player is no longer waiting', () => {
    const waiting = roster(8).filter((p) => p.memberId !== 'p5')
    const { courts: up } = forecast(
      waiting,
      courts(NOW),
      [],
      10 * MIN,
      pins({ 1: ['p7', 'p2', 'p5', 'p0'] }),
    )
    expect(up[0].lineup.teamA).toEqual(['p7', 'p2'])
    expect(up[0].lineup.teamB[1]).toBe('p0')
    // p1 is the longest waiter not already spoken for.
    expect(up[0].lineup.teamB[0]).toBe('p1')
  })

  it('falls back to the engine when nobody pinned is still available', () => {
    const waiting = roster(8).filter((p) => !['p6', 'p7'].includes(p.memberId))
    const { courts: up } = forecast(
      waiting,
      courts(NOW),
      [],
      10 * MIN,
      pins({ 1: [undefined, undefined, 'p6', 'p7'] }),
    )
    expect(everyone(up[0].lineup).sort()).toEqual(['p0', 'p1', 'p2', 'p3'])
  })

  // A pinned player is claimed like any other, so the second court cannot
  // propose them too — the bug that would put someone on two courts at once.
  it('does not offer a pinned player to another court', () => {
    const { courts: up } = forecast(
      roster(8),
      courts(NOW, NOW),
      [],
      10 * MIN,
      pins({ 1: ['p7', 'p2', 'p5', 'p0'] }),
    )
    expect(up).toHaveLength(2)
    expect(new Set([...everyone(up[0].lineup), ...everyone(up[1].lineup)]).size).toBe(8)
    expect(everyone(up[1].lineup)).not.toContain('p7')
  })

  // The path every court takes on a night nobody overrides anything.
  it('is unchanged from the engine when there are no pins', () => {
    const engine = forecast(roster(9), courts(NOW, NOW + 5 * MIN), [], 10 * MIN)
    const pinned = forecast(roster(9), courts(NOW, NOW + 5 * MIN), [], 10 * MIN, new Map())
    expect(pinned).toEqual(engine)
  })
})
