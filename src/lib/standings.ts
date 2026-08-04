/**
 * Session standings. Pure — no Supabase, no React — so the ranking a player
 * argues about on court can be reproduced in a test.
 */
import type { Match } from './db'

/**
 * Bayesian shrinkage constant: every player starts as if they had already gone
 * 2.5–2.5. A 1–0 player lands at 58%, a 12–3 player at 73%, so one lucky game
 * cannot top the table on a club night.
 */
export const SHRINKAGE = 5

export type Standing = {
  memberId: string
  name: string
  games: number
  wins: number
  losses: number
  pointsFor: number
  pointsAgainst: number
  /** Points scored minus points conceded — the tiebreak. */
  diff: number
  /** Adjusted win rate, 0–1. Ranking is on this, not raw wins. */
  rate: number
}

type ScoredMatch = Pick<Match, 'team_a_ids' | 'team_b_ids' | 'score_a' | 'score_b' | 'ended_at'>

export function adjustedWinRate(wins: number, games: number): number {
  return (wins + SHRINKAGE * 0.5) / (games + SHRINKAGE)
}

/**
 * Ranked standings for one session. Players who haven't finished a game are
 * left out: with no results, shrinkage puts them at exactly 50%, which would
 * rank them above everyone having a bad night purely for not playing.
 */
export function standings(
  players: { memberId: string; name: string }[],
  matches: ScoredMatch[],
): Standing[] {
  const table = new Map<string, Standing>(
    players.map((p) => [
      p.memberId,
      {
        memberId: p.memberId,
        name: p.name,
        games: 0,
        wins: 0,
        losses: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        diff: 0,
        rate: 0,
      },
    ]),
  )

  function credit(ids: string[], scored: number, conceded: number) {
    for (const id of ids) {
      // A match id with no roster row can only come from a member deleted out
      // from under the session; skipping keeps the table renderable.
      const row = table.get(id)
      if (!row) continue
      row.games++
      if (scored > conceded) row.wins++
      else row.losses++
      row.pointsFor += scored
      row.pointsAgainst += conceded
      row.diff = row.pointsFor - row.pointsAgainst
    }
  }

  for (const m of matches) {
    if (!m.ended_at || m.score_a === null || m.score_b === null) continue
    credit(m.team_a_ids, m.score_a, m.score_b)
    credit(m.team_b_ids, m.score_b, m.score_a)
  }

  return [...table.values()]
    .filter((row) => row.games > 0)
    .map((row) => ({ ...row, rate: adjustedWinRate(row.wins, row.games) }))
    .sort(
      (x, y) =>
        y.rate - x.rate ||
        y.diff - x.diff ||
        y.wins - x.wins ||
        x.name.localeCompare(y.name),
    )
}

/** One finished match, turned around to face the player looking at it. */
export type PlayerMatch = {
  match: Match
  won: boolean
  scoreMine: number
  scoreTheirs: number
  partnerIds: string[]
  opponentIds: string[]
}

/**
 * A player's finished matches, newest first, seen from their side of the net.
 * Which team they were on is an accident of how the host tapped them in, so
 * every screen showing "you won 11–7" has to flip the score — doing that once
 * here is the difference between a record and a plausible-looking lie.
 */
export function playerMatches(memberId: string, matches: Match[]): PlayerMatch[] {
  const mine: PlayerMatch[] = []

  for (const m of matches) {
    if (!m.ended_at || m.score_a === null || m.score_b === null) continue
    const onA = m.team_a_ids.includes(memberId)
    const onB = m.team_b_ids.includes(memberId)
    if (!onA && !onB) continue

    const ours = onA ? m.team_a_ids : m.team_b_ids
    const theirs = onA ? m.team_b_ids : m.team_a_ids
    const scoreMine = onA ? m.score_a : m.score_b
    const scoreTheirs = onA ? m.score_b : m.score_a

    mine.push({
      match: m,
      won: scoreMine > scoreTheirs,
      scoreMine,
      scoreTheirs,
      partnerIds: ours.filter((id) => id !== memberId),
      opponentIds: theirs,
    })
  }

  return mine.sort(
    (x, y) => new Date(y.match.ended_at!).getTime() - new Date(x.match.ended_at!).getTime(),
  )
}
