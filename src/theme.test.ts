import { describe, expect, it } from 'vitest'
import { FORBIDDEN_PAIRS, TEXT_PAIRS, contrast, palette } from './theme'

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
