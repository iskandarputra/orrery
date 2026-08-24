import { syntaxTree } from '@codemirror/language'
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'

let seq = 0

/** Lazy-loaded so the ~2MB mermaid bundle never blocks startup. */
async function renderMermaid(code: string, el: HTMLElement): Promise<void> {
  const { default: mermaid } = await import('mermaid')
  const dark = document.documentElement.dataset['theme']?.includes('light') !== true
  mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default' })
  try {
    const { svg } = await mermaid.render(`zy-mermaid-${++seq}`, code)
    el.innerHTML = svg
  } catch (err) {
    el.textContent = `Mermaid error: ${err instanceof Error ? err.message.split('\n')[0] : err}`
    el.classList.add('cm-zy-mermaid--error')
  }
}

class MermaidWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly from: number,
    readonly interactive: boolean
  ) {
    super()
  }

  override eq(other: MermaidWidget): boolean {
    return other.code === this.code && other.interactive === this.interactive
  }

  override toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('div')
    el.className = 'cm-zy-mermaid'
    el.textContent = 'Rendering diagram…'
    void renderMermaid(this.code, el)
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

function build(state: EditorState, reveal: boolean): DecorationSet {
  const decos: Range<Decoration>[] = []
  const touches = (a: number, b: number): boolean =>
    reveal && state.selection.ranges.some((r) => r.from <= b && r.to >= a)

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'FencedCode') return
      const info = node.node.getChild('CodeInfo')
      if (!info || state.doc.sliceString(info.from, info.to).trim() !== 'mermaid') return false
      const from = node.from
      const to = Math.min(node.to, state.doc.lineAt(node.to).to)
      const wholeLines = state.doc.lineAt(from).from === from && state.doc.lineAt(to).to === to
      if (touches(from, to) || !wholeLines) return false
      const body = node.node.getChild('CodeText')
      const code = body ? state.doc.sliceString(body.from, body.to) : ''
      if (code.trim()) {
        decos.push(
          Decoration.replace({ widget: new MermaidWidget(code, from, reveal), block: true }).range(
            from,
            to
          )
        )
      }
      return false
    }
  })
  return Decoration.set(decos, true)
}

/** ```mermaid fences render as diagrams; click or arrow in to edit source. */
export function mermaidRendering(reveal = true): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => build(state, reveal),
    update(value, tr) {
      // Rebuild as parsing completes so the fenced-code node is picked up on a
      // freshly opened document (otherwise the diagram renders only after a
      // tab switch forces a rebuild).
      if (
        tr.docChanged ||
        (reveal && tr.selection) ||
        syntaxTree(tr.startState) !== syntaxTree(tr.state)
      )
        return build(tr.state, reveal)
      return value.map(tr.changes)
    },
    provide: (f) => EditorView.decorations.from(f)
  })
}
