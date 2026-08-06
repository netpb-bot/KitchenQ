import { describe, expect, it } from 'vitest'
import { fitDimensions } from './image'

// `downscale` itself needs a canvas, and this suite runs without a DOM by
// design. The arithmetic is the part that can be wrong silently — a swapped
// axis or an upscale only shows up as a blurry card three screens away.
describe('fitDimensions', () => {
  it('caps the long edge of a landscape photo', () => {
    expect(fitDimensions(4032, 3024, 1200)).toEqual({ w: 1200, h: 900 })
  })

  it('caps the long edge of a portrait photo', () => {
    expect(fitDimensions(3024, 4032, 1200)).toEqual({ w: 900, h: 1200 })
  })

  it('handles a square', () => {
    expect(fitDimensions(2000, 2000, 1200)).toEqual({ w: 1200, h: 1200 })
  })

  it('leaves a smaller image alone rather than upscaling it', () => {
    expect(fitDimensions(640, 480, 1200)).toEqual({ w: 640, h: 480 })
  })

  it('never returns a zero dimension', () => {
    // A 3000x1 sliver scales its short edge to 0.4, which would throw on canvas.
    expect(fitDimensions(3000, 1, 1200).h).toBe(1)
  })
})
