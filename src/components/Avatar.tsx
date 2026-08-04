/**
 * Colored initial circles. The colour is derived from the display name, so a
 * player looks the same everywhere without storing anything. Photo upload is
 * deferred — when it lands, this stays as the fallback.
 */

// Every swatch here carries white text at >= 4.5:1. Asserted in Avatar.test.ts.
const SWATCHES = [
  '#1E7A6F', // teal
  '#B85C1E', // orange
  '#1F6FB2', // blue
  '#4A7C15', // green
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
  sm: 'h-8 w-8 text-[11px]',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-lg',
  xl: 'h-20 w-20 text-2xl',
} as const

export function Avatar({
  name,
  size = 'md',
  ring,
}: {
  name: string
  size?: keyof typeof SIZES
  /** Draws a page-coloured ring, for avatars overlapping other elements. */
  ring?: boolean
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${SIZES[size]} ${ring ? 'ring-2 ring-page' : ''}`}
      style={{ backgroundColor: avatarColor(name) }}
      aria-hidden
    >
      {initials(name)}
    </span>
  )
}
