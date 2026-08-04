import { describe, expect, it } from 'vitest'
import { avatarColor, initials } from './Avatar'
import { contrast, palette } from '../theme'

describe('initials', () => {
  it('takes the first letter of the first two words', () => {
    expect(initials('Albert Andrada')).toBe('AA')
    expect(initials('Bea')).toBe('B')
    expect(initials('Maria Clara Santos')).toBe('MC')
  })

  it('survives messy input', () => {
    expect(initials('  bea  ')).toBe('B')
    expect(initials('')).toBe('?')
    expect(initials('   ')).toBe('?')
  })
})

describe('avatarColor', () => {
  it('is stable for the same name', () => {
    expect(avatarColor('Bea')).toBe(avatarColor('Bea'))
  })

  it('spreads names across the palette', () => {
    const names = ['Bea', 'Marco', 'Rayne', 'Kenji', 'Lara', 'Pao', 'Drew', 'Via']
    expect(new Set(names.map(avatarColor)).size).toBeGreaterThan(1)
  })

  it('always returns a swatch that carries white text at AA', () => {
    const names = ['Bea', 'Marco', 'Rayne', 'Kenji', 'Lara', 'Pao', 'Drew', 'Via', 'Z', 'Aa']
    for (const name of names) {
      expect(contrast(palette.surface, avatarColor(name))).toBeGreaterThanOrEqual(4.5)
    }
  })
})
