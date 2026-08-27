import { Decoration } from '@codemirror/view'
import type { Feature } from '../context'
import { BulletWidget, CheckboxWidget } from '../widgets'

const bullet = Decoration.replace({ widget: new BulletWidget() })
/** Holds the number in a fixed-width, right-aligned column. */
const orderedMark = Decoration.mark({ class: 'cm-or-ordered-mark' })

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
      if (node.name === 'ListMark') {
        const marker = ctx.state.doc.sliceString(node.from, node.to)
        if (!/^[-*+]$/.test(marker)) {
          // An ordered marker keeps its number but sits in a fixed column, so
          // `1.` and `10.` leave their text at the same place. Applied even on
          // the line being edited: alignment must not shift under the cursor.
          ctx.add(orderedMark.range(node.from, node.to))
          return
        }
      }

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

      // A task item's list mark is dropped entirely (the checkbox is enough),
      // together with the space behind it — left in, that space would push the
      // checkbox out of the marker column and give a mixed list two text edges.
      const parent = node.node.parent
      if (parent?.name === 'ListItem' && parent.getChild('Task')) {
        if (options.interactiveCheckboxes) {
          const after = ctx.state.doc.sliceString(node.to, node.to + 2)
          const spaces = /^ +/.exec(after)?.[0].length ?? 0
          ctx.conceal(node.from, node.to + spaces)
        }
        return
      }
      ctx.add(bullet.range(node.from, node.to))
    }
  }
}
