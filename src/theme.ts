/**
 * The palette, mirrored from the @theme block in index.css so it can be
 * asserted in tests and used where a JS value is genuinely needed (SVG fills
 * in the court diagram). index.css remains the source of truth for styling —
 * this is a typed copy, and theme.test.ts fails if it drifts from the CSS or
 * if a pair falls below contrast.
 */
export const palette = {
  page: '#F7F9F2',
  surface: '#FFFFFF',
  surfaceDark: '#2E4A0C',
  surfaceDarker: '#1E3308',
  surfaceSunk: '#E7EDDC',

  brand: '#7CB518',
  primary: '#4A7C15',
  accent: '#C6E82F',
  tint: '#EDF7D4',

  ink: '#1A2416',
  muted: '#65745D',
  hairline: '#E3EAD8',

  warn: '#8A5800',
  warnFill: '#F0B429',
  warnTint: '#FDF0D9',
  danger: '#C0392B',
  dangerTint: '#FBE9E7',

  // Second and third on the podium. Gold is warnFill — the amber is already in
  // the palette and a second near-identical yellow would be a token for nothing.
  silver: '#C3CCBB',
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

  // Dark hero cards
  ['surface', 'surfaceDark'],
  ['accent', 'surfaceDark'],
  ['surface', 'surfaceDarker'],
  ['accent', 'surfaceDarker'],

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
