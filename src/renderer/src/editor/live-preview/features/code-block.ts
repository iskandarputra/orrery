import { Decoration } from '@codemirror/view'
import type { Feature } from '../context'

const codeLine = Decoration.line({ class: 'cm-zy-code-line' })
const codeFirst = Decoration.line({ class: 'cm-zy-code-line cm-zy-code-first' })
const codeLast = Decoration.line({ class: 'cm-zy-code-line cm-zy-code-last' })
const codeMarkDeco = Decoration.mark({ class: 'cm-zy-code-mark' })
const codeInfoDeco = Decoration.mark({ class: 'cm-zy-code-info' })

/**
 * Fenced code blocks get a sleek card container with background and rounded corners.
 * Language info (CodeInfo) is rendered as a clean badge pill, and fence backticks (CodeMark)
 * are styled subtly so they don't overpower the code.
 */
export const codeBlock: Feature = {
  nodes: ['FencedCode'],
  enter(node, ctx) {
    const doc = ctx.state.doc
    const first = doc.lineAt(node.from)
    const last = doc.lineAt(node.to)

    for (let n = first.number; n <= last.number; n++) {
      const line = doc.line(n)
      const deco = n === first.number ? codeFirst : n === last.number ? codeLast : codeLine
      ctx.add(deco.range(line.from))
    }

    // Decorate backtick fence marks (```)
    for (const mark of node.node.getChildren('CodeMark')) {
      ctx.add(codeMarkDeco.range(mark.from, mark.to))
    }

    // Decorate language info tag (e.g. ts, py, json) as a badge pill
    for (const info of node.node.getChildren('CodeInfo')) {
      ctx.add(codeInfoDeco.range(info.from, info.to))
    }
  }
}
