/**
 * Where a thing on a PDF page lands on the screen.
 *
 * PDF space has its origin at the bottom left and counts upwards; a browser
 * counts down from the top left. That much was handled inline. What was not is
 * rotation: the reader can turn the pages, and a turned page swaps which screen
 * axis each PDF axis runs along. Editing a rotated page put every box somewhere
 * unrelated to the words it belonged to — and since a click picks whatever box
 * is under it, that is not a cosmetic fault but a way to retype the wrong line.
 *
 * The four cases are pdf.js's own viewport transform worked through by hand, so
 * the boxes agree with the pixels pdf.js drew rather than approximately with
 * them. Kept pure and in one place: nine call sites used to do this arithmetic
 * inline, and nine copies of it is nine chances to get one of them wrong.
 */

/** Clockwise, in degrees, and only ever one of these four. */
export type Rotation = 0 | 90 | 180 | 270

/** Any multiple of 90, from anywhere, made into one of the four. */
export function asRotation(degrees: number): Rotation {
  const wrapped = (((Math.round(degrees / 90) * 90) % 360) + 360) % 360
  return wrapped as Rotation
}

/** A page as it is drawn: its own size, how big on screen, and which way up. */
export interface PageGeometry {
  /** The page's own size, in PDF units, before any rotation. */
  width: number
  height: number
  /** CSS pixels per PDF unit. */
  scale: number
  rotation: Rotation
}

export interface Point {
  x: number
  y: number
}

/** How big the page is once drawn, in CSS pixels. */
export function drawnSize(page: PageGeometry): { width: number; height: number } {
  const turned = page.rotation === 90 || page.rotation === 270
  return {
    width: (turned ? page.height : page.width) * page.scale,
    height: (turned ? page.width : page.height) * page.scale
  }
}

/**
 * The scale a drawn page is at, from the width it ended up on screen.
 *
 * Measuring against the page's own width is right only when the page is
 * upright; turned on its side, the width on screen is the page's height, and
 * taking the ratio against the wrong one is how the whole layer ends up at the
 * wrong size before a single box is placed.
 */
export function scaleFromDrawnWidth(
  drawnWidth: number,
  page: { width: number; height: number },
  rotation: Rotation
): number {
  const across = rotation === 90 || rotation === 270 ? page.height : page.width
  return across > 0 ? drawnWidth / across : 1
}

/** A point on the page, in CSS pixels from the drawn page's top left. */
export function toCss(page: PageGeometry, point: Point): Point {
  const { width: w, height: h, scale: s, rotation } = page
  switch (rotation) {
    case 90:
      return { x: point.y * s, y: point.x * s }
    case 180:
      return { x: (w - point.x) * s, y: point.y * s }
    case 270:
      return { x: (h - point.y) * s, y: (w - point.x) * s }
    default:
      return { x: point.x * s, y: (h - point.y) * s }
  }
}

/** And back again: a point on screen, in the page's own coordinates. */
export function toPdf(page: PageGeometry, point: Point): Point {
  const { width: w, height: h, scale: s, rotation } = page
  switch (rotation) {
    case 90:
      return { x: point.y / s, y: point.x / s }
    case 180:
      return { x: w - point.x / s, y: point.y / s }
    case 270:
      return { x: w - point.y / s, y: h - point.x / s }
    default:
      return { x: point.x / s, y: h - point.y / s }
  }
}

/**
 * A drag, in the page's own directions.
 *
 * A movement is not a position: it carries no origin, so it turns with the page
 * but is never shifted by it. Dragging right on a page turned on its side has
 * to move the object down the page, or it runs away from the pointer.
 */
export function dragToPdf(page: Pick<PageGeometry, 'scale' | 'rotation'>, delta: Point): Point {
  const s = page.scale
  switch (page.rotation) {
    case 90:
      return { x: delta.y / s, y: delta.x / s }
    case 180:
      return { x: -delta.x / s, y: delta.y / s }
    case 270:
      return { x: -delta.y / s, y: -delta.x / s }
    default:
      return { x: delta.x / s, y: -delta.y / s }
  }
}

/** A rectangle in PDF units, as a box to draw on screen. */
export function toCssBox(
  page: PageGeometry,
  bounds: { left: number; right: number; top: number; bottom: number }
): { left: number; top: number; width: number; height: number } {
  const a = toCss(page, { x: bounds.left, y: bounds.top })
  const b = toCss(page, { x: bounds.right, y: bounds.bottom })
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    // Never nothing: a hairline rule is a real object somebody may want to
    // select, and a box no pixels high cannot be clicked.
    width: Math.max(2, Math.abs(a.x - b.x)),
    height: Math.max(2, Math.abs(a.y - b.y))
  }
}
