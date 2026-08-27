import { Decoration } from '@codemirror/view'
import type { Feature } from '../context'

const markDeco = Decoration.mark({ class: 'cm-or-mark' })

/** ==text== renders as a marker-pen highlight; == conceals until revealed. */
export const highlight: Feature = {
  nodes: ['Highlight'],
  enter(node, ctx) {
    ctx.add(markDeco.range(node.from, node.to))
    if (ctx.revealed(node.from, node.to)) return
    for (const mark of node.node.getChildren('HighlightMark')) {
      ctx.conceal(mark.from, mark.to)
    }
  }
}
