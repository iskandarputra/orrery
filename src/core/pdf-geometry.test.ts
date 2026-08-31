import { describe, expect, it } from 'vitest'
import {
  asRotation,
  dragToPdf,
  drawnSize,
  scaleFromDrawnWidth,
  toCss,
  toCssBox,
  toPdf,
  type PageGeometry,
  type Rotation
} from './pdf-geometry'

const PAGE = { width: 612, height: 792 }
const ROTATIONS: Rotation[] = [0, 90, 180, 270]

const at = (rotation: Rotation, scale = 1): PageGeometry => ({ ...PAGE, scale, rotation })

describe('placing a point on a drawn page', () => {
  it('puts the bottom left of an upright page at the bottom left of the screen', () => {
    expect(toCss(at(0), { x: 0, y: 0 })).toEqual({ x: 0, y: 792 })
    expect(toCss(at(0), { x: 612, y: 792 })).toEqual({ x: 612, y: 0 })
  })

  it('agrees with the viewport pdf.js drew with, at every rotation', async () => {
    // The one check worth more than my own arithmetic: pdf.js positions the
    // pixels, so the boxes have to be placed by the same transform pdf.js used
    // and not by a second opinion about what that transform is.
    const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as {
      getDocument(options: unknown): { promise: Promise<PdfjsDoc> }
    }
    const pdf = await pdfjs.getDocument({ data: onePage(), isEvalSupported: false }).promise
    const page = await pdf.getPage(1)

    const scale = 1.5
    const probes = [
      { x: 0, y: 0 },
      { x: 612, y: 792 },
      { x: 72, y: 700 },
      { x: 500, y: 40 }
    ]
    for (const rotation of ROTATIONS) {
      const viewport = page.getViewport({ scale, rotation })
      const mine = at(rotation, scale)
      expect(drawnSize(mine).width).toBeCloseTo(viewport.width, 6)
      expect(drawnSize(mine).height).toBeCloseTo(viewport.height, 6)
      for (const probe of probes) {
        const [x, y] = viewport.convertToViewportPoint(probe.x, probe.y)
        const got = toCss(mine, probe)
        expect(got.x).toBeCloseTo(x, 6)
        expect(got.y).toBeCloseTo(y, 6)
      }
    }
  })

  it('comes back to where it started', () => {
    for (const rotation of ROTATIONS) {
      const page = at(rotation, 1.75)
      const point = { x: 123.5, y: 456.25 }
      const back = toPdf(page, toCss(page, point))
      expect(back.x).toBeCloseTo(point.x, 6)
      expect(back.y).toBeCloseTo(point.y, 6)
    }
  })
})

describe('the size of the drawn page', () => {
  it('swaps the sides when the page is on its side', () => {
    expect(drawnSize(at(0, 2))).toEqual({ width: 1224, height: 1584 })
    expect(drawnSize(at(90, 2))).toEqual({ width: 1584, height: 1224 })
    expect(drawnSize(at(180, 2))).toEqual({ width: 1224, height: 1584 })
    expect(drawnSize(at(270, 2))).toEqual({ width: 1584, height: 1224 })
  })

  it('reads the scale back off a turned page without halving it', () => {
    // 792 units of page across 792 pixels of screen is 1.0 — measuring that
    // against the page's 612-unit width instead says 1.29, and every box on a
    // turned page is then a third too big.
    expect(scaleFromDrawnWidth(792, PAGE, 90)).toBeCloseTo(1, 6)
    expect(scaleFromDrawnWidth(612, PAGE, 0)).toBeCloseTo(1, 6)
    expect(scaleFromDrawnWidth(1584, PAGE, 270)).toBeCloseTo(2, 6)
  })

  it('does not divide by a page with no width', () => {
    expect(scaleFromDrawnWidth(500, { width: 0, height: 0 }, 0)).toBe(1)
  })
})

describe('dragging', () => {
  it('follows the pointer whichever way the page is turned', () => {
    // Rightwards and downwards on the screen, in every orientation. The point
    // is that the object goes the way the hand went: which PDF axis that is
    // depends on the page, but the sign on screen never changes.
    const push = { x: 10, y: 6 }
    for (const rotation of ROTATIONS) {
      const page = at(rotation, 2)
      const moved = dragToPdf(page, push)
      const start = { x: 300, y: 400 }
      const before = toCss(page, start)
      const after = toCss(page, { x: start.x + moved.x, y: start.y + moved.y })
      expect(after.x - before.x).toBeCloseTo(push.x, 6)
      expect(after.y - before.y).toBeCloseTo(push.y, 6)
    }
  })

  it('is a direction and not a place, so it never picks up the page size', () => {
    expect(dragToPdf({ scale: 1, rotation: 0 }, { x: 0, y: 0 })).toEqual({ x: 0, y: -0 })
    expect(dragToPdf({ scale: 1, rotation: 180 }, { x: 0, y: 0 })).toEqual({ x: -0, y: 0 })
  })
})

describe('a box around something', () => {
  it('stays a box when the corners swap places', () => {
    const bounds = { left: 100, right: 200, top: 700, bottom: 680 }
    for (const rotation of ROTATIONS) {
      const box = toCssBox(at(rotation), bounds)
      expect(box.width).toBeGreaterThan(0)
      expect(box.height).toBeGreaterThan(0)
      // Turned a quarter, the long side of the box is the one going down.
      const turned = rotation === 90 || rotation === 270
      expect(turned ? box.height : box.width).toBeCloseTo(100, 6)
      expect(turned ? box.width : box.height).toBeCloseTo(20, 6)
    }
  })

  it('gives a hairline enough of a box to be clicked', () => {
    const rule = { left: 100, right: 500, top: 400, bottom: 400 }
    expect(toCssBox(at(0), rule).height).toBe(2)
  })
})

describe('rotations that arrive from elsewhere', () => {
  it('folds anything into the four', () => {
    expect(asRotation(0)).toBe(0)
    expect(asRotation(450)).toBe(90)
    expect(asRotation(-90)).toBe(270)
    expect(asRotation(360)).toBe(0)
    expect(asRotation(-450)).toBe(270)
  })
})

interface PdfjsDoc {
  numPages: number
  getPage(n: number): Promise<{
    getViewport(options: { scale: number; rotation: number }): {
      width: number
      height: number
      convertToViewportPoint(x: number, y: number): [number, number]
    }
  }>
}

/**
 * One US-Letter page, written out here rather than imported.
 *
 * The fixture that builds proper PDFs lives under `main`, and `core` is below
 * `main` — reaching up for it puts a test in two TypeScript projects at once.
 * All this needs is a page with a size, and pdf.js rebuilds the cross-reference
 * table it has not been given.
 */
function onePage(): Uint8Array {
  const body = [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj',
    'trailer << /Root 1 0 R /Size 4 >>',
    '%%EOF'
  ].join('\n')
  return new TextEncoder().encode(body)
}
