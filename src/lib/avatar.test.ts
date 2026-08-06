import { describe, expect, it } from 'vitest'
import { cropRect } from './avatar'

const landscape = { width: 400, height: 200 }
const portrait = { width: 200, height: 400 }
const centre = { x: 0, y: 0 }

describe('cropRect', () => {
  it('centre-crops to the shorter side at rest', () => {
    expect(cropRect(landscape, 1, centre)).toEqual({ sx: 100, sy: 0, size: 200 })
    expect(cropRect(portrait, 1, centre)).toEqual({ sx: 0, sy: 100, size: 200 })
  })

  it('samples a smaller square as it zooms in', () => {
    expect(cropRect(landscape, 2, centre)).toEqual({ sx: 150, sy: 50, size: 100 })
  })

  it('never zooms out past the image', () => {
    expect(cropRect(landscape, 0.25, centre)).toEqual(cropRect(landscape, 1, centre))
  })

  it('clamps a pan to the edges rather than showing blank', () => {
    const right = cropRect(landscape, 1, { x: 9999, y: 9999 })
    expect(right).toEqual({ sx: 200, sy: 0, size: 200 })

    const left = cropRect(landscape, 1, { x: -9999, y: -9999 })
    expect(left).toEqual({ sx: 0, sy: 0, size: 200 })
  })

  it('stays inside the image on every axis while zoomed', () => {
    const { sx, sy, size } = cropRect(portrait, 3, { x: -500, y: 500 })
    expect(sx).toBeGreaterThanOrEqual(0)
    expect(sy + size).toBeLessThanOrEqual(portrait.height)
  })
})
