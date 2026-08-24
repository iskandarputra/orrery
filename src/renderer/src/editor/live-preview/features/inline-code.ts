import { Decoration } from '@codemirror/view'
import type { Feature } from '../context'

const codeMark = Decoration.mark({ class: 'cm-zy-inline-code' })

/** `` `code` `` — pill background over the span, backticks concealed when inactive. */
export const inlineCode: Feature = {
  nodes: ['InlineCode'],
  enter(node, ctx) {
    ctx.add(codeMark.range(node.from, node.to))
    if (ctx.revealed(node.from, node.to)) return
    for (const mark of node.node.getChildren('CodeMark')) {
      ctx.conceal(mark.from, mark.to)
    }
  }
}
