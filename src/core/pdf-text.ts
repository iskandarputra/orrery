/**
 * Turning what a PDF stores into something you can read, search and quote.
 *
 * A PDF does not contain lines of text. It contains instructions to draw runs
 * of glyphs at coordinates, in whatever order the producer found convenient —
 * a two-column paper often draws the whole left column, then the whole right
 * one, and a justified paragraph can arrive one word at a time with the spaces
 * missing entirely, because the space between words is a `Td` and not a
 * character.
 *
 * So reading order has to be reconstructed: group the runs that share a
 * baseline, order them across the page, and put a space where the drawing
 * jumped a gap. That is a guess, and it is the same guess every PDF reader
 * makes, but it is the difference between a searchable document and a bag of
 * fragments.
 *
 * Pure, so it can be tested without a PDF: the shape below is what pdf.js's
 * `getTextContent()` hands over, and nothing here knows where it came from.
 */

export interface TextItem {
  str: string
  /** pdf.js's transform, `[a, b, c, d, x, y]` — only x and y are used. */
  transform: number[]
  /** Width of the run in text-space units, for spotting the gaps. */
  width?: number
}

/**
 * How far two runs' baselines can differ and still be the same line.
 *
 * Not zero: a line with a superscript, a different font size or an inline
 * formula has runs whose baselines differ by a fraction of a point, and
 * demanding an exact match splits one sentence into several.
 */
const BASELINE_TOLERANCE = 2

/**
 * How wide a gap has to be before it reads as a space, in text-space units.
 *
 * Small, because the alternative is worse in both directions: too large and
 * "the cat" comes out "thecat"; too small and kerning between letters of one
 * word inserts spaces into the middle of it.
 */
const GAP = 1

export function linesFrom(items: readonly TextItem[], tolerance = BASELINE_TOLERANCE): string[] {
  const lines: { y: number; items: TextItem[] }[] = []

  for (const item of items) {
    if (item.str === '') continue
    const y = item.transform[5] ?? 0
    const line = lines.find((candidate) => Math.abs(candidate.y - y) <= tolerance)
    if (line) line.items.push(item)
    else lines.push({ y, items: [item] })
  }

  // Down the page: PDF coordinates start at the bottom-left corner, so a larger
  // y is higher up and comes first.
  lines.sort((a, b) => b.y - a.y)

  return lines
    .map((line) => {
      const ordered = [...line.items].sort((a, b) => (a.transform[4] ?? 0) - (b.transform[4] ?? 0))
      let text = ''
      let end = -Infinity
      for (const item of ordered) {
        const x = item.transform[4] ?? 0
        const spaced = text === '' || text.endsWith(' ') || item.str.startsWith(' ')
        if (!spaced && x - end > GAP) text += ' '
        text += item.str
        end = x + (item.width ?? 0)
      }
      return text.trimEnd()
    })
    .filter((line) => line.trim() !== '')
}

/** Everything on one page, as lines. */
export function pageText(items: readonly TextItem[]): string {
  return linesFrom(items).join('\n')
}

/**
 * A snippet around a match, for a search result.
 *
 * Whole words at both ends where it can manage it: a result that begins
 * mid-word reads as a typo rather than as context.
 */
export function snippet(line: string, at: number, length: number, width = 120): string {
  if (line.length <= width) return line.trim()

  const slack = Math.max(0, width - length)
  let from = Math.max(0, at - Math.floor(slack / 2))
  let to = Math.min(line.length, from + width)
  from = Math.max(0, to - width)

  const space = line.indexOf(' ', from)
  if (from > 0 && space !== -1 && space < at) from = space + 1
  const lastSpace = line.lastIndexOf(' ', to)
  if (to < line.length && lastSpace > at + length) to = lastSpace

  return `${from > 0 ? '…' : ''}${line.slice(from, to).trim()}${to < line.length ? '…' : ''}`
}

/**
 * The page a link asks for, from a wikilink anchor.
 *
 * `[[paper.pdf#page=12]]` is the form, because it is the one every PDF viewer
 * and every browser already uses in a URL fragment. Anything else — a heading
 * anchor meant for a note, a page number that is not one — resolves to nothing
 * rather than to page 1, so a typo does not quietly send you to the front of a
 * three-hundred-page document.
 */
export function pageFromAnchor(anchor: string | null): number | null {
  if (!anchor) return null
  const match = /^page\s*=\s*(\d+)$/i.exec(anchor.trim())
  if (!match) return null
  const page = Number(match[1])
  return Number.isInteger(page) && page > 0 ? page : null
}

/**
 * A selection from a PDF, as something to paste into a note.
 *
 * A blockquote and a link back to the page it came from — which is the whole
 * point of quoting from a paper in a knowledge base, and the thing that is
 * tedious enough by hand that people stop doing it. The link uses the same
 * `#page=` fragment the reader understands, so following it lands where the
 * words were.
 *
 * Line breaks inside a quote are the PDF's, not the author's — a paragraph is
 * broken wherever the column ended — so they are joined back into prose.
 *
 * The hyphen at a break is left exactly as it was. Telling "charac-\nter" from
 * "well-\nknown" needs a dictionary, and guessing wrong in the first direction
 * leaves a visible "charac-ter" that anyone can fix, while guessing wrong in
 * the second silently produces "wellknown" in somebody's quotation.
 */
export function quoteFromPdf(text: string, fileName: string, page: number): string {
  const joined = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .reduce((prose, line) => {
      if (prose === '') return line
      // A line ending in a hyphen is a word the column split: joined, but with
      // the hyphen kept, because removing it is a guess this cannot make.
      if (/[\p{Ll}]-$/u.test(prose)) return prose + line
      return `${prose} ${line}`
    }, '')

  const quoted = joined
    .split(/(?<=\.)\s+(?=[A-Z])/)
    .join(' ')
    .trim()
  return `> ${quoted}\n>\n> — [[${fileName}#page=${page}]]\n`
}
