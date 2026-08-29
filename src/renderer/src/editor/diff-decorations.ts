import { StateEffect, StateField, RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'

/**
 * What one pane of a side-by-side diff draws on top of the text.
 *
 * Two things: a background on the lines that changed, and blank space where the
 * *other* file has lines this one does not. The blank space is what keeps the
 * panes level — without it the two sides slide apart at the first insertion and
 * nothing below it can be compared by eye.
 */

export interface DiffMarks {
  /** 1-based lines to mark as changed. */
  changed: number[]
  /** Filler lines to insert above a given 1-based line. */
  padding: Map<number, number>
  /** Which side this pane is, so the colours can differ. */
  side: 'old' | 'new'
}

export const setDiffMarks = StateEffect.define<DiffMarks>()

/**
 * Blank space standing in for lines the other file has.
 *
 * Sized in `em` against the editor's own line height rather than in pixels, so
 * it stays level when the font size setting changes — a filler measured once in
 * pixels is wrong the moment the text it is padding is not the size it was.
 */
class FillerWidget extends WidgetType {
  constructor(
    private readonly lines: number,
    private readonly side: 'old' | 'new'
  ) {
    super()
  }

  override eq(other: FillerWidget): boolean {
    return other.lines === this.lines && other.side === this.side
  }

  override toDOM(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'cm-or-diff-filler'
    el.style.height = `calc(${this.lines} * var(--or-editor-line-height) * 1em)`
    return el
  }

  override get estimatedHeight(): number {
    return this.lines * 20
  }

  /** Nothing to select, and no cursor position of its own. */
  override ignoreEvent(): boolean {
    return false
  }
}

const changedLine = {
  old: Decoration.line({ class: 'cm-or-diff-line cm-or-diff-line--old' }),
  new: Decoration.line({ class: 'cm-or-diff-line cm-or-diff-line--new' })
}

function build(
  state: { doc: { lines: number; line: (n: number) => { from: number } } },
  marks: DiffMarks
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const changed = new Set(marks.changed)
  const total = state.doc.lines

  // One pass in document order: a RangeSetBuilder requires it, and both the
  // filler above a line and the line's own mark start at the same position.
  for (let n = 1; n <= total; n++) {
    const from = state.doc.line(n).from
    const pad = marks.padding.get(n)
    if (pad) {
      builder.add(
        from,
        from,
        Decoration.widget({ widget: new FillerWidget(pad, marks.side), block: true, side: -1 })
      )
    }
    if (changed.has(n)) builder.add(from, from, changedLine[marks.side])
  }

  // Padding past the last line has no line to sit above, so it hangs off the
  // end of the document instead.
  const tail = marks.padding.get(total + 1)
  if (tail) {
    const end = state.doc.line(total).from
    builder.add(
      end,
      end,
      Decoration.widget({ widget: new FillerWidget(tail, marks.side), block: true, side: 1 })
    )
  }
  return builder.finish()
}

export const diffMarks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setDiffMarks)) return build(tr.state, effect.value)
    }
    return value.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f)
})
