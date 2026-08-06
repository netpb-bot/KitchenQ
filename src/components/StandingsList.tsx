import type { ReactNode } from 'react'
import { Avatar } from './Avatar'
import { Card } from './ui'
import type { Standing } from '../lib/standings'

/**
 * The ranked table, identical whether it covers one night or the whole club.
 * No medals, no icons — the recap podium is the only celebration surface.
 *
 * Callers that cap the table pass a `<ShowAllRow>` as `children`; it lands as
 * the last row inside the card, on the divider rhythm.
 */
export function StandingsList({
  table,
  meId,
  children,
}: {
  table: Standing[]
  meId?: string
  children?: ReactNode
}) {
  return (
    <Card className="divide-y divide-hairline p-0">
      {table.map((row, i) => (
        <div key={row.memberId} className="flex items-center gap-3 px-4 py-3">
          <span className="tnum w-5 shrink-0 text-meta font-semibold text-muted">{i + 1}</span>
          <Avatar id={row.memberId} name={row.name} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-medium text-ink">
              {row.name}
              {row.memberId === meId && (
                <span className="ml-1.5 text-meta font-medium text-muted">(you)</span>
              )}
            </p>
            <p className="tnum mt-0.5 text-meta text-muted">
              {row.wins}–{row.losses} · {row.diff >= 0 ? '+' : ''}
              {row.diff} pts
            </p>
          </div>
          <span className="tnum text-body font-semibold text-primary">
            {Math.round(row.rate * 100)}%
          </span>
        </div>
      ))}
      {children}
    </Card>
  )
}

/** Why the top of the table isn't simply whoever won most. */
export function RankingNote() {
  return (
    <p className="mt-3 text-meta leading-relaxed text-muted">
      Ranked by adjusted win rate — a record is pulled toward 50% until you have
      played enough games for it to mean something, so one lucky win doesn't top
      the table. Ties break on point difference.
    </p>
  )
}
