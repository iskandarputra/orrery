import { Decoration } from '@codemirror/view'
import type { Feature } from '../context'
import { HrWidget } from '../widgets'

/** `---` renders as a rule; the source reappears when the line is active. */
export const hr: Feature = {
  nodes: ['HorizontalRule'],
  enter(node, ctx) {
    if (ctx.lineRevealed(node.from, node.to)) return
    ctx.add(Decoration.replace({ widget: new HrWidget() }).range(node.from, node.to))
  }
}
