import { RangeSetBuilder, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view'

/**
 * Typewriter mode: keep the caret line vertically centered. Implemented as a
 * scroll padding equal to half the viewport plus a re-center on cursor moves,
 * so the writing line stays put while text scrolls under it.
 */
export function typewriterMode(): Extension {
  const centerActive = (view: EditorView): void => {
    const head = view.state.selection.main.head
    view.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'center' }) })
  }
  return ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        // Center once mounted.
        requestAnimationFrame(() => centerActive(view))
      }
      update(update: ViewUpdate): void {
        if (update.docChanged || update.selectionSet) {
          // Defer so layout is settled before we measure/scroll.
          requestAnimationFrame(() => centerActive(update.view))
        }
      }
    }
  )
}

const dimLine = Decoration.line({ class: 'cm-zy-dim' })

/**
 * Focus mode: dim every line except the one holding the caret. Uses line
 * decorations over the visible range only, so it's cheap on large docs.
 */
export function focusMode(): Extension {
  const build = (view: EditorView): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>()
    const activeLines = new Set(
      view.state.selection.ranges.map((r) => view.state.doc.lineAt(r.head).number)
    )
    for (const { from, to } of view.visibleRanges) {
      let pos = from
      while (pos <= to) {
        const line = view.state.doc.lineAt(pos)
        if (!activeLines.has(line.number)) builder.add(line.from, line.from, dimLine)
        pos = line.to + 1
      }
    }
    return builder.finish()
  }
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = build(view)
      }
      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = build(update.view)
        }
      }
    },
    { decorations: (v) => v.decorations }
  )
}
