import { Avatar } from './Avatar'
import { Card } from './ui'
import type { Standing } from '../lib/standings'

/**
 * The ranked table, identical whether it covers one night or the whole club.
 * No medals, no icons — the recap podium is the only celebration surface.
 */
export function StandingsList({ table, meId }: { table: Standing[]; meId?: string }) {
  return (
    <Card className="divide-y divide-hairline p-0">
      {table.map((row, i) => (
        <div key={row.memberId} className="flex items-center gap-3 px-4 py-3">
          <span className="tnum w-5 shrink-0 text-sm font-bold text-muted">{i + 1}</span>
          <Avatar name={row.name} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-ink">
              {row.name}
              {row.memberId === meId && (
                <span className="ml-1.5 text-sm font-medium text-muted">(you)</span>
              )}
            </p>
            <p className="tnum mt-0.5 text-xs text-muted">
              {row.wins}–{row.losses} · {row.diff >= 0 ? '+' : ''}
              {row.diff} pts
            </p>
          </div>
          <span className="tnum text-base font-bold text-primary">
            {Math.round(row.rate * 100)}%
          </span>
        </div>
      ))}
    </Card>
  )
}

/** Why the top of the table isn't simply whoever won most. */
export function RankingNote() {
  return (
    <p className="mt-3 text-xs leading-relaxed text-muted">
      Ranked by adjusted win rate — a record is pulled toward 50% until you have
      played enough games for it to mean something, so one lucky win doesn't top
      the table. Ties break on point difference.
    </p>
  )
}
