import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { debounce, randomCode } from './db'

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

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('does not run until the quiet period has passed', () => {
    const fn = vi.fn()
    debounce(fn, 250)()
    vi.advanceTimersByTime(249)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('collapses a burst into one call', () => {
    // The case this exists for: ending a match fires roughly nine realtime
    // events, and each one used to cost a seven-request refetch.
    const fn = vi.fn()
    const run = debounce(fn, 250)
    for (let i = 0; i < 9; i++) run()
    vi.advanceTimersByTime(250)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('restarts the clock on every call', () => {
    const fn = vi.fn()
    const run = debounce(fn, 250)
    run()
    vi.advanceTimersByTime(200)
    run()
    vi.advanceTimersByTime(200)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(50)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('runs again for a later, separate change', () => {
    const fn = vi.fn()
    const run = debounce(fn, 250)
    run()
    vi.advanceTimersByTime(250)
    run()
    vi.advanceTimersByTime(250)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('cancel stops a pending call, so unmounting cannot refetch', () => {
    const fn = vi.fn()
    const run = debounce(fn, 250)
    run()
    run.cancel()
    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()
  })
})
