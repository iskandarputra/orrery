import { Decoration } from '@codemirror/view'
import type { SyntaxNodeRef } from '@lezer/common'
import type { Feature } from '../context'

const lineDecos = new Map<string, Decoration>()

/**
 * How deeply a list item is nested, counted from the syntax tree rather than
 * from the spaces in front of it.
 *
 * Markdown lets the same structure be written with two spaces or four; reading
 * the indent off the text made those render at different depths, which is a
 * difference the document does not have.
 */
function nestingDepth(node: SyntaxNodeRef): number {
  let depth = -1
  for (let parent = node.node.parent; parent; parent = parent.parent) {
    if (parent.name === 'BulletList' || parent.name === 'OrderedList') depth++
  }
  return Math.max(0, depth)
}

/**
 * List rhythm and layout: a small gap above each item, and the depth the
 * stylesheet turns into an indent. The item's marker sits in a fixed column so
 * `1.`, `10.` and `•` all leave their text starting at the same place.
 */
function getLineDeco(firstItem: boolean, depth: number): Decoration {
  const key = `${firstItem ? 'f' : 'i'}:${depth}`
  let deco = lineDecos.get(key)
  if (!deco) {
    deco = Decoration.line({
      class: firstItem ? 'cm-or-li cm-or-li--first' : 'cm-or-li',
      attributes: { style: `--or-li-depth: ${depth}` }
    })
    lineDecos.set(key, deco)
  }
  return deco
}

/** `  - `, `1. ` — the marker with its indent, as written. */
const LIST_PREFIX_RE = /^(\s*)((?:[-*+]|\d+[.)])[ \t]+)/
/** Leading `>` quote markers, which sit before a list marker inside a quote. */
const QUOTE_PREFIX_RE = /^(\s*>)+[ \t]?/

const withoutQuote = (text: string): string => text.replace(QUOTE_PREFIX_RE, '')

export const blockSpacing: Feature = {
  nodes: ['ListItem'],
  enter(node, ctx) {
    const line = ctx.state.doc.lineAt(node.from)
    const quotePrefix = line.text.length - withoutQuote(line.text).length

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

    ctx.add(getLineDeco(firstItem, nestingDepth(node)).range(line.from))

    // The indent is now the depth's job, so the spaces that encoded it must
    // not add to it — but they stay visible on the line being edited.
    const match = LIST_PREFIX_RE.exec(withoutQuote(line.text))
    const spaces = match?.[1]?.length ?? 0
    if (spaces > 0 && !ctx.lineRevealed(line.from, line.to)) {
      const start = line.from + quotePrefix
      ctx.conceal(start, start + spaces)
    }
  }
}
