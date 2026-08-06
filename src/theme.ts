/**
 * The palette, mirrored from the @theme block in index.css so it can be
 * asserted in tests and used where a JS value is genuinely needed (SVG fills
 * in the court diagram). index.css remains the source of truth for styling —
 * this is a typed copy, and theme.test.ts fails if it drifts from the CSS or
 * if a pair falls below contrast.
 */
export const palette = {
  page: '#FAF9F7',
  surface: '#FFFFFF',
  surfaceDark: '#16181A',
  surfaceDarker: '#0E0F11',
  surfaceSunk: '#E9E7E1',

  brand: '#7CB518',
  primary: '#41701A',
  accent: '#B6DE4F',
  tint: '#EEF4E2',

  ink: '#1A1A18',
  muted: '#6E6C66',
  hairline: '#E6E3DD',

  warn: '#8A5800',
  warnFill: '#F0B429',
  warnTint: '#FDF0D9',
  danger: '#B3261E',
  dangerTint: '#FBEAE8',
  dangerOnDark: '#FFB4AB',

  // Second and third on the podium. Gold is warnFill — the amber is already in
  // the palette and a second near-identical yellow would be a token for nothing.
  silver: '#C9C7C0',
  bronze: '#CD7F32',
} as const

export type PaletteKey = keyof typeof palette

/** WCAG 2.1 relative luminance. */
export function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16)
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

/** WCAG contrast ratio, 1–21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * WHAT EACH COLOUR SAYS
 *
 * One meaning per colour. A colour that means three things means nothing, and
 * the audit that produced this list found green doing duty as the CTA, as
 * "live", and — on dark cards — as the error state.
 *
 *   primary, filled      the one main action on this view. Not for an action
 *                        that repeats down a list: a column of filled green
 *                        stops reading as an action at all.
 *   tint + primary text  a positive action at low weight. Mark paid.
 *   brand / accent       the same two jobs, on a dark surface. Never on light.
 *   fill (neutral)       a supporting action, or one of several equals.
 *   ghost                dismiss, cancel, optional extras. Nothing with a
 *                        consequence.
 *   danger               destructive, or a write that failed. Nothing else —
 *                        in particular not money owed, which is not an error.
 *   warn / warnFill      unresolved: owing, partial, not started yet. Never a
 *                        finished state, however that state turned out.
 *
 * And none of them alone: WCAG 1.4.1 is Level A, so every status carries a
 * second cue — a word, an icon, a weight, or a shape — for the ~1 in 12 men
 * with a colour vision deficiency.
 */

/**
 * Every foreground/background pair the UI actually uses. Adding a new colour
 * combination to a component means adding it here — that is the point.
 */
export const TEXT_PAIRS: Array<[PaletteKey, PaletteKey]> = [
  // Body text on light surfaces
  ['ink', 'page'],
  ['ink', 'surface'],
  ['muted', 'page'],
  ['muted', 'surface'],
  ['primary', 'page'],
  ['primary', 'surface'],

  // Pills and tinted rows
  ['ink', 'tint'],
  ['primary', 'tint'],
  ['warn', 'warnTint'],
  ['danger', 'dangerTint'],
  ['warn', 'surface'],
  ['danger', 'surface'],

  // Filled controls. brand and warnFill take ink; primary and danger take white.
  ['ink', 'brand'],
  ['ink', 'accent'],
  ['ink', 'warnFill'],
  ['surface', 'primary'],
  ['surface', 'danger'],
  // The court's "You" plate, inverted so it cannot be mistaken for a status.
  ['surface', 'ink'],

  // Dark hero cards. `brand` is legible here even though it is illegal on
  // white — the LIVE pill keeps its fill against a near-black card.
  ['surface', 'surfaceDark'],
  ['accent', 'surfaceDark'],
  ['brand', 'surfaceDark'],
  ['surface', 'surfaceDarker'],
  ['accent', 'surfaceDarker'],

  // The on-dark halves of danger and warn. `danger` itself is 1.8:1 here, which
  // is why failed writes on a dark card used to be printed in the success green.
  ['dangerOnDark', 'surfaceDark'],
  ['dangerOnDark', 'surfaceDarker'],
  ['warnFill', 'surfaceDark'],

  // Podium medals. All three carry ink, never white.
  ['ink', 'silver'],
  ['ink', 'bronze'],
]

/** Pairs that must NEVER appear — asserted to fail, so a refactor can't sneak them in. */
export const FORBIDDEN_PAIRS: Array<[PaletteKey, PaletteKey]> = [
  ['surface', 'brand'],
  ['surface', 'accent'],
  ['surface', 'warnFill'],
]
