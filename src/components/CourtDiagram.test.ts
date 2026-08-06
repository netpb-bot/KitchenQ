import { describe, expect, it } from 'vitest'
import { courtSummary, type CourtSide } from './CourtDiagram'

const side = (...names: string[]): CourtSide => names.map((name) => ({ name }))

describe('courtSummary', () => {
  // The four avatars and their plates are aria-hidden, so this string is the
  // whole court to a screen reader. If it stops naming everyone, the diagram
  // silently becomes unreadable to anyone not looking at it.
  it('names all four players, both sides of the net', () => {
    expect(courtSummary(side('Ana', 'Ben'), side('Cara', 'Dan'))).toBe(
      'Ana and Ben versus Cara and Dan',
    )
  })

  // LiveCourt maps an unknown id to 'Unknown' rather than dropping the player,
  // so a guest the name map hasn't caught up with still gets announced.
  it('keeps a placeholder in place rather than shortening a side', () => {
    expect(courtSummary(side('Ana', 'Unknown'), side('Cara', 'Dan'))).toBe(
      'Ana and Unknown versus Cara and Dan',
    )
  })

  it('survives a half-filled court', () => {
    expect(courtSummary(side('Ana'), side('Cara', 'Dan'))).toBe('Ana versus Cara and Dan')
  })
})
