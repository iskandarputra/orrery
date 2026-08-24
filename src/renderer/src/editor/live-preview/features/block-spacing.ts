import { Decoration } from '@codemirror/view'
import type { Feature } from '../context'

const itemLine = Decoration.line({ class: 'cm-zy-li' })
const firstItemLine = Decoration.line({ class: 'cm-zy-li cm-zy-li--first' })

/**
 * Comfortable list rhythm: a small gap above each list item so bullets, numbers
 * and task items breathe instead of stacking tightly. Applied to the item's
 * first line only (a ViewPlugin-safe line decoration). The first item of a
 * list gets a smaller gap so the list doesn't float away from its intro line.
 */
export const blockSpacing: Feature = {
  nodes: ['ListItem'],
  enter(node, ctx) {
    const line = ctx.state.doc.lineAt(node.from)
    const prev = line.number > 1 ? ctx.state.doc.line(line.number - 1) : null
    const firstItem = !prev || !/^\s*([-*+]|\d+[.)])\s/.test(prev.text)
    ctx.add((firstItem ? firstItemLine : itemLine).range(line.from))
  }
}
