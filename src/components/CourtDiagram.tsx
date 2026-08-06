import { useId } from 'react'
import { Avatar, TierBadge } from './Avatar'
import type { Tier } from '../lib/db'
import { palette } from '../theme'

/**
 * A pickleball court with the four players standing on their actual sides.
 *
 * Proportions are the real ones — 44ft by 20ft, with a 7ft non-volley zone
 * ("the kitchen") either side of the net — so the shape reads as a pickleball
 * court from across a gym rather than as a generic rectangle.
 *
 * The players are HTML laid over the SVG, not drawn inside it. Names have to
 * sit with their own circle — a caption row under the court made people match
 * initials back to avatars, which two players sharing a first letter makes
 * impossible — and SVG text cannot truncate, so a long name inside the viewBox
 * either overflows the court or gets chopped at a character count. As a side
 * effect this reuses <Avatar>, which handles a photo URL that 404s; the SVG
 * <image> it replaces had no such fallback and rendered a broken glyph.
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

export type CourtSide = { name: string; id?: string; tier?: Tier }[]

export function CourtDiagram({
  teamA,
  teamB,
  meId,
  className = '',
  muted,
}: {
  /** Left half of the diagram. */
  teamA: CourtSide
  /** Right half. */
  teamB: CourtSide
  /** The viewer's club_members.id, so their own spot can say so. */
  meId?: string | null
  className?: string
  /** Faded, for a court standing empty. */
  muted?: boolean
}) {
  const empty = teamA.length === 0 && teamB.length === 0
  // Several courts render on one screen, so the clip path needs an id per card.
  const clip = useId()

  return (
    <div className={`relative ${className}`}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={`block w-full ${muted ? 'opacity-45' : ''}`}
        role={empty ? 'img' : undefined}
        aria-label={empty ? 'Empty court' : undefined}
        aria-hidden={empty ? undefined : true}
      >
        <defs>
          <clipPath id={clip}>
            <rect x="0" y="0" width={W} height={H} rx="6" />
          </clipPath>
        </defs>

        {/* Playing surface */}
        <rect x="0" y="0" width={W} height={H} rx="6" fill={palette.tint} />

        {/* Team zones: partners share a wash, so "who is with whom" is answered
            before a single name is read. Alpha over the surface rather than two
            new palette entries — nothing carries text directly on these (every
            name sits on its own plate), so there is no new contrast pair.
            Clipped, because square corners would poke out of the rounded court. */}
        {!empty && (
          <g clipPath={`url(#${clip})`}>
            <rect x="0" y="0" width={NET} height={H} fill={palette.brand} opacity="0.1" />
            <rect x={NET} y="0" width={NET} height={H} fill={palette.ink} opacity="0.045" />
          </g>
        )}

        {/* Court lines are white, as they are on a real court: they separate the
            surface from the card without adding another grey to the palette. */}
        {/* Service boxes: the centre line runs from each baseline to the kitchen. */}
        <line x1="0" y1={H / 2} x2={NET - KITCHEN} y2={H / 2} stroke={palette.surface} strokeWidth="1.5" />
        <line x1={NET + KITCHEN} y1={H / 2} x2={W} y2={H / 2} stroke={palette.surface} strokeWidth="1.5" />

        {/* Kitchen — the non-volley zone, filled so it reads at a glance. */}
        <rect x={NET - KITCHEN} y="0" width={KITCHEN * 2} height={H} fill={palette.brand} opacity="0.14" />
        <line x1={NET - KITCHEN} y1="0" x2={NET - KITCHEN} y2={H} stroke={palette.surface} strokeWidth="1.5" />
        <line x1={NET + KITCHEN} y1="0" x2={NET + KITCHEN} y2={H} stroke={palette.surface} strokeWidth="1.5" />

        {/* Net: a light span between two darker posts. Solid-and-heavy reads as a
            pole and dashed reads as a cut-here line — the net should recede and
            let the four players carry the picture. */}
        <line x1={NET} y1="2" x2={NET} y2={H - 2} stroke={palette.ink} strokeWidth="1.5" opacity="0.22" />
        <line x1={NET} y1="1" x2={NET} y2="4" stroke={palette.ink} strokeWidth="2.5" opacity="0.55" />
        <line x1={NET} y1={H - 4} x2={NET} y2={H - 1} stroke={palette.ink} strokeWidth="2.5" opacity="0.55" />

        {/* Outer boundary in hairline, not white: the card behind it is white, so
            a white edge erases the court's outline entirely. */}
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
      </svg>

      {!empty && (
        <>
          <div className="absolute inset-0 grid grid-cols-2" aria-hidden>
            <TeamHalf side={teamA} meId={meId} />
            <TeamHalf side={teamB} meId={meId} />
          </div>

          {/* On the net, where the two teams meet. Half the reason the zones
              read as two teams rather than as a gradient. */}
          <span
            aria-hidden
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-surface px-1.5 py-0.5 text-[9px] font-bold tracking-[0.08em] text-muted uppercase shadow-card"
          >
            vs
          </span>

          {/* The overlay above is decorative markup — avatars, plates, badges.
              This is the sentence a screen reader gets instead. */}
          <p className="sr-only">{courtSummary(teamA, teamB)}</p>
        </>
      )}
    </div>
  )
}

/** Two players, stacked, filling their half of the court. */
function TeamHalf({ side, meId }: { side: CourtSide; meId?: string | null }) {
  return (
    <div className="grid grid-rows-2">
      {side.map((player, i) => (
        <PlayerMark key={player.id ?? i} player={player} me={!!meId && player.id === meId} />
      ))}
    </div>
  )
}

/**
 * A quadrant has to hold the avatar and the plate at every width, and the court
 * is 2.2:1, so its height is the card's width / 4.4. The narrowest phone gives
 * 320 - 40 (main px-5) - 32 (Card p-4) = 248px of court, so 56px per quadrant.
 * `sm` (32) + gap (2) + plate (18.5) = 52.5 fits; `md` (40) does not. Which is
 * also the size TierBadge was drawn for. Bump either number and 320px breaks.
 */
function PlayerMark({ player, me }: { player: CourtSide[number]; me: boolean }) {
  return (
    <div className="flex min-w-0 flex-col items-center justify-center gap-0.5 px-1">
      <Avatar
        id={player.id}
        name={player.name}
        size="sm"
        // White rim, as on the SVG marks this replaces: the court underneath is
        // tinted, and the page-coloured ring would read as a smudge on it.
        ring="surface"
        // Tier rides the avatar rather than the name plate, so the four levels
        // on court can be compared without reading any words.
        badge={player.tier && <TierBadge tier={player.tier} />}
      />
      {/* A plate, not bare text: the court's service lines are white 1.5px and
          run straight under this row. `truncate` needs min-w-0 above it. */}
      <span
        className={`max-w-full truncate rounded-full px-1.5 py-px text-[11px] leading-[1.5] font-semibold ${
          // Colour is not the only cue — the plate says "You" as well. Inverted
          // rather than tinted so it cannot be read as a status.
          me ? 'bg-ink text-surface' : 'bg-surface/90 text-ink'
        }`}
      >
        {me ? 'You' : player.name}
      </span>
    </div>
  )
}

/** "Ana and Ben versus Cara and Dan" — the court, read aloud. */
export function courtSummary(teamA: CourtSide, teamB: CourtSide): string {
  const side = (s: CourtSide) => s.map((p) => p.name).join(' and ')
  return `${side(teamA)} versus ${side(teamB)}`
}
