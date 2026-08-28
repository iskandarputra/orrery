import { describe, expect, it } from 'vitest'
import {
  actualSize,
  clampZoom,
  fitBounds,
  panBy,
  transformOf,
  zoomAround,
  zoomToCentre,
  type Bounds,
  type ZoomLimits
} from './pan-zoom'

const LIMITS: ZoomLimits = { min: 0.25, max: 4 }
const box = (w: number, h: number): Bounds => ({ minX: 0, minY: 0, maxX: w, maxY: h })

describe('clampZoom', () => {
  it('holds the zoom inside its limits', () => {
    expect(clampZoom(1, LIMITS)).toBe(1)
    expect(clampZoom(0.01, LIMITS)).toBe(0.25)
    expect(clampZoom(99, LIMITS)).toBe(4)
  })
})

describe('zoomAround', () => {
  it('keeps the point under the cursor pinned', () => {
    const before = { x: 30, y: -10, zoom: 1 }
    // The content point currently drawn at (cx, cy).
    const cx = 120
    const cy = 80
    const contentX = (cx - before.x) / before.zoom
    const contentY = (cy - before.y) / before.zoom

    const after = zoomAround(before, 1.5, cx, cy, LIMITS)

    expect(after.zoom).toBe(1.5)
    expect(after.x + contentX * after.zoom).toBeCloseTo(cx)
    expect(after.y + contentY * after.zoom).toBeCloseTo(cy)
  })

  it('does not drift the pan when the zoom is already at a limit', () => {
    const at = { x: 12, y: 34, zoom: LIMITS.max }
    expect(zoomAround(at, 2, 100, 100, LIMITS)).toEqual(at)
  })
})

describe('zoomToCentre', () => {
  it('pins the middle of the viewport', () => {
    const rect = { width: 200, height: 100 }
    const after = zoomToCentre({ x: 0, y: 0, zoom: 1 }, 2, rect, LIMITS)
    expect(after.zoom).toBe(2)
    // The content point at the centre was (100, 50); it must still land there.
    expect(after.x + 100 * 2).toBeCloseTo(100)
    expect(after.y + 50 * 2).toBeCloseTo(50)
  })
})

describe('fitBounds', () => {
  it('picks the tighter axis and centres the content', () => {
    // 400x100 content in a 200x200 viewport: width is the binding constraint.
    const v = fitBounds({ width: 200, height: 200 }, box(400, 100), LIMITS)
    expect(v.zoom).toBeCloseTo(0.5)
    expect(v.x).toBeCloseTo(100 - 200 * 0.5)
    expect(v.y).toBeCloseTo(100 - 50 * 0.5)
  })

  it('leaves padding on both sides of each axis', () => {
    const bare = fitBounds({ width: 200, height: 200 }, box(100, 100), LIMITS)
    const padded = fitBounds({ width: 200, height: 200 }, box(100, 100), LIMITS, 25)
    expect(bare.zoom).toBeCloseTo(2)
    // 100 + 2*25 = 150 of content across 200 of viewport.
    expect(padded.zoom).toBeCloseTo(200 / 150)
  })

  it('will not zoom past the limits to fill the viewport', () => {
    // A 10x10 diagram in a huge viewport would want 40x; the limit is 4x.
    expect(fitBounds({ width: 400, height: 400 }, box(10, 10), LIMITS).zoom).toBe(4)
  })

  it('returns the identity for empty content or an unmeasured viewport', () => {
    expect(fitBounds({ width: 200, height: 200 }, box(0, 0), LIMITS)).toEqual({
      x: 0,
      y: 0,
      zoom: 1
    })
    expect(fitBounds({ width: 0, height: 0 }, box(50, 50), LIMITS)).toEqual({ x: 0, y: 0, zoom: 1 })
  })
})

describe('actualSize', () => {
  it('centres the content at 1:1 whatever the viewport', () => {
    const v = actualSize({ width: 300, height: 200 }, box(100, 50))
    expect(v.zoom).toBe(1)
    expect(v.x).toBe(150 - 50)
    expect(v.y).toBe(100 - 25)
  })
})

describe('panBy', () => {
  it('translates without touching the zoom', () => {
    expect(panBy({ x: 5, y: 5, zoom: 2 }, -3, 7)).toEqual({ x: 2, y: 12, zoom: 2 })
  })
})

describe('transformOf', () => {
  it('translates before it scales, so pan is in viewport pixels', () => {
    expect(transformOf({ x: 4, y: -8, zoom: 1.5 })).toBe('translate(4px, -8px) scale(1.5)')
  })
})
