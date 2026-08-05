import { readFileSync, readdirSync } from 'node:fs'
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

/**
 * TEXT_PAIRS can only check colours the variant maps declare. It cannot see the
 * bug that actually shipped: a light-surface colour picked at a call site that
 * happens to sit inside a DarkCard. Three failed writes were being announced in
 * `accent` — the success green — and two buttons were ink on near-black.
 *
 * ponytail: a string scan, not a render. It catches every case in the codebase
 * today; reach for a DOM test only when one appears that this cannot see.
 */
describe('nothing light-surface inside a DarkCard', () => {
  const BANNED: Array<[RegExp, string]> = [
    [/text-ink\b/, 'use text-white'],
    [/text-muted\b/, 'use text-white/70 or text-white/55'],
    [/text-accent\b(?=[^>]*role="alert")/, 'an error is not the success green'],
    [/text-danger(?!-on-dark)\b/, 'use text-danger-on-dark — danger is 1.8:1 here'],
    [/text-warn(?!-fill)\b/, 'use text-warn-fill'],
    [/variant="secondary"/, 'use variant="secondaryOnDark"'],
    [/variant="ghost"/, 'use variant="ghostOnDark"'],
  ]

  function sources(dir: URL): URL[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? sources(new URL(`${e.name}/`, dir))
        : e.name.endsWith('.tsx')
          ? [new URL(e.name, dir)]
          : [],
    )
  }

  /** Every `<DarkCard …>…</DarkCard>` body in the app, tagged with its origin. */
  const blocks = sources(new URL('./', import.meta.url)).flatMap((file) => {
    const source = readFileSync(file, 'utf8')
    const found: Array<[string, string]> = []
    for (let i = source.indexOf('<DarkCard'); i !== -1; i = source.indexOf('<DarkCard', i + 9)) {
      const end = source.indexOf('</DarkCard>', i)
      // The component's own definition in ui.tsx has no closing tag.
      if (end === -1) continue
      const line = source.slice(0, i).split('\n').length
      found.push([`${file.pathname.split('/').pop()}:${line}`, source.slice(i, end)])
      i = end
    }
    return found
  })

  it('finds the DarkCards to check', () => {
    expect(blocks.length).toBeGreaterThan(2)
  })

  it.each(blocks)('%s carries no light-surface colour', (_where, block) => {
    for (const [pattern, fix] of BANNED) {
      expect(pattern.test(block), `${pattern.source} — ${fix}`).toBe(false)
    }
  })
})
