import { syntaxTree } from '@codemirror/language'
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'

/** Renders in place of a soft line break so two source lines flow as one. */
class SoftSpaceWidget extends WidgetType {
  override eq(): boolean {
    return true
  }
  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-zy-softbreak'
    span.textContent = ' '
    return span
  }
  override ignoreEvent(): boolean {
    return false
  }
}

const softSpace = Decoration.replace({ widget: new SoftSpaceWidget() })

/** A markdown hard break keeps the line break: trailing two spaces or backslash. */
function isHardBreak(lineText: string): boolean {
  return /( {2,}|\\)$/.test(lineText)
}

function build(state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = []
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Paragraph') return
      const first = state.doc.lineAt(node.from)
      const last = state.doc.lineAt(node.to)
      // Join every internal newline of the paragraph (all lines but the last).
      for (let n = first.number; n < last.number; n++) {
        const line = state.doc.line(n)
        if (isHardBreak(line.text)) continue
        decos.push(softSpace.range(line.to, line.to + 1))
      }
      return false // paragraphs don't nest
    }
  })
  return Decoration.set(decos, true)
}

/**
 * Reflow soft-wrapped paragraphs (single newlines → spaces) so text fills the
 * canvas like a markdown preview. Concealed newlines are atomic, so the cursor
 * treats each joined paragraph as one flowing line. Needs line wrapping on to
 * actually reflow — create-state enables it whenever this is active.
 */
export function reflowParagraphs(): Extension {
  const field = StateField.define<DecorationSet>({
    create: build,
    update(value, tr) {
      // Rebuild on edits and as parsing advances (Paragraph nodes may be absent
      // until the fresh document finishes parsing).
      if (tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state))
        return build(tr.state)
      return value.map(tr.changes)
    },
    provide: (f) => [
      EditorView.decorations.from(f),
      EditorView.atomicRanges.of((view) => view.state.field(f))
    ]
  })
  return field
}

export { build as buildReflowDecorations }
