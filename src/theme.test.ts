import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FORBIDDEN_PAIRS, TEXT_PAIRS, contrast, palette } from './theme'

/** `--color-foo-bar: #abc123;` -> `fooBar`, matching the palette's keys. */
function camel(cssName: string): string {
  return cssName.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

describe('palette mirrors index.css', () => {
  // The comment on `palette` claims index.css is the source of truth. Nothing
  // enforced that, so editing a token in the CSS left the SVG court diagram
  // painting the old colour with no test failing anywhere.
  // Read off disk rather than imported: Vitest stubs CSS imports to an empty
  // string, and `?raw` does not escape that.
  const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
  const theme = css.slice(css.indexOf('@theme {'), css.indexOf('\n}', css.indexOf('@theme {')))
  const declared = [...theme.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map(
    ([, name, hex]) => [camel(name), hex.toUpperCase()] as const,
  )

  it('finds every token in the CSS', () => {
    expect(declared.length).toBeGreaterThan(10)
  })

  it.each(declared)('--color-%s matches palette', (key, hex) => {
    expect(palette[key as keyof typeof palette]).toBe(hex)
  })

  it('has no palette entry the CSS does not declare', () => {
    expect(Object.keys(palette).sort()).toEqual(declared.map(([k]) => k).sort())
  })
})

describe('contrast', () => {
  it('matches known WCAG values', () => {
    expect(contrast('#FFFFFF', '#000000')).toBeCloseTo(21, 1)
    expect(contrast('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 2)
    // Symmetric — argument order must not matter.
    expect(contrast(palette.ink, palette.surface)).toBeCloseTo(
      contrast(palette.surface, palette.ink),
      5,
    )
  })
})

describe('palette', () => {
  it.each(TEXT_PAIRS)('%s on %s meets AA (4.5:1)', (fg, bg) => {
    expect(contrast(palette[fg], palette[bg])).toBeGreaterThanOrEqual(4.5)
  })

  // The whole reason the brand/primary split exists. If someone "simplifies"
  // them back into one token, this is what catches it.
  it.each(FORBIDDEN_PAIRS)('%s on %s stays forbidden', (fg, bg) => {
    expect(contrast(palette[fg], palette[bg])).toBeLessThan(4.5)
  })

  it('brand cannot carry white text', () => {
    expect(contrast(palette.surface, palette.brand)).toBeLessThan(4.5)
    expect(contrast(palette.ink, palette.brand)).toBeGreaterThanOrEqual(4.5)
  })
})
