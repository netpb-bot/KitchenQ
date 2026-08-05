import { describe, expect, it } from 'vitest'
import { scoreError } from './ScoreEntry'

// Mirrors check_score in supabase/migrations/0006_scoring.sql. If these drift,
// the client disables Save on a legal score or lets an illegal one round-trip.
describe('scoreError', () => {
  it('accepts a game won at the target and one won past it', () => {
    expect(scoreError(11, 2, 11, 9)).toBe('')
    expect(scoreError(11, 2, 9, 11)).toBe('')
    expect(scoreError(11, 2, 12, 10)).toBe('')
    expect(scoreError(15, 2, 15, 0)).toBe('')
  })

  it('rejects an empty field, which num() reports as -1', () => {
    expect(scoreError(11, 2, -1, 11)).toBe('Enter both scores.')
  })

  it('rejects a winner short of the target', () => {
    expect(scoreError(11, 2, 10, 8)).toBe('The winner must reach 11.')
    expect(scoreError(15, 2, 11, 9)).toBe('The winner must reach 15.')
  })

  it('rejects too thin a margin, including a tie', () => {
    expect(scoreError(11, 2, 11, 10)).toBe('The winner must win by 2.')
    expect(scoreError(11, 2, 11, 11)).toBe('The winner must win by 2.')
  })

  it('rejects a game that ran on past the point the lead was reached', () => {
    expect(scoreError(11, 2, 13, 10)).toBe(
      'Past 11, the game ends as soon as the lead reaches 2.',
    )
  })
})
