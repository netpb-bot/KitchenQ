import { avatarColor, initials } from './Avatar'
import { palette } from '../theme'

/**
 * A pickleball court with the four players standing on their actual sides.
 *
 * Proportions are the real ones — 44ft by 20ft, with a 7ft non-volley zone
 * ("the kitchen") either side of the net — so the shape reads as a pickleball
 * court from across a gym rather than as a generic rectangle.
 */

const FEET_LONG = 44
const FEET_WIDE = 20
const KITCHEN_FEET = 7

// One foot = 5 user units. The whole diagram scales with its container.
const SCALE = 5
const W = FEET_LONG * SCALE // 220
const H = FEET_WIDE * SCALE // 100
const NET = W / 2
const KITCHEN = KITCHEN_FEET * SCALE

export type CourtSide = { name: string }[]

export function CourtDiagram({
  teamA,
  teamB,
  className = '',
}: {
  /** Left half of the diagram. */
  teamA: CourtSide
  /** Right half. */
  teamB: CourtSide
  className?: string
}) {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={`w-full ${className}`}
      role="img"
      aria-label={`${teamA.map((p) => p.name).join(' and ')} versus ${teamB
        .map((p) => p.name)
        .join(' and ')}`}
    >
      {/* Playing surface */}
      <rect x="0" y="0" width={W} height={H} rx="6" fill={palette.tint} />

      {/* Service boxes: the centre line runs from each baseline to the kitchen. */}
      <line x1="0" y1={H / 2} x2={NET - KITCHEN} y2={H / 2} stroke={palette.hairline} strokeWidth="1.5" />
      <line x1={NET + KITCHEN} y1={H / 2} x2={W} y2={H / 2} stroke={palette.hairline} strokeWidth="1.5" />

      {/* Kitchen — the non-volley zone, filled so it reads at a glance. */}
      <rect x={NET - KITCHEN} y="0" width={KITCHEN * 2} height={H} fill={palette.brand} opacity="0.14" />
      <line x1={NET - KITCHEN} y1="0" x2={NET - KITCHEN} y2={H} stroke={palette.hairline} strokeWidth="1.5" />
      <line x1={NET + KITCHEN} y1="0" x2={NET + KITCHEN} y2={H} stroke={palette.hairline} strokeWidth="1.5" />

      {/* Net */}
      <line
        x1={NET}
        y1="-2"
        x2={NET}
        y2={H + 2}
        stroke={palette.ink}
        strokeWidth="2.5"
        strokeDasharray="3 3"
      />

      <rect
        x="0.75"
        y="0.75"
        width={W - 1.5}
        height={H - 1.5}
        rx="6"
        fill="none"
        stroke={palette.hairline}
        strokeWidth="1.5"
      />

      {teamA.map((player, i) => (
        <PlayerMark key={`a${i}`} name={player.name} x={NET / 2} y={i === 0 ? H * 0.27 : H * 0.73} />
      ))}
      {teamB.map((player, i) => (
        <PlayerMark
          key={`b${i}`}
          name={player.name}
          x={NET + NET / 2}
          y={i === 0 ? H * 0.27 : H * 0.73}
        />
      ))}
    </svg>
  )
}

function PlayerMark({ name, x, y }: { name: string; x: number; y: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r="13" fill={avatarColor(name)} stroke={palette.surface} strokeWidth="2" />
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        fill={palette.surface}
        fontSize="11"
        fontWeight="600"
      >
        {initials(name)}
      </text>
      <text
        x={x}
        y={y + 24}
        textAnchor="middle"
        fill={palette.ink}
        fontSize="9"
        fontWeight="600"
      >
        {truncate(name)}
      </text>
    </g>
  )
}

/** First name only, and clipped — the diagram is glanced at, not read. */
function truncate(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? name
  return first.length > 10 ? `${first.slice(0, 9)}…` : first
}
