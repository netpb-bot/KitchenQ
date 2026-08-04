import { Avatar } from './Avatar'

/**
 * One recorded result: two teams facing each other across the score. Shared by
 * the session history and a player's own record so a match reads the same
 * wherever it appears.
 */
export function MatchResult({
  teamA,
  teamB,
  scoreA,
  scoreB,
  names,
}: {
  teamA: string[]
  teamB: string[]
  scoreA: number
  scoreB: number
  names: Map<string, string>
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
      <TeamLine ids={teamA} names={names} won={scoreA > scoreB} />
      <p className="tnum text-lg font-bold text-ink">
        {scoreA}–{scoreB}
      </p>
      <TeamLine ids={teamB} names={names} won={scoreB > scoreA} align="right" />
    </div>
  )
}

export function TeamLine({
  ids,
  names,
  won,
  align = 'left',
}: {
  ids: string[]
  names: Map<string, string>
  won: boolean
  align?: 'left' | 'right'
}) {
  return (
    <div className={align === 'right' ? 'text-right' : ''}>
      <div className={`flex items-center gap-1.5 ${align === 'right' ? 'justify-end' : ''}`}>
        {ids.map((id) => (
          <Avatar key={id} name={names.get(id) ?? 'Unknown'} size="sm" />
        ))}
      </div>
      <p
        className={`mt-1 truncate text-xs ${won ? 'font-bold text-primary' : 'font-medium text-muted'}`}
      >
        {ids.map((id) => firstName(names.get(id) ?? 'Unknown')).join(' & ')}
      </p>
    </div>
  )
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}
