import { Decoration } from '@codemirror/view'
import type { Feature } from '../context'

const codeLine = Decoration.line({ class: 'cm-zy-code-line' })
const codeFirst = Decoration.line({ class: 'cm-zy-code-line cm-zy-code-first' })
const codeLast = Decoration.line({ class: 'cm-zy-code-line cm-zy-code-last' })

/**
 * Fenced code blocks get a card background. Fence lines stay visible —
 * concealing them makes block editing disorienting; syntax colors come from
 * nested language parsers via @codemirror/language-data.
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
  }
}
