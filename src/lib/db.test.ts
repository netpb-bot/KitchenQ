import { describe, expect, it } from 'vitest'
import { randomCode } from './db'

describe('randomCode', () => {
  const codes = Array.from({ length: 500 }, randomCode)

  it('is six characters', () => {
    for (const code of codes) expect(code).toHaveLength(6)
  })

  // These get read aloud across a gym and typed on a phone: I/1 and O/0 are
  // the pairs people mishear and mistype, so the alphabet excludes all four.
  it('never contains an ambiguous character', () => {
    for (const code of codes) expect(code).not.toMatch(/[IO01]/)
  })

  it('is uppercase alphanumeric', () => {
    for (const code of codes) expect(code).toMatch(/^[A-Z2-9]{6}$/)
  })

  it('does not repeat', () => {
    expect(new Set(codes).size).toBe(codes.length)
  })
})
