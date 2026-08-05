import { describe, expect, it } from 'vitest'
import { courtState } from './LiveSession'

describe('courtState', () => {
  it('never offers a startable court before the session is live', () => {
    // The bug: a draft session with four people waiting rendered a live-looking
    // "Start match" that only Postgres could refuse.
    expect(courtState('draft', true, true)).toBe('locked')
    expect(courtState('draft', true, false)).toBe('open')
    expect(courtState('draft', false, true)).toBe('open')
  })

  it('shows no lineup at all once the night is over', () => {
    expect(courtState('ended', true, true)).toBe('open')
    expect(courtState('ended', false, true)).toBe('open')
  })

  it('is startable only for the host, only while live, only with four players', () => {
    expect(courtState('live', true, true)).toBe('ready')
    expect(courtState('live', true, false)).toBe('open')
    expect(courtState('live', false, true)).toBe('open')
  })
})
