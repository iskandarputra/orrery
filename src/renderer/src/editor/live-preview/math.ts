import { renderMath } from '../katex-lazy'
import type { EditorState, Extension } from '@codemirror/state'
import { Decoration, type EditorView, WidgetType } from '@codemirror/view'
import { expandButton } from './expand-button'
import { revealSource } from './reveal-source'
import { revealField, type Revealable } from './reveal-field'

class MathWidget extends WidgetType {
  constructor(
    readonly expr: string,
    readonly display: boolean,
    readonly interactive: boolean
  ) {
    super()
  }

  override eq(other: MathWidget): boolean {
    return (
      other.expr === this.expr &&
      other.display === this.display &&
      other.interactive === this.interactive
    )
  }

  override toDOM(view: EditorView): HTMLElement {
    const el = document.createElement(this.display ? 'div' : 'span')
    el.className = this.display ? 'cm-or-math cm-or-math--block' : 'cm-or-math'
    // The equation goes in a box of its own: KaTeX replaces the contents of
    // whatever it is given, and it arrives after this function has returned,
    // so rendering straight into `el` would take the expand button with it.
    const body = document.createElement(this.display ? 'div' : 'span')
    body.className = 'cm-or-math__body'
    el.appendChild(body)
    renderMath(body, this.expr, this.display)
    // Only the block form: an inline equation sits in a run of text, where a
    // corner button would have nowhere to go and nothing to reveal.
    if (this.display) el.appendChild(expandButton({ kind: 'math', code: this.expr }))
    if (this.interactive) {
      el.addEventListener('mousedown', (event) => {
        event.preventDefault()
        revealSource(view, el)
      })
    }
    return el
  }

  override ignoreEvent(event: Event): boolean {
    return !this.interactive || event.type !== 'mousedown'
  }
}

const INLINE = /\$([^$\n]+?)\$/g
const BLOCK = /\$\$([\s\S]+?)\$\$/g

function fencedRanges(state: EditorState): [number, number][] {
  // Cheap fence detection so $ inside code blocks is ignored.
  const ranges: [number, number][] = []
  let open = -1
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n)
    if (/^\s*(```|~~~)/.test(line.text)) {
      if (open === -1) open = line.from
      else {
        ranges.push([open, line.to])
        open = -1
      }
    }
  }
  if (open !== -1) ranges.push([open, state.doc.length])
  return ranges
}

/**
 * Every equation in the document.
 *
 * Each inline match is checked against the blocks and fences with a cursor that
 * only moves forward, since all three arrive in document order. It used to test
 * every inline match against every block and fence seen so far, which on a long
 * note with thousands of equations was most of the cost of a keystroke.
 */
function scan(state: EditorState, reveal: boolean): Revealable[] {
  const text = state.doc.toString()
  const fences = fencedRanges(state)
  let fence = 0
  const inFence = (a: number, b: number): boolean => {
    while (fence < fences.length && fences[fence]![1] <= a) fence++
    return fence < fences.length && fences[fence]![0] < b
  }

  const blocks: Revealable[] = []
  const covered: [number, number][] = []
  let m: RegExpExecArray | null
  BLOCK.lastIndex = 0
  while ((m = BLOCK.exec(text)) !== null) {
    const from = m.index
    const to = m.index + m[0].length
    covered.push([from, to])
    if (inFence(from, to) || !m[1]!.trim()) continue
    const wholeLines = state.doc.lineAt(from).from === from && state.doc.lineAt(to).to === to
    const deco = Decoration.replace({
      widget: new MathWidget(m[1]!.trim(), true, reveal),
      ...(wholeLines && m[0].includes('\n') ? { block: true } : {})
    }).range(from, to)
    blocks.push({ from, to, shown: [deco] })
  }

  const spans: Revealable[] = [...blocks]
  let near = 0
  fence = 0
  INLINE.lastIndex = 0
  while ((m = INLINE.exec(text)) !== null) {
    const from = m.index
    const to = m.index + m[0].length
    while (near < covered.length && covered[near]![1] <= from) near++
    if (near < covered.length && covered[near]![0] < to) continue
    if (inFence(from, to)) continue
    const expr = m[1]!
    if (/^\s|\s$/.test(expr) || /^\d+$/.test(expr)) continue // avoid $5 and $10 prices
    const deco = Decoration.replace({ widget: new MathWidget(expr, false, reveal) }).range(from, to)
    spans.push({ from, to, shown: [deco] })
  }
  return spans
}

/** $inline$ and $$block$$ KaTeX rendering; source reappears at the cursor. */
export function mathRendering(reveal = true): Extension {
  return revealField((state) => scan(state, reveal), reveal)
}
