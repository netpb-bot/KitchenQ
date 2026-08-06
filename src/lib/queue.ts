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
 *
 * The one thing that moves a player out of tier order is their own decision:
 * two players who agree to partner up both drop to the later of their two
 * positions (see `applyPairs`). That only ever gives a place away, so the
 * guarantee above survives — it just becomes "nobody is put behind someone with
 * more games unless they asked to be".
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
  /**
   * club_members.id of an accepted partner, who is also waiting and points
   * back. Set by `applyPairs`; absent for everyone playing on their own.
   */
  partnerId?: string
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

/**
 * Fold accepted pairings into the queue.
 *
 * Both partners take the worse of the two positions — the higher games-played
 * and the later queued-at — so agreeing to play together can only ever cost you
 * your own place in line, never buy you someone else's. Landing them on the
 * same games-played number is also what keeps them in the same tier, and a pair
 * that spans two tiers is a pair `selectionPool` would have to split.
 *
 * A pairing whose other half is on court, sitting out or gone home is dropped
 * here rather than tracked: they are simply not in `waiting`, so the
 * arrangement lies dormant until they come back, at no cost to anyone.
 */
export function applyPairs(
  waiting: QueuePlayer[],
  pairs: [string, string][],
): QueuePlayer[] {
  const byId = new Map(waiting.map((p) => [p.memberId, p]))
  const paired = new Map<string, QueuePlayer>()

  for (const [a, b] of pairs) {
    const one = byId.get(a)
    const two = byId.get(b)
    // The database allows a player only one accepted pairing at a time; the
    // `paired.has` guard is for a client holding a stale read of two.
    if (!one || !two || paired.has(a) || paired.has(b)) continue

    const gamesPlayed = Math.max(one.gamesPlayed, two.gamesPlayed)
    const queuedAt = Math.max(one.queuedAt, two.queuedAt)
    paired.set(a, { ...one, gamesPlayed, queuedAt, partnerId: b })
    paired.set(b, { ...two, gamesPlayed, queuedAt, partnerId: a })
  }

  if (paired.size === 0) return waiting
  return waiting.map((p) => paired.get(p.memberId) ?? p)
}

/**
 * The id a player sorts under once ties are reached — their partner's or their
 * own, whichever is lower, so a pair shares one and lands adjacent.
 *
 * Adjacency is not free from equal keys alone: `end_match` stamps the same
 * `queued_at` on all four players of a finished match in one statement, so
 * exact ties are routine rather than a curiosity.
 */
