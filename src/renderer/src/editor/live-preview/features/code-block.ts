import { Decoration } from '@codemirror/view'
import type { Feature } from '../context'

const codeLine = Decoration.line({ class: 'cm-zy-code-line' })
const codeFirst = Decoration.line({ class: 'cm-zy-code-line cm-zy-code-first' })
const codeLast = Decoration.line({ class: 'cm-zy-code-line cm-zy-code-last' })
const codeMarkDeco = Decoration.mark({ class: 'cm-zy-code-mark' })
const codeInfoDeco = Decoration.mark({ class: 'cm-zy-code-info' })
/** A fence line with its ``` concealed and no badge left — collapse it to a card edge. */
const fenceHidden = Decoration.line({ class: 'cm-zy-code-fence-hidden' })

/**
 * Code blocks get a sleek card container with background and rounded corners —
 * both fenced (``` / ~~~) and 4-space indented ones, which carry no fence marks.
 * Language info (CodeInfo) is rendered as a clean badge pill, and fence backticks
 * (CodeMark) are styled subtly so they don't overpower the code.
 */
export const codeBlock: Feature = {
  nodes: ['FencedCode', 'CodeBlock'],
  enter(node, ctx) {
    const doc = ctx.state.doc
    const first = doc.lineAt(node.from)
    const last = doc.lineAt(node.to)

    for (let n = first.number; n <= last.number; n++) {
      const line = doc.line(n)
      const deco = n === first.number ? codeFirst : n === last.number ? codeLast : codeLine
      ctx.add(deco.range(line.from))
    }

    // Language info tag (e.g. ts, py, json) renders as a badge pill and stays
    // on the opening fence line even once the backticks are gone.
    const infoLines = new Set<number>()
    for (const info of node.node.getChildren('CodeInfo')) {
      ctx.add(codeInfoDeco.range(info.from, info.to))
      infoLines.add(doc.lineAt(info.from).number)
    }

    // The fence is syntax, not content: it shows only while the cursor is on
    // its own line, and never in Reading mode.
    for (const mark of node.node.getChildren('CodeMark')) {
      if (ctx.lineRevealed(mark.from, mark.to)) {
        ctx.add(codeMarkDeco.range(mark.from, mark.to))
        continue
      }
      ctx.conceal(mark.from, mark.to)
      const markLine = doc.lineAt(mark.from)
      if (!infoLines.has(markLine.number)) ctx.add(fenceHidden.range(markLine.from))
    }
  }
}
