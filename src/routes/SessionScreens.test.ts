import { describe, expect, it } from 'vitest'
import { deleteWarning } from './SessionScreens'

describe('deleteWarning', () => {
  it('asks plainly when there is nothing to lose', () => {
    expect(deleteWarning(0, 0)).toBe('Delete this session?')
  })

  it('names matches on their own', () => {
    expect(deleteWarning(12, 0)).toBe('Delete this and 12 matches?')
  })

  it('names payments on their own', () => {
    expect(deleteWarning(0, 8)).toBe('Delete this and 8 payments?')
  })

  it('names both', () => {
    expect(deleteWarning(12, 8)).toBe('Delete this, 12 matches and 8 payments?')
  })

  // A host who deletes a session with one scored game should not read "1 matchs".
  it('counts one of each as singular', () => {
    expect(deleteWarning(1, 1)).toBe('Delete this, 1 match and 1 payment?')
  })
})
