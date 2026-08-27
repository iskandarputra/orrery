import { Decoration } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import type { BuildContext, Feature } from '../context'

const quoteLine = Decoration.line({ class: 'cm-or-blockquote' })
/** Only the ends of a quote are rounded, so the whole reads as one container. */
const quoteFirst = Decoration.line({ class: 'cm-or-blockquote cm-or-blockquote--first' })
const quoteLast = Decoration.line({ class: 'cm-or-blockquote cm-or-blockquote--last' })
const calloutTitle = Decoration.mark({ class: 'cm-or-callout-title' })

const calloutLineDecos = new Map<string, Decoration>()
function getCalloutLineDeco(type: string): Decoration {
  let deco = calloutLineDecos.get(type)
  if (!deco) {
    deco = Decoration.line({ class: `cm-or-blockquote cm-or-callout cm-or-callout--${type}` })
    calloutLineDecos.set(type, deco)
  }
  return deco
}

function resolveCalloutType(rawType: string): string {
  const t = rawType.toLowerCase()
  if (t === 'tip' || t === 'hint' || t === 'success' || t === 'check' || t === 'done') return 'tip'
  if (t === 'warning' || t === 'warn' || t === 'attention') return 'warning'
  if (
    t === 'caution' ||
    t === 'danger' ||
    t === 'error' ||
    t === 'fail' ||
    t === 'failure' ||
    t === 'bug'
  )
    return 'caution'
  if (t === 'important' || t === 'abstract' || t === 'summary' || t === 'quote' || t === 'cite')
    return 'important'
  return 'note'
}

/** `> [!NOTE] Title` — the callout marker and its optional title on the first line. */
export const CALLOUT_RE = /^(\s*>[ \t]?[ \t]*)(\[!([a-zA-Z_-]+)\])[ \t]*/

/**
 * Every `>` of this blockquote, including the ones lezer parks inside the
 * quoted Paragraph on lazily-continued lines. Nested blockquotes decorate
 * their own marks, so their subtrees are skipped to avoid duplicate ranges.
 */
function ownQuoteMarks(root: SyntaxNode): SyntaxNode[] {
  const marks: SyntaxNode[] = []
  root.cursor().iterate((node) => {
    if (node.name === 'Blockquote' && node.from !== root.from) return false
    if (node.name === 'QuoteMark') marks.push(node.node)
    return true
  })
  return marks
}

/** `> quote` — accent bar via line class, `>` marks concealed on inactive lines, themed callouts. */
export const blockquote: Feature = {
  nodes: ['Blockquote'],
  enter(node, ctx: BuildContext) {
    const doc = ctx.state.doc
    const first = doc.lineAt(node.from)
    const last = doc.lineAt(node.to)

    // GitHub / Obsidian callout: `> [!NOTE] optional title` on the opening line.
    const callout = first.text.match(CALLOUT_RE)
    const calloutType = callout ? resolveCalloutType(callout[3]!) : null

    const lineDeco = calloutType ? getCalloutLineDeco(calloutType) : quoteLine

    for (let n = first.number; n <= last.number; n++) {
      ctx.add(lineDeco.range(doc.line(n).from))
      // A quote is one block, not a stack of them: only its outermost lines
      // round off, and nothing between them carries a vertical gap.
      if (n === first.number) ctx.add(quoteFirst.range(doc.line(n).from))
      if (n === last.number) ctx.add(quoteLast.range(doc.line(n).from))
    }

    if (callout && !ctx.lineRevealed(first.from, first.to)) {
      // The marker is decoration, not content: hide it and let the accent bar
      // and title carry the meaning. Its `[...]` would otherwise parse as a link.
      const markerFrom = first.from + callout[1]!.length
      ctx.conceal(markerFrom, first.from + callout[0]!.length)
      const titleFrom = first.from + callout[0]!.length
      if (titleFrom < first.to) ctx.add(calloutTitle.range(titleFrom, first.to))
    }

    for (const mark of ownQuoteMarks(node.node)) {
      if (ctx.lineRevealed(mark.from, mark.to)) continue
      const end = doc.sliceString(mark.to, mark.to + 1) === ' ' ? mark.to + 1 : mark.to
      ctx.conceal(mark.from, end)
    }
  }
}
