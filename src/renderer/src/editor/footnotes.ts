import type { Extension, Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view'
import { definitionFor, findFootnotes, numbering } from '@core/footnotes'

/**
 * Footnotes rendered where they are written.
 *
 * `[^label]` becomes a small raised number, and clicking it jumps to the
 * definition at the bottom of the file. Markdown allows any label, so the
 * number comes from the order of first use, which is what every other renderer
 * shows.
 *
 * Scanned rather than read from the syntax tree: footnotes are not part of the
 * markdown grammar the editor parses, so this follows the wikilink pattern.
 */

class MarkerWidget extends WidgetType {
  constructor(
    private readonly number: number,
    private readonly label: string,
    private readonly target: number | null
  ) {
    super()
  }

  override eq(other: MarkerWidget): boolean {
    return (
      other.number === this.number && other.label === this.label && other.target === this.target
    )
  }

  override toDOM(): HTMLElement {
    const el = document.createElement('sup')
    el.className = `cm-or-footnote${this.target === null ? ' cm-or-footnote--missing' : ''}`
    el.textContent = String(this.number)
    el.title =
      this.target === null ? `[^${this.label}] has no definition` : `Go to note ${this.number}`
    if (this.target !== null) el.dataset['pos'] = String(this.target)
    return el
  }

  override ignoreEvent(): boolean {
    return false
  }
}

/** Jump to the definition a marker points at. */
const clickHandler = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = (event.target as HTMLElement).closest?.('.cm-or-footnote')
    if (!(target instanceof HTMLElement)) return false
    const pos = Number(target.dataset['pos'])
    if (!Number.isFinite(pos)) return false
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
    event.preventDefault()
    return true
  }
})

export function footnoteRendering(reveal = true): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none

      constructor(view: EditorView) {
        this.build(view)
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || (reveal && update.selectionSet)) {
          this.build(update.view)
        }
      }

      private build(view: EditorView): void {
        const { state } = view
        // Numbered over the whole document, not the viewport: a marker must not
        // change number when the reference above it scrolls out of sight.
        const all = findFootnotes(state.doc.toString())
        const numbers = numbering(all)
        const marks: Range<Decoration>[] = []

        for (const ref of all.refs) {
          if (!view.visibleRanges.some((r) => ref.from >= r.from && ref.to <= r.to)) continue
          // Revealed when the cursor is on it, like every other rendered mark.
          const touched =
            reveal && state.selection.ranges.some((r) => r.from <= ref.to && r.to >= ref.from)
          if (touched) continue
          const definition = definitionFor(all, ref.label)
          marks.push(
            Decoration.replace({
              widget: new MarkerWidget(
                numbers.get(ref.label) ?? 0,
                ref.label,
                definition ? definition.from : null
              )
            }).range(ref.from, ref.to)
          )
        }

        // The definitions themselves get a class so they can be set apart from
        // the prose above them without being hidden: they are the content.
        //
        // Only the start has to be visible. A definition running past the
        // bottom of the viewport is still a definition, and testing its end
        // dropped the last one in the file.
        for (const def of all.defs) {
          if (!view.visibleRanges.some((r) => def.from >= r.from && def.from <= r.to)) continue
          marks.push(Decoration.line({ class: 'cm-or-footnote-def' }).range(def.from))
        }

        marks.sort((a, b) => a.from - b.from || (a.value.startSide ?? 0) - (b.value.startSide ?? 0))
        this.decorations = Decoration.set(marks, true)
      }
    },
    { decorations: (v) => v.decorations }
  )
  return [plugin, clickHandler]
}
