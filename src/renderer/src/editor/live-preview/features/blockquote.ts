import { Decoration } from '@codemirror/view'
import type { Feature } from '../context'

const quoteLine = Decoration.line({ class: 'cm-zy-blockquote' })

/** `> quote` — accent bar via line class, `>` marks concealed on inactive lines. */
export const blockquote: Feature = {
  nodes: ['Blockquote'],
  enter(node, ctx) {
    const doc = ctx.state.doc
    const first = doc.lineAt(node.from)
    const last = doc.lineAt(node.to)
    for (let n = first.number; n <= last.number; n++) {
      ctx.add(quoteLine.range(doc.line(n).from))
    }
    for (const mark of node.node.getChildren('QuoteMark')) {
      if (ctx.lineRevealed(mark.from, mark.to)) continue
      const end = doc.sliceString(mark.to, mark.to + 1) === ' ' ? mark.to + 1 : mark.to
      ctx.conceal(mark.from, end)
    }
  }
}
