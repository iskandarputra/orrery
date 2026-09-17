import { RangeSet, StateEffect, StateField, RangeSetBuilder } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  GutterMarker,
  WidgetType,
  gutter,
  gutterLineClass,
  type DecorationSet
} from '@codemirror/view'

/**
 * What one pane of a side-by-side diff draws on top of the text.
 *
 * Three things: a background on the lines that changed, a bar and a coloured
 * number beside them, and blank space where the *other* file has lines this one
 * does not. The blank space is what keeps the panes level: without it the two
 * sides slide apart at the first insertion and nothing below it can be compared
 * by eye.
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

/**
 * The bar beside a changed line.
 *
 * The tint alone was the whole of how a change was shown, and it cannot be made
 * strong enough to find by eye: it sits under the text, so every step darker
 * takes contrast from the code on the line. At the 8% it is held to, a removed
 * line in Tokyo Night measured 1.07:1 against an unchanged one. The bar and the
 * number sit where there is no code, so they take the diff colour at full
 * strength and cost the text nothing.
 */
class ChangeBar extends GutterMarker {
  constructor(private readonly side: 'old' | 'new') {
    super()
  }

  override eq(other: ChangeBar): boolean {
    return other.side === this.side
  }

  override toDOM(): Node {
    const bar = document.createElement('span')
    bar.className = `cm-or-diff-bar cm-or-diff-bar--${this.side}`
    return bar
  }
}

/**
 * A class on every gutter element of a changed line, which is how its number
 * takes the diff colour.
 *
 * Its own marker, and one with nothing to draw. Given the bar instead, the
 * line-number gutter drew the bar too, and a number gutter hides the number of
 * any line another marker draws in, so every changed line lost its number.
 */
class ChangedLineClass extends GutterMarker {
  override readonly elementClass: string

  constructor(private readonly side: 'old' | 'new') {
    super()
    this.elementClass = `cm-or-diff-changed cm-or-diff-changed--${side}`
  }

  override eq(other: ChangedLineClass): boolean {
    return other.side === this.side
  }
}

const changeBar = { old: new ChangeBar('old'), new: new ChangeBar('new') }
const changedLineClass = { old: new ChangedLineClass('old'), new: new ChangedLineClass('new') }

interface PaneMarks {
  decorations: DecorationSet
  bars: RangeSet<GutterMarker>
  classes: RangeSet<GutterMarker>
}

function build(
  state: { doc: { lines: number; line: (n: number) => { from: number } } },
  marks: DiffMarks
): PaneMarks {
  const builder = new RangeSetBuilder<Decoration>()
  const bars = new RangeSetBuilder<GutterMarker>()
  const classes = new RangeSetBuilder<GutterMarker>()
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
    if (changed.has(n)) {
      builder.add(from, from, changedLine[marks.side])
      bars.add(from, from, changeBar[marks.side])
      classes.add(from, from, changedLineClass[marks.side])
    }
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
  return { decorations: builder.finish(), bars: bars.finish(), classes: classes.finish() }
}

/**
 * Built from one set of marks in one pass, so a line cannot be tinted without
 * its bar or barred without its tint.
 */
const paneMarks = StateField.define<PaneMarks>({
  create: () => ({ decorations: Decoration.none, bars: RangeSet.empty, classes: RangeSet.empty }),
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setDiffMarks)) return build(tr.state, effect.value)
    }
    if (!tr.docChanged) return value
    return {
      decorations: value.decorations.map(tr.changes),
      bars: value.bars.map(tr.changes),
      classes: value.classes.map(tr.changes)
    }
  },
  provide: (f) => [
    EditorView.decorations.from(f, (marks) => marks.decorations),
    gutterLineClass.from(f, (marks) => marks.classes)
  ]
})

export const diffMarks = [
  paneMarks,
  // Always present, like the git gutter in the editor: a column that appeared
  // with the first change would shift the whole pane sideways as it loaded.
  gutter({ class: 'cm-or-diff-gutter', markers: (view) => view.state.field(paneMarks).bars })
]
