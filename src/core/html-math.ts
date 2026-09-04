/**
 * Where the maths is in a run of text.
 *
 * A page that writes TeX loads MathJax or KaTeX to turn it into equations, and
 * the reader runs neither — it runs nothing. So it has to find the maths
 * itself, which means knowing the delimiters those libraries look for.
 *
 * The three unambiguous ones are always honoured, because nothing else writes
 * them: `$$…$$` and `\[…\]` for a display equation, `\(…\)` for an inline one.
 * These are also MathJax's own defaults.
 *
 * A single `$` is not, unless the page says so. It is the delimiter people
 * reach for first and also the character in front of every price, and a page
 * about what things cost would be turned into a page of equations. MathJax does
 * not assume it either: `inlineMath: [['$','$']]` is something a page opts into,
 * and `declaresSingleDollar` below is that same opt-in, read back off the page.
 */

export interface MathSpan {
  /** Index of the first character of the delimiter. */
  start: number
  /** Index one past the last character of the closing delimiter. */
  end: number
  /** What is between the delimiters, untrimmed of its own spaces. */
  expr: string
  display: boolean
}

interface Delimiter {
  open: string
  close: string
  display: boolean
}

/** Longest first, so `$$` is never mistaken for an empty `$…$`. */
const ALWAYS: Delimiter[] = [
  { open: '$$', close: '$$', display: true },
  { open: '\\[', close: '\\]', display: true },
  { open: '\\(', close: '\\)', display: false }
]

const SINGLE_DOLLAR: Delimiter = { open: '$', close: '$', display: false }

/**
 * Whether the page has asked for `$…$` to be treated as maths.
 *
 * Read from the MathJax configuration the page carries, which is the only place
 * that intent is written down. Deliberately loose — it is answering "did
 * somebody turn this on", not parsing JavaScript.
 */
export function declaresSingleDollar(source: string): boolean {
  const config = /inlineMath\s*:\s*\[([\s\S]{0,200}?)\]\s*[,}]/.exec(source)
  if (!config) return false
  return /\[\s*(['"])\$\1/.test(config[1]!)
}

/**
 * Find the maths in one string, left to right and never overlapping.
 *
 * An unclosed delimiter is not maths: `$5 and change` has one `$` and no
 * partner, and treating the rest of the paragraph as an equation because of it
 * is worse than leaving it alone.
 */
export function findMath(text: string, allowSingleDollar = false): MathSpan[] {
  const delimiters = allowSingleDollar ? [...ALWAYS, SINGLE_DOLLAR] : ALWAYS
  const spans: MathSpan[] = []

  let i = 0
  while (i < text.length) {
    // A backslash-escaped delimiter is a literal one. `\$` is how a page writes
    // a dollar sign in a document that has maths in it.
    if (text[i] === '\\' && text[i + 1] === '$') {
      i += 2
      continue
    }

    const found = delimiters.find((d) => text.startsWith(d.open, i))
    if (!found) {
      i++
      continue
    }

    const from = i + found.open.length
    const close = text.indexOf(found.close, from)
    if (close === -1) {
      // No partner: not maths. Step past the opener rather than past the whole
      // string, so a later, properly closed pair is still found.
      i += found.open.length
      continue
    }

    const expr = text.slice(from, close)
    // `$$` immediately followed by `$$` is an empty equation, which is nothing
    // to draw and is more likely to be a row of dollar signs.
    if (expr.trim() === '') {
      i += found.open.length
      continue
    }

    spans.push({ start: i, end: close + found.close.length, expr, display: found.display })
    i = close + found.close.length
  }

  return spans
}
