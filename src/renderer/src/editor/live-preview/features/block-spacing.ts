import { Decoration } from '@codemirror/view'
import type { Feature } from '../context'

/** `  - `, `1. `, `10) ` — the marker plus its indent and trailing space. */
const LIST_PREFIX_RE = /^(\s*(?:[-*+]|\d+[.)])[ \t]+)/
/** Leading `>` quote markers, which sit before a list marker inside a quote. */
const QUOTE_PREFIX_RE = /^(\s*>)+[ \t]?/

/** The line as the list sees it, with any quote markers stripped. */
function withoutQuote(text: string): string {
  return text.replace(QUOTE_PREFIX_RE, '')
}

/**
 * Width of the item prefix in `ch`. The editor font is proportional, so a space
 * is roughly half a `0` while marker glyphs are about one — counting every
 * character as 1ch would push the hanging indent further right at every level.
 */
const SPACE_CH = 0.5
function prefixWidthCh(prefix: string): number {
  let width = 0
  for (const char of prefix) width += char === ' ' || char === '\t' ? SPACE_CH : 1
  return Math.round(width * 100) / 100
}

const lineDecos = new Map<string, Decoration>()

/**
 * List item lines are decorated per (first-item, text column): the class sets
 * the rhythm, the inline style hangs wrapped text under the item's text instead
 * of letting it fall back to the left margin and flatten the outline.
 */
function getLineDeco(firstItem: boolean, indent: number): Decoration {
  const key = `${firstItem ? 'f' : 'i'}:${indent}`
  let deco = lineDecos.get(key)
  if (!deco) {
    deco = Decoration.line({
      class: firstItem ? 'cm-zy-li cm-zy-li--first' : 'cm-zy-li',
      // Published as a variable, not as padding: inside a blockquote the
      // padding has to compose with the quote's own indent, and an inline
      // `padding-left` would silently replace it.
      attributes: { style: `--zy-li-indent: ${indent}ch` }
    })
    lineDecos.set(key, deco)
  }
  return deco
}

/**
 * Comfortable list rhythm: a small gap above each list item so bullets, numbers
 * and task items breathe instead of stacking tightly. Applied to the item's
 * first line only (a ViewPlugin-safe line decoration). The first item of a
 * list gets a smaller gap so the list doesn't float away from its intro line.
 * The same decoration carries the hanging indent for wrapped item text.
 */
export const blockSpacing: Feature = {
  nodes: ['ListItem'],
  enter(node, ctx) {
    const line = ctx.state.doc.lineAt(node.from)
    // A loose list separates items with blank lines, so "is the line above a
    // list item?" would call every item the first one. Look past one blank.
    const previousItemLine = (from: number): string | null => {
      for (let n = from; n >= Math.max(1, from - 1); n--) {
        const text = ctx.state.doc.line(n).text
        // A `>`-only line is a blank line inside a quote, not content.
        if (withoutQuote(text).trim() !== '') return text
      }
      return null
    }
    const prev = line.number > 1 ? previousItemLine(line.number - 1) : null
    const firstItem = !prev || !LIST_PREFIX_RE.test(withoutQuote(prev))
    const indent = prefixWidthCh(withoutQuote(line.text).match(LIST_PREFIX_RE)?.[1] ?? '')
    ctx.add(getLineDeco(firstItem, indent).range(line.from))
  }
}