function anchor(p: QueuePlayer): string {
  if (!p.partnerId) return p.memberId
  return p.memberId < p.partnerId ? p.memberId : p.partnerId
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Sorted by who most deserves the next game: fewest games, then longest wait. */
export function queueOrder(players: QueuePlayer[]): QueuePlayer[] {
  return [...players].sort(
    (a, b) =>
      a.gamesPlayed - b.gamesPlayed ||
      a.queuedAt - b.queuedAt ||
      compareIds(anchor(a), anchor(b)) ||
      compareIds(a.memberId, b.memberId),
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

  const search = (respectPairs: boolean): Lineup | null => {
    let best: Lineup | null = null
    let bestCost = Infinity

    for (const fill of combinations(choosable, slots)) {
      const four = [...required, ...fill]
      if (respectPairs && !intact(four)) continue
      for (const lineup of pairings(four, respectPairs)) {
        const cost = lineupCost(lineup, four, waitRank, penalties)
        if (cost < bestCost) {
          bestCost = cost
          best = lineup
        }
      }
    }

    return best
  }

  // An odd number of open slots can leave a pair with nowhere to fit. A court
  // standing empty is worse for everyone than an arrangement going unhonoured
  // for one round, so the second pass drops the constraint entirely.
  return search(true) ?? search(false)
}

/** True unless the four holds one half of a pair and not the other. */
function intact(four: QueuePlayer[]): boolean {
  const ids = new Set(four.map((p) => p.memberId))
  return four.every((p) => !p.partnerId || ids.has(p.partnerId))
}

/* ----------------------------------------------------------------- forecast */

/** Until the night has a finished match to measure, assume a rec-doubles game. */
const DEFAULT_MATCH_MS = 12 * 60 * 1000

/**
 * The band a measured match length is allowed to land in.
 *
 * A rec-doubles game is not ninety seconds and it is not an hour. The median
 * defends against one match left running while everyone went to dinner, but not
 * against the opposite: a start mis-tapped and scored straight away records a
 * ten-second match, and on a quiet night that one sample is the median. Every
 * row on the screen then reads "any minute" and everyone waits a quarter hour,
 * which is the single fastest way to make the queue look like it is lying.
 */
const MIN_MATCH_MS = 5 * 60 * 1000
const MAX_MATCH_MS = 30 * 60 * 1000

/**
 * The soonest a running match is ever reported as ending. A game that overruns
 * would otherwise sit at "~0 min" for the rest of its life, which reads as a
 * broken clock rather than a long rally.
 */
const MIN_REMAINING_MS = 60 * 1000

/** A court and when it comes free. Epoch ms; a court free right now is `now`. */
export type CourtSlot = { court: number; freeAt: number }

export type Upcoming = { court: number; lineup: Lineup; freeAt: number }

export type Forecast = {
  /** Next lineup per court, soonest-free first. Courts that can't fill are omitted. */
  courts: Upcoming[]
  /** Epoch ms each waiting player is expected on court. Absent = no idea yet. */
  onCourtAt: Map<string, number>
}

/**
 * Lineups the host has fixed by hand, keyed by court number: four slots, where
 * 0 and 1 are team A and 2 and 3 are team B.
 *
 * Sparse on purpose. A host who has named two of the four leaves the other two
 * `undefined`, and so does a pin whose player has since gone home — the engine
 * fills whatever is left rather than the whole edit collapsing.
 */
export type Pins = Map<number, (string | undefined)[]>

/**
 * The host's lineup for one court, completed from the queue — or null if this
 * court is the engine's to decide after all.
 *
 * ponytail: the slots the host left open are filled in plain queue order, not
 * by the balance-and-variety search in `lineupCost`. Once a host has taken a
 * court over, "the longest waiter takes the empty slot" is a rule they can
 * predict; optimising around fixed slots would mean teaching `pickNextMatch` to
 * enumerate partial lineups, which is surgery on the one function the whole
 * product rests on. Upgrade path if the filled slots ever look unfair: give
 * `pickNextMatch` a `forced: (string | undefined)[]` and filter `pairings`.
 */
function pinnedLineup(
  slots: (string | undefined)[] | undefined,
  available: QueuePlayer[],
): Lineup | null {
  if (!slots) return null

  const free = new Set(available.map((p) => p.memberId))
  // A pinned player who is resting, gone, or already claimed by a court freeing
  // sooner loses their slot. Only their slot: the other three stand.
  const four = Array.from({ length: 4 }, (_, i) =>
    slots[i] && free.has(slots[i]!) ? slots[i] : undefined,
  )
  if (four.every((id) => id === undefined)) return null

  const taken = new Set(four.filter((id): id is string => id !== undefined))
  const fill = queueOrder(available.filter((p) => !taken.has(p.memberId)))

  let next = 0
  for (let i = 0; i < 4; i++) {
    if (four[i]) continue
    const p = fill[next++]
    // Not enough people left to finish the court. Same answer as an engine pick
    // that comes up short: no lineup.
    if (!p) return null
    four[i] = p.memberId
  }

  const [w, x, y, z] = four as string[]
  return { teamA: [w, x], teamB: [y, z] }
}

/**
 * How long a match takes tonight, for wait estimates.
 *
 * Median, not mean: one match left running while everyone went to dinner would
 * drag an average far enough to make every estimate on the screen wrong. Then
 * clamped, because a median of one bad sample is still one bad sample.
 */
export function typicalMatchMs(
  matches: { started_at: string; ended_at: string | null }[],
): number {
  const lengths = matches
    .filter((m) => m.ended_at)
    .map((m) => new Date(m.ended_at!).getTime() - new Date(m.started_at).getTime())
    .filter((ms) => ms > 0)
    .sort((a, b) => a - b)

  if (lengths.length === 0) return DEFAULT_MATCH_MS
  const mid = Math.floor(lengths.length / 2)
  const median =
    lengths.length % 2 === 1 ? lengths[mid] : (lengths[mid - 1] + lengths[mid]) / 2
  return Math.min(Math.max(median, MIN_MATCH_MS), MAX_MATCH_MS)
}

/**
 * When a running match frees its court.
 *
 * ponytail: elapsed time is the only signal there is — scores are entered when
 * a match ends, so nothing here knows a game is at 10-10. If live scoring ever
 * lands, weight this by points remaining.
 */
export function courtFreeAt(startedAt: number, typicalMs: number, now: number): number {
  return Math.max(startedAt + typicalMs, now + MIN_REMAINING_MS)
}

/**
 * Who plays next on each court, and roughly when everyone else gets on.
 *
 * The same walk the host's open courts already did — pick, claim the four,
 * move on so two courts never propose the same person — extended to courts
 * that are still playing, so a waiting player can be told their match before
 * the court is free.
 *
 * Only one round deep on purpose. A player arriving mid-session has no games
 * yet, so `queueOrder` puts them at the *front*; anything past the current
 * round gets reshuffled by every walk-in and would visibly churn.
 */
export function forecast(
  waiting: QueuePlayer[],
  courts: CourtSlot[],
  history: PastMatch[],
  typicalMs: number,
  pins: Pins = new Map(),
): Forecast {
  const claimed = new Set<string>()
  const upcoming: Upcoming[] = []
  const onCourtAt = new Map<string, number>()

  // Stable sort, so courts freeing at the same moment keep their numbering.
  for (const slot of [...courts].sort((a, b) => a.freeAt - b.freeAt)) {
    const available = waiting.filter((p) => !claimed.has(p.memberId))
    // The host's word first. Falls through to the engine when this court has no
    // pins, or when nobody the host pinned is still available to play.
    const lineup =
      pinnedLineup(pins.get(slot.court), available) ?? pickNextMatch(available, history)
    if (!lineup) break

    upcoming.push({ court: slot.court, lineup, freeAt: slot.freeAt })
    for (const id of [...lineup.teamA, ...lineup.teamB]) {
      claimed.add(id)
      onCourtAt.set(id, slot.freeAt)
    }
  }

  // Nobody is playing anywhere, so there is no clock to estimate against.
  if (upcoming.length === 0) return { courts: [], onCourtAt }

  // Everyone left is at least a full round behind: a court has to come free,
  // play one of the matches above, and come free again.
  //
  // Each court keeps its own clock. Pricing everyone off the first court's told
  // the back of the queue they were on in ten minutes while the court that would
  // actually take them was still twenty minutes into a match — and counting
  // every court in the session rather than the ones that could be filled
  // understated the wait again on top of that.
  const nextFree = upcoming.map((u) => u.freeAt + typicalMs)
  const rest = queueOrder(waiting).filter((p) => !claimed.has(p.memberId))
  for (let i = 0; i < rest.length; i += 4) {
    // The court coming free soonest takes the next four, then goes to the back.
    const soonest = nextFree.indexOf(Math.min(...nextFree))
    for (const p of rest.slice(i, i + 4)) onCourtAt.set(p.memberId, nextFree[soonest])
    // ponytail: every future match is assumed to run typicalMs. Per-court
    // history would be precision a median of the whole night can't support.
    nextFree[soonest] += typicalMs
  }

  return { courts: upcoming, onCourtAt }
}

/**
 * The queue as it will actually happen, which is not the same list as
 * `queueOrder` gives.
 *
 * A row's number is a promise about who plays next, so it has to come from the
 * same walk that filled the courts. `queueOrder` is only one of the three things
 * `pickNextMatch` weighs — it will skip the fourth-longest waiter to balance the
 * teams — and a court the host pinned by hand ignores it outright. Numbering by
 * the ranking rule while playing by the forecast is how a row ends up reading
 * "9. Ana · up next", which is the queue telling a player one thing and then
 * doing another in front of them.
 *
 * Past the first round nobody has been picked yet, so the ranking rule is the
 * honest answer for the tail. One round is all `forecast` commits to.
 */
export function queueView(waiting: QueuePlayer[], plan: Forecast): QueuePlayer[] {
  const byId = new Map(waiting.map((p) => [p.memberId, p]))
  const picked = plan.courts.flatMap((c) => [...c.lineup.teamA, ...c.lineup.teamB])
  const claimed = new Set(picked)
  return [
    ...picked.flatMap((id) => byId.get(id) ?? []),
    ...queueOrder(waiting).filter((p) => !claimed.has(p.memberId)),
  ]
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

/**
 * The three ways to split four players into two pairs, minus any that would put
 * partners across the net from each other.
 *
 * With one accepted pair among the four exactly one split survives, which is
 * the whole guarantee the two of them agreed to.
 */
function pairings(four: QueuePlayer[], respectPairs = true): Lineup[] {
  const [w, x, y, z] = four.map((p) => p.memberId)
  const all: Lineup[] = [
    { teamA: [w, x], teamB: [y, z] },
    { teamA: [w, y], teamB: [x, z] },
    { teamA: [w, z], teamB: [x, y] },
  ]
  if (!respectPairs) return all

  const ids = new Set(four.map((p) => p.memberId))
  const partners = new Map(
    four
      .filter((p) => p.partnerId && ids.has(p.partnerId))
      .map((p) => [p.memberId, p.partnerId!]),
  )
  if (partners.size === 0) return all

  return all.filter((lineup) =>
    [lineup.teamA, lineup.teamB].every(
      ([a, b]) => (partners.get(a) ?? b) === b && (partners.get(b) ?? a) === a,
    ),
  )
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
