import { Decoration } from '@codemirror/view'
import type { Feature } from '../context'

const LEVEL_BY_NODE: Record<string, number> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
  SetextHeading1: 1,
  SetextHeading2: 2
}

const lineDecos = new Map<number, Decoration>()
function headingLine(level: number): Decoration {
  let deco = lineDecos.get(level)
  if (!deco) {
    deco = Decoration.line({ class: `cm-or-heading cm-or-h${level}` })
    lineDecos.set(level, deco)
  }
  return deco
}

const headingMarkDeco = Decoration.mark({ class: 'cm-or-heading-mark' })

/** `# Heading` — size the line, conceal the `#` marks unless the line is active. */
export const headings: Feature = {
  nodes: Object.keys(LEVEL_BY_NODE),
  enter(node, ctx) {
    const level = LEVEL_BY_NODE[node.name]
    if (!level) return
    const line = ctx.state.doc.lineAt(node.from)
    ctx.add(headingLine(level).range(line.from))

    const mark = node.node.getChild('HeaderMark')
    if (mark) {
      if (ctx.lineRevealed(node.from, node.to)) {
        ctx.add(headingMarkDeco.range(mark.from, mark.to))
      } else {
        // Conceal the marks plus the following space.
        const end = ctx.state.doc.sliceString(mark.to, mark.to + 1) === ' ' ? mark.to + 1 : mark.to
        ctx.conceal(mark.from, end)
      }
    }
  }
}
