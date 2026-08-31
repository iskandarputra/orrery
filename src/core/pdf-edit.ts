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
 *
 * An empty alphabet means there is no evidence — the document's text has not
 * been read yet, or it is a scan with no text in it — and produces no warning
 * at all. Saying "this document has never drawn an 'a'" because the extraction
 * has not finished would be true, useless and alarming.
 */
export function missingGlyphs(alphabet: string, text: string): string[] {
  if (alphabet === '') return []
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
export function objectAt<T extends { bounds: PageObject['bounds'] }>(
  objects: readonly T[],
  x: number,
  y: number
): T | null {
  let best: T | null = null
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
export function objectsWithin<T extends { bounds: PageObject['bounds'] }>(
  objects: readonly T[],
  rect: { left: number; bottom: number; right: number; top: number }
): T[] {
  return objects.filter(
    (object) =>
      object.bounds.left < rect.right &&
      object.bounds.right > rect.left &&
      object.bounds.bottom < rect.top &&
      object.bounds.top > rect.bottom
  )
}

/**
 * A thing you can edit: a line of text, or one picture.
 *
 * Real PDFs rarely store a line as one object. A great many position every
 * character separately, for kerning — a page of a letter of offer turned out to
 * hold 4,662 text objects, each one glyph, which as an editing surface means
 * four thousand boxes and the ability to retype a single letter.
 *
 * So the characters are put back into lines before anybody is shown them. This
 * is the same reconstruction `linesFrom` does for extraction, on the objects
 * rather than on their text, because editing needs to know *which* objects a
 * line is made of.
 */
export interface EditTarget {
  /** The objects this is made of, in reading order. One, for a picture. */
  indexes: number[]
  kind: string
  bounds: { left: number; bottom: number; right: number; top: number }
  /** What the line says; empty for anything that is not text. */
  text: string
}

/** Baselines this close are the same line — a superscript is not a new one. */
const SAME_LINE = 2

/**
 * How far apart two characters can sit and still be one line.
 *
 * Measured against the glyph height rather than as a fixed distance, because a
 * heading's spaces are wider than a footnote's. Beyond it the gap is a column
 * boundary or a table cell, and joining across one would produce a line that
 * exists nowhere on the page.
 */
const GAP_RATIO = 0.9

export function groupTargets(objects: readonly PageObject[]): EditTarget[] {
  const targets: EditTarget[] = []
  const lines: { bottom: number; items: PageObject[] }[] = []

  for (const object of objects) {
    if (object.kind !== 'text') {
      targets.push({
        indexes: [object.index],
        kind: object.kind,
        bounds: { ...object.bounds },
        text: ''
      })
      continue
    }
    const line = lines.find(
      (candidate) => Math.abs(candidate.bottom - object.bounds.bottom) <= SAME_LINE
    )
    if (line) line.items.push(object)
    else lines.push({ bottom: object.bounds.bottom, items: [object] })
  }

  for (const line of lines) {
    const ordered = [...line.items].sort((a, b) => a.bounds.left - b.bounds.left)
    let run: EditTarget | null = null
    let previousRight = -Infinity
    let height = 0

    for (const object of ordered) {
      const tall = object.bounds.top - object.bounds.bottom
      const gap = object.bounds.left - previousRight
      const joins = run !== null && gap <= Math.max(2, Math.max(height, tall) * GAP_RATIO)

      if (joins && run) {
        run.indexes.push(object.index)
        // The engine reports a trailing space on a glyph when the gap to the
        // next one is wide enough, and the space itself is usually an object as
        // well — so joining them naively doubles every space in the line, and
        // retyping it would write those doubles into the document.
        const spaced = run.text.endsWith(' ') && object.text.startsWith(' ')
        run.text += spaced ? object.text.slice(1) : object.text
        run.bounds.right = Math.max(run.bounds.right, object.bounds.right)
        run.bounds.top = Math.max(run.bounds.top, object.bounds.top)
        run.bounds.bottom = Math.min(run.bounds.bottom, object.bounds.bottom)
      } else {
        if (run) targets.push(run)
        run = {
          indexes: [object.index],
          kind: 'text',
          bounds: { ...object.bounds },
          text: object.text
        }
      }
      previousRight = object.bounds.right
      height = Math.max(height, tall)
    }
    if (run) targets.push(run)
  }

  // Down the page, then across it: the order somebody reading would meet them.
  return targets.sort((a, b) => b.bounds.top - a.bounds.top || a.bounds.left - b.bounds.left)
}
