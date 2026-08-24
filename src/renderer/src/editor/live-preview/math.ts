import katex from 'katex'
import 'katex/dist/katex.min.css'
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'

class MathWidget extends WidgetType {
  constructor(
    readonly expr: string,
    readonly display: boolean,
    readonly from: number,
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
    el.className = this.display ? 'cm-zy-math cm-zy-math--block' : 'cm-zy-math'
    try {
      katex.render(this.expr, el, { displayMode: this.display, throwOnError: false })
    } catch {
      el.textContent = this.expr
    }
    if (this.interactive) {
      el.addEventListener('mousedown', (event) => {
        event.preventDefault()
        view.dispatch({ selection: { anchor: this.from }, scrollIntoView: true })
        view.focus()
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

function build(state: EditorState, reveal: boolean): DecorationSet {
  const text = state.doc.toString()
  const decos: Range<Decoration>[] = []
  const fences = fencedRanges(state)
  const inFence = (a: number, b: number): boolean => fences.some(([f, t]) => a < t && b > f)
  const touches = (a: number, b: number): boolean =>
    reveal && state.selection.ranges.some((r) => r.from <= b && r.to >= a)
  const covered: [number, number][] = []

  let m: RegExpExecArray | null
  BLOCK.lastIndex = 0
  while ((m = BLOCK.exec(text)) !== null) {
    const from = m.index
    const to = m.index + m[0].length
    covered.push([from, to])
    if (touches(from, to) || inFence(from, to) || !m[1]!.trim()) continue
    const wholeLines = state.doc.lineAt(from).from === from && state.doc.lineAt(to).to === to
    decos.push(
      Decoration.replace({
        widget: new MathWidget(m[1]!.trim(), true, from, reveal),
        ...(wholeLines && m[0].includes('\n') ? { block: true } : {})
      }).range(from, to)
    )
  }
  INLINE.lastIndex = 0
  while ((m = INLINE.exec(text)) !== null) {
    const from = m.index
    const to = m.index + m[0].length
    if (covered.some(([a, b]) => from < b && to > a)) continue
    if (touches(from, to) || inFence(from, to)) continue
    const expr = m[1]!
    if (/^\s|\s$/.test(expr) || /^\d+$/.test(expr)) continue // avoid $5 and $10 prices
    decos.push(
      Decoration.replace({ widget: new MathWidget(expr, false, from, reveal) }).range(from, to)
    )
  }
  return Decoration.set(decos, true)
}

/** $inline$ and $$block$$ KaTeX rendering; source reappears at the cursor. */
export function mathRendering(reveal = true): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => build(state, reveal),
    update(value, tr) {
      if (tr.docChanged || (reveal && tr.selection)) return build(tr.state, reveal)
      return value.map(tr.changes)
    },
    provide: (f) => EditorView.decorations.from(f)
  })
}
