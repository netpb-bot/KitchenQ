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
