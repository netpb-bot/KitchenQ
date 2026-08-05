/**
 * Colored initial circles. The colour is derived from the display name, so a
 * player looks the same everywhere without storing anything. Photo upload is
 * deferred — when it lands, this stays as the fallback.
 */

import type { ReactNode } from 'react'
import { TIER_SHORT, type Tier } from '../lib/db'

// Every swatch here carries white text at >= 4.5:1. Asserted in Avatar.test.ts.
const SWATCHES = [
  '#1E7A6F', // teal
  '#B85C1E', // orange
  '#1F6FB2', // blue
  '#41701A', // green — tracks --color-primary
  '#7A3E9D', // purple
  '#B03060', // rose
  '#2F6B45', // forest
  '#8A5800', // bronze
] as const

export function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  return SWATCHES[Math.abs(hash) % SWATCHES.length]
}

/** First letters of the first two words: "Albert Andrada" -> "AA", "Bea" -> "B". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

const SIZES = {
  sm: 'h-8 w-8 text-caption',
  md: 'h-10 w-10 text-meta',
  lg: 'h-14 w-14 text-title',
  xl: 'h-20 w-20 text-display',
} as const

export function Avatar({
  name,
  size = 'md',
  ring,
  badge,
}: {
  name: string
  size?: keyof typeof SIZES
  /** Draws a page-coloured ring, for avatars overlapping other elements. */
  ring?: boolean
  /** Overlaps the bottom-right — a TierBadge on the queue and the court. */
  badge?: ReactNode
}) {
  const circle = (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${SIZES[size]} ${ring ? 'ring-2 ring-page' : ''}`}
      style={{ backgroundColor: avatarColor(name) }}
      aria-hidden
    >
      {initials(name)}
    </span>
  )

  if (!badge) return circle

  return (
    <span className="relative inline-flex shrink-0">
      {circle}
      <span className="absolute -right-0.5 -bottom-0.5">{badge}</span>
    </span>
  )
}

/**
 * The skill tier as three characters, sized to overlap an avatar. Kept short
 * deliberately: on a queue row the name is what people read, and a full
 * "Intermediate" pill next to every avatar is noise.
 *
 * aria-hidden because the tier is always written out in the row's text — this
 * is a second rendering of it, not a second fact.
 */
export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span
      aria-hidden
      // Sized to sit inside a 32px `sm` avatar: at px-1.5/9px it came out ~34px
      // wide — wider than the circle it rides — and read as a bar across the
      // bottom rather than a corner badge. Ratio now matches CourtDiagram's.
      className="rounded-full bg-surface-darker px-[3px] py-px text-[8px] font-bold leading-[1.4] tracking-tight text-accent ring-[1.5px] ring-surface"
    >
      {TIER_SHORT[tier]}
    </span>
  )
}
