import { Decoration } from '@codemirror/view'
import type { Feature } from '../context'
import { BulletWidget, CheckboxWidget } from '../widgets'

const bullet = Decoration.replace({ widget: new BulletWidget() })

export interface ListsOptions {
  /** Replace -,*,+ markers with round bullets. */
  fancyBullets: boolean
  /** Render [ ]/[x] as clickable checkboxes. */
  interactiveCheckboxes: boolean
}

/**
 * Bullet markers render as `•`; task markers `[ ]`/`[x]` render as live
 * checkboxes. Ordered-list numbers stay as typed. Both behaviors are
 * user-toggleable (Settings → Markdown).
 */
export function lists(options: ListsOptions): Feature {
  return {
    nodes: ['ListMark', 'TaskMarker'],
    enter(node, ctx) {
      if (ctx.lineRevealed(node.from, node.to)) return

      if (node.name === 'TaskMarker') {
        if (!options.interactiveCheckboxes) return
        const text = ctx.state.doc.sliceString(node.from, node.to)
        ctx.add(
          Decoration.replace({ widget: new CheckboxWidget(/x/i.test(text)) }).range(
            node.from,
            node.to
          )
        )
        return
      }

      if (!options.fancyBullets) return
      const text = ctx.state.doc.sliceString(node.from, node.to)
      if (!/^[-*+]$/.test(text)) return // ordered list marker — keep the number

      // A task item's list mark is dropped entirely (the checkbox is enough).
      const parent = node.node.parent
      if (parent?.name === 'ListItem' && parent.getChild('Task')) {
        if (options.interactiveCheckboxes) ctx.conceal(node.from, node.to)
        return
      }
      ctx.add(bullet.range(node.from, node.to))
    }
  }
}
