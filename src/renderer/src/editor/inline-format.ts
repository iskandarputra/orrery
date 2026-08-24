import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/**
 * Toggle an inline marker (==, **, …) around every selection range.
 * Pure over EditorState so it unit-tests without a view; multi-cursor aware
 * via changeByRange. An empty selection inserts the pair with the caret inside.
 */
export function toggleInlineMarkSpec(state: EditorState, marker: string): TransactionSpec {
  const len = marker.length
  return state.changeByRange((range) => {
    const { from, to } = range
    const before = state.sliceDoc(Math.max(0, from - len), from)
    const after = state.sliceDoc(to, to + len)
    const inner = state.sliceDoc(from, to)

    // Selection sits inside an existing pair → unwrap it.
    if (before === marker && after === marker) {
      return {
        changes: [
          { from: from - len, to: from },
          { from: to, to: to + len }
        ],
        range: EditorSelection.range(from - len, to - len)
      }
    }
    // Selection includes the pair → strip it.
    if (inner.length >= 2 * len && inner.startsWith(marker) && inner.endsWith(marker)) {
      return {
        changes: [
          { from, to: from + len },
          { from: to - len, to }
        ],
        range: EditorSelection.range(from, to - 2 * len)
      }
    }
    // Wrap. Empty selection leaves the caret between the markers.
    return {
      changes: [
        { from, insert: marker },
        { from: to, insert: marker }
      ],
      range: EditorSelection.range(from + len, to + len)
    }
  })
}

export function toggleInlineMark(marker: string) {
  return (view: EditorView): boolean => {
    view.dispatch(toggleInlineMarkSpec(view.state, marker), {
      scrollIntoView: true,
      userEvent: 'input'
    })
    return true
  }
}

export const toggleHighlight = toggleInlineMark('==')
