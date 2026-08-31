/**
 * Editing what is drawn on a page, and knowing when not to.
 *
 * A PDF does not store text so much as instructions to draw particular glyphs
 * from a particular font at particular places. Retyping a line is therefore
 * exact — the same font, the same position — right up to the moment somebody
 * types a character the font cannot draw, and then it silently draws nothing.
 *
 * Most PDFs embed only the glyphs they use, so this is not a rare edge: a
 * document that never contained a `ž` almost certainly cannot draw one. There
 * is no way to be sure from outside the font program, so this makes the
 * conservative guess and says so, rather than letting somebody discover a hole
 * in their contract later.
 */

export interface PageObject {
  /** Its position in the page's object list, which is what the engine edits by. */
  index: number
  /** `text`, `path`, `image`, `shading` or `form`, as PDFium classifies them. */
  kind: string
  /** In PDF units, origin at the bottom-left of the page. */
  bounds: { left: number; bottom: number; right: number; top: number }
  /** What a text object says; empty for everything else. */
  text: string
}

/**
 * Characters in `text` that the document has never drawn before.
 *
 * The alphabet is everything the document already says. A character in it has a
 * glyph somewhere; one that is not may still be there — the subset could be
 * generous, or the font whole — but assuming so is how you end up with a line
 * that is missing three letters and no warning.
 *
 * Whitespace is never reported: a space is not drawn, and reporting it would
 * make the warning noise rather than information.
 */
export function missingGlyphs(alphabet: string, text: string): string[] {
  const known = new Set(alphabet)
  const missing = new Set<string>()
  for (const character of text) {
    if (/\s/.test(character)) continue
    if (!known.has(character)) missing.add(character)
  }
  return [...missing]
}

/**
 * The object under a point, in PDF coordinates.
 *
 * The smallest one that contains the point, because objects overlap constantly
 * — a line of text sits inside the box drawn behind it, and clicking the words
 * should get the words.
 */
export function objectAt(objects: readonly PageObject[], x: number, y: number): PageObject | null {
  let best: PageObject | null = null
  let bestArea = Infinity
  for (const object of objects) {
    const { left, bottom, right, top } = object.bounds
    if (x < left || x > right || y < bottom || y > top) continue
    const area = Math.max(0, right - left) * Math.max(0, top - bottom)
    if (area < bestArea) {
      best = object
      bestArea = area
    }
  }
  return best
}

/**
 * Objects that a rectangle covers, for redaction.
 *
 * Anything the rectangle touches, not only what it contains: a redaction that
 * left half a word behind because the box clipped it would be worse than
 * useless, since it would look like the words were gone.
 */
export function objectsWithin(
  objects: readonly PageObject[],
  rect: { left: number; bottom: number; right: number; top: number }
): PageObject[] {
  return objects.filter(
    (object) =>
      object.bounds.left < rect.right &&
      object.bounds.right > rect.left &&
      object.bounds.bottom < rect.top &&
      object.bounds.top > rect.bottom
  )
}
