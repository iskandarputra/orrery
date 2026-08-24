import { Decoration } from '@codemirror/view'
import type { Feature } from '../context'

const quoteLine = Decoration.line({ class: 'cm-zy-blockquote' })

const calloutLineDecos = new Map<string, Decoration>()
function getCalloutLineDeco(type: string): Decoration {
  let deco = calloutLineDecos.get(type)
  if (!deco) {
    deco = Decoration.line({ class: `cm-zy-blockquote cm-zy-callout cm-zy-callout--${type}` })
    calloutLineDecos.set(type, deco)
  }
  return deco
}

function resolveCalloutType(rawType: string): string {
  const t = rawType.toLowerCase()
  if (t === 'tip' || t === 'hint' || t === 'success' || t === 'check' || t === 'done') return 'tip'
  if (t === 'warning' || t === 'warn' || t === 'attention') return 'warning'
  if (
    t === 'caution' ||
    t === 'danger' ||
    t === 'error' ||
    t === 'fail' ||
    t === 'failure' ||
    t === 'bug'
  )
    return 'caution'
  if (t === 'important' || t === 'abstract' || t === 'summary' || t === 'quote' || t === 'cite')
    return 'important'
  return 'note'
}

/** `> quote` — accent bar via line class, `>` marks concealed on inactive lines, themed callouts. */
export const blockquote: Feature = {
  nodes: ['Blockquote'],
  enter(node, ctx) {
    const doc = ctx.state.doc
    const first = doc.lineAt(node.from)
    const last = doc.lineAt(node.to)

    // Check if the blockquote is a GitHub / Obsidian callout: `> [!NOTE]`
    const firstLineText = first.text.replace(/^>\s*/, '')
    const calloutMatch = firstLineText.match(/^\[!([a-zA-Z_-]+)\]/i)
    const calloutType = calloutMatch ? resolveCalloutType(calloutMatch[1]!) : null

    const lineDeco = calloutType ? getCalloutLineDeco(calloutType) : quoteLine

    for (let n = first.number; n <= last.number; n++) {
      ctx.add(lineDeco.range(doc.line(n).from))
    }

    for (const mark of node.node.getChildren('QuoteMark')) {
      if (ctx.lineRevealed(mark.from, mark.to)) continue
      const end = doc.sliceString(mark.to, mark.to + 1) === ' ' ? mark.to + 1 : mark.to
      ctx.conceal(mark.from, end)
    }
  }
}
