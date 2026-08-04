import { describe, expect, it } from 'vitest'
import { isUnreachable } from './ConnectionBanner'

describe('isUnreachable', () => {
  // The messages the four engines actually produce when a request never lands.
  it('recognises a dead connection from every browser', () => {
    expect(isUnreachable('TypeError: Failed to fetch')).toBe(true) // Chrome
    expect(isUnreachable('NetworkError when attempting to fetch resource.')).toBe(true) // Firefox
    expect(isUnreachable('Load failed')).toBe(true) // Safari
    expect(isUnreachable('Network request failed')).toBe(true) // older WebViews
  })

  it('is not fooled by an error that merely mentions the network', () => {
    // These are real answers from the server, so the app must show them rather
    // than blaming the connection and hiding the reason.
    expect(isUnreachable('new row violates row-level security policy')).toBe(false)
    expect(isUnreachable('the winner must win by 2')).toBe(false)
    expect(isUnreachable('that match is already finished')).toBe(false)
  })

  it('treats no error as reachable', () => {
    expect(isUnreachable(undefined)).toBe(false)
    expect(isUnreachable('')).toBe(false)
  })
})
