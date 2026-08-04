/**
 * Matchmaking. Pure functions over plain data — no Supabase, no React — so the
 * fairness rules can be tested directly. See queue.test.ts.
 *
 * Fairness is a hard constraint, not a preference. Players are drawn in whole
 * games-played tiers: nobody with more games goes on court while somebody with
 * fewer is still waiting. That single rule is what guarantees the spread across
 * a night never exceeds one game, and it cannot be traded away for a
 * better-balanced or more varied lineup.
 *
 * Balance and variety then decide freely *within* a tier, where every candidate
 * has an equal claim to the court.
 */

import type { Tier } from './db'

export type QueuePlayer = {
  /** club_members.id — the id every match and ledger row refers to. */
  memberId: string
  name: string
  tier: Tier
  /** Epoch ms. Set on join, bumped each time the player finishes a match. */
  queuedAt: number
  gamesPlayed: number
}

export type PastMatch = { teamA: string[]; teamB: string[] }

export type Lineup = { teamA: [string, string]; teamB: [string, string] }

const TIER_RATING: Record<Tier, number> = {
  beginner: 1,
  intermediate: 2,
  advanced: 3,
}

/** How many past matches count as "recent" when penalising repeat pairings. */
const RECENT_DEPTH = 6

/** Bounds the search. 10 choose 4 is 210 lineups — instant, and deep enough. */
const MAX_CANDIDATES = 10

/**
 * Soft weights, applied only among players with an equal claim to the court.
 * Wait order is the weakest signal here on purpose: everyone in the tier has
 * played the same number of games, so who waited a few seconds longer matters
 * less than getting a balanced, non-repeating match.
 */
const WEIGHT = {
  waitOrder: 6,
  imbalance: 12,
  repeat: 8,
} as const

/** Sorted by who most deserves the next game: fewest games, then longest wait. */
export function queueOrder(players: QueuePlayer[]): QueuePlayer[] {
  return [...players].sort(
    (a, b) => a.gamesPlayed - b.gamesPlayed || a.queuedAt - b.queuedAt,
  )
}

/**
 * Split the queue into the players who *must* be on the next court and those
 * competing for the remaining slots.
 *
 * Whole tiers of equal games-played are taken until one would overflow four;
 * that overflowing tier is the only place there is a choice to make.
 */
export function selectionPool(queue: QueuePlayer[]): {
  required: QueuePlayer[]
  choosable: QueuePlayer[]
} {
  const required: QueuePlayer[] = []
  let index = 0

  while (index < queue.length) {
    const games = queue[index].gamesPlayed
    const tier = queue.filter((p) => p.gamesPlayed === games)
    if (required.length + tier.length > 4) {
      return { required, choosable: tier.slice(0, MAX_CANDIDATES) }
    }
    required.push(...tier)
    index += tier.length
    if (required.length === 4) break
  }

  return { required, choosable: [] }
}

/** The next match to put on court, or null if fewer than four are waiting. */
export function pickNextMatch(
  waiting: QueuePlayer[],
  recent: PastMatch[] = [],
): Lineup | null {
  const queue = queueOrder(waiting)
  if (queue.length < 4) return null

  const { required, choosable } = selectionPool(queue)
  const slots = 4 - required.length
  const penalties = repeatPenalties(recent.slice(0, RECENT_DEPTH))
  const waitRank = new Map(queue.map((p, i) => [p.memberId, i]))

  let best: Lineup | null = null
  let bestCost = Infinity

  for (const fill of combinations(choosable, slots)) {
    const four = [...required, ...fill]
    for (const lineup of pairings(four)) {
      const cost = lineupCost(lineup, four, waitRank, penalties)
      if (cost < bestCost) {
        bestCost = cost
        best = lineup
      }
    }
  }

  return best
}

/* ------------------------------------------------------------------ scoring */

function lineupCost(
  lineup: Lineup,
  four: QueuePlayer[],
  waitRank: Map<string, number>,
  penalties: Map<string, number>,
): number {
  const waitCost = four.reduce((sum, p) => sum + (waitRank.get(p.memberId) ?? 0), 0)

  const rating = new Map(four.map((p) => [p.memberId, TIER_RATING[p.tier]]))
  const teamRating = (team: [string, string]) =>
    (rating.get(team[0]) ?? 0) + (rating.get(team[1]) ?? 0)
  const imbalance = Math.abs(teamRating(lineup.teamA) - teamRating(lineup.teamB))

  const partnerRepeat =
    (penalties.get(pairKey(lineup.teamA[0], lineup.teamA[1])) ?? 0) +
    (penalties.get(pairKey(lineup.teamB[0], lineup.teamB[1])) ?? 0)

  // Facing the same opponents again is milder than partnering them again.
  let opponentRepeat = 0
  for (const a of lineup.teamA) {
    for (const b of lineup.teamB) {
      opponentRepeat += (penalties.get(pairKey(a, b)) ?? 0) * 0.5
    }
  }

  return (
    waitCost * WEIGHT.waitOrder +
    imbalance * WEIGHT.imbalance +
    (partnerRepeat + opponentRepeat) * WEIGHT.repeat
  )
}

/**
 * How recently each pair of players shared a court. The most recent match
 * counts most, so an immediate rematch is what the engine avoids hardest.
 */
function repeatPenalties(recent: PastMatch[]): Map<string, number> {
  const penalties = new Map<string, number>()
  recent.forEach((match, index) => {
    const weight = RECENT_DEPTH - index
    const everyone = [...match.teamA, ...match.teamB]
    for (let i = 0; i < everyone.length; i++) {
      for (let j = i + 1; j < everyone.length; j++) {
        const key = pairKey(everyone[i], everyone[j])
        penalties.set(key, (penalties.get(key) ?? 0) + weight)
      }
    }
  })
  return penalties
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/* ------------------------------------------------------------ combinatorics */

/** The three ways to split four players into two pairs. */
function pairings(four: QueuePlayer[]): Lineup[] {
  const [w, x, y, z] = four.map((p) => p.memberId)
  return [
    { teamA: [w, x], teamB: [y, z] },
    { teamA: [w, y], teamB: [x, z] },
    { teamA: [w, z], teamB: [x, y] },
  ]
}

function* combinations<T>(items: T[], size: number): Generator<T[]> {
  if (size === 0) {
    yield []
    return
  }
  for (let i = 0; i <= items.length - size; i++) {
    for (const rest of combinations(items.slice(i + 1), size - 1)) {
      yield [items[i], ...rest]
    }
  }
}
