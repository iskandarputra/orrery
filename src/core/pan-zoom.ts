/**
 * The pan-and-zoom arithmetic shared by every surface that frames content
 * larger than its viewport: the canvas board, and the media viewer that opens a
 * diagram, image or equation full screen.
 *
 * Kept free of DOM so it can be tested directly — the callers supply measured
 * rectangles and own the transform they paint with it.
 */

export interface Viewport {
  /** Translation in viewport pixels, applied before `zoom`. */
  x: number
  y: number
  zoom: number
}

export interface ZoomLimits {
  min: number
  max: number
}

/** Extent of the content, in content coordinates. */
export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Just the part of a DOMRect the maths needs. */
export interface Size {
  width: number
  height: number
}

export const IDENTITY: Viewport = { x: 0, y: 0, zoom: 1 }

export function clampZoom(zoom: number, { min, max }: ZoomLimits): number {
  return Math.min(max, Math.max(min, zoom))
}

/**
 * Scale by `factor` while keeping the content point currently under
 * (`cx`, `cy`) — viewport coordinates, relative to the viewport's top left —
 * exactly where it is. This is what makes wheel zoom feel anchored to the
 * cursor rather than to the centre of the screen.
 */
export function zoomAround(
  v: Viewport,
  factor: number,
  cx: number,
  cy: number,
  limits: ZoomLimits
): Viewport {
  const zoom = clampZoom(v.zoom * factor, limits)
  // Clamping can leave the zoom unchanged at a limit; the pan must not drift.
  const scale = zoom / v.zoom
  return { zoom, x: cx - (cx - v.x) * scale, y: cy - (cy - v.y) * scale }
}

/** Scale about the centre of the viewport — what the +/− buttons do. */
export function zoomToCentre(
  v: Viewport,
  factor: number,
  rect: Size,
  limits: ZoomLimits
): Viewport {
  return zoomAround(v, factor, rect.width / 2, rect.height / 2, limits)
}

/**
 * Centre `box` in `rect` at the largest zoom that shows all of it, leaving
 * `pad` pixels of content-space margin on each axis.
 */
export function fitBounds(rect: Size, box: Bounds, limits: ZoomLimits, pad = 0): Viewport {
  const width = box.maxX - box.minX + pad * 2
  const height = box.maxY - box.minY + pad * 2
  if (width <= 0 || height <= 0 || rect.width <= 0 || rect.height <= 0) return IDENTITY
  const zoom = clampZoom(Math.min(rect.width / width, rect.height / height), limits)
  return {
    zoom,
    x: rect.width / 2 - ((box.minX + box.maxX) / 2) * zoom,
    y: rect.height / 2 - ((box.minY + box.maxY) / 2) * zoom
  }
}

/** Put `box` at 1:1 in the middle of `rect` — the "actual size" control. */
export function actualSize(rect: Size, box: Bounds): Viewport {
  return {
    zoom: 1,
    x: rect.width / 2 - (box.minX + box.maxX) / 2,
    y: rect.height / 2 - (box.minY + box.maxY) / 2
  }
}

export function panBy(v: Viewport, dx: number, dy: number): Viewport {
  return { ...v, x: v.x + dx, y: v.y + dy }
}

/** The CSS transform for a viewport. Origin must be the content's top left. */
export function transformOf(v: Viewport): string {
  return `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`
}
