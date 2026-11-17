import { syntaxTree } from '@codemirror/language'
import {
  StateField,
  type EditorState,
  type Extension,
  type Range,
  type Transaction
} from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'

/**
 * One rendered construct: a table, an image, an equation. What it shows while
 * the cursor is elsewhere, and what it shows once a selection touches it.
 */
export interface Revealable {
  from: number
  to: number
  /** Decorations while no selection range touches `from..to`. */
  shown: readonly Range<Decoration>[]
  /** Decorations while one does. Usually nothing, so the source shows plainly. */
  revealed?: readonly Range<Decoration>[]
}

export interface RevealFieldOptions {
  /**
   * Rescan when the syntax tree changes without the text changing, which is
   * background parsing reaching further down a freshly opened document. A
   * construct found by walking the tree is absent until the parse gets there,
   * and without this it appeared only after a tab switch.
   */
  followParse?: boolean
}

interface RevealState {
  items: readonly Revealable[]
  /** Which items are revealed, as a key, so a move that changes none rebuilds nothing. */
  open: string
  decorations: DecorationSet
}

/** Indices of the items some selection range touches, both ends counting. */
function touched(items: readonly Revealable[], state: EditorState): number[] {
  const hit: number[] = []
  const ranges = state.selection.ranges
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    for (const range of ranges) {
      if (range.from <= item.to && range.to >= item.from) {
        hit.push(i)
        break
      }
    }
  }
  return hit
}

function decorate(items: readonly Revealable[], open: readonly number[]): DecorationSet {
  const ranges: Range<Decoration>[] = []
  let next = 0
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    if (open[next] === i) {
      next++
      if (item.revealed) for (const range of item.revealed) ranges.push(range)
    } else {
      for (const range of item.shown) ranges.push(range)
    }
  }
  return Decoration.set(ranges, true)
}

/**
 * A decoration field for constructs that render until the cursor reaches them.
 *
 * Each of these used to walk the whole document, its text or its syntax tree,
 * on every selection change, because which constructs are revealed depends on
 * the cursor. Measured on a 159,000-character note, a single arrow key cost
 * 13.6ms for equations and 1.4 to 2.5ms each for embeds, tables, HTML blocks,
 * diagrams and images: together more than a frame, for decorations that change
 * only when the cursor crosses into or out of one of them. Now the walk runs
 * when the text or the parse changes, and a selection change checks the list
 * it found.
 *
 * `scan` must not read the selection. Anything that depends on the cursor is
 * expressed as `shown` against `revealed`, which is what lets a move skip it.
 */
export function revealField(
  scan: (state: EditorState) => readonly Revealable[],
  reveal: boolean,
  options: RevealFieldOptions = {}
): Extension {
  const build = (state: EditorState): RevealState => {
    const items = scan(state)
    const open = reveal ? touched(items, state) : []
    return { items, open: open.join(','), decorations: decorate(items, open) }
  }
  const rescan = (tr: Transaction): boolean =>
    tr.docChanged ||
    (options.followParse === true && syntaxTree(tr.startState) !== syntaxTree(tr.state))

  return StateField.define<RevealState>({
    create: build,
    update(value, tr) {
      if (rescan(tr)) return build(tr.state)
      if (!reveal || !tr.selection) return value
      const open = touched(value.items, tr.state)
      const key = open.join(',')
      if (key === value.open) return value
      return { items: value.items, open: key, decorations: decorate(value.items, open) }
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations)
  })
}
