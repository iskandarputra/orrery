import { syntaxTree } from '@codemirror/language'
import type { EditorState, Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { formatTable } from '@core/markdown-table'

/**
 * Lining up the pipes in a markdown table.
 *
 * A table is typed one cell at a time and comes out ragged, which is fine for
 * a parser and unreadable for a person — and the source is what you are looking
 * at whenever the cursor is inside the table, since the rendered version steps
 * aside to let you edit.
 *
 * So a table is tidied when you leave it, and only if you changed it. Not while
 * typing: rewriting the line under someone's cursor moves the cursor, and a
 * formatter that fights the typist is one people switch off. Leaving is the
 * moment the table is finished with, and it is exactly when the live preview
 * swaps the source for the rendering anyway. Only-if-changed matters as much:
 * a table you walked the cursor through comes back as it was, and undoing a
 * tidy does not simply tidy it again the moment you move away.
 *
 * One transaction, so the rewrite is one thing in the history rather than a
 * cell at a time.
 */

interface TableRange {
  from: number
  to: number
}

/** The table containing this position, as whole lines, or null. */
export function tableAt(state: EditorState, pos: number): TableRange | null {
  let found: TableRange | null = null
  syntaxTree(state).iterate({
    from: pos,
    to: pos,
    enter: (node) => {
      if (node.name !== 'Table') return
      const from = state.doc.lineAt(node.from).from
      const to = state.doc.lineAt(Math.min(node.to, state.doc.length)).to
      found = { from, to }
    }
  })
  return found
}

/** Rewrite one table so its columns line up. Returns false if there is nothing to do. */
export function formatTableAt(view: EditorView, pos: number): boolean {
  const range = tableAt(view.state, pos)
  if (!range) return false

  const source = view.state.doc.sliceString(range.from, range.to)
  const formatted = formatTable(source)
  if (!formatted || formatted === source) return false

  view.dispatch({
    changes: { from: range.from, to: range.to, insert: formatted },
    // The cursor stays where it was unless the rewrite swallowed it, which the
    // mapping handles; without this the selection would jump to the end.
    selection: view.state.selection,
    scrollIntoView: false,
    userEvent: 'format.table'
  })
  return true
}

/**
 * The table this view has edited but not yet left, by its starting position.
 *
 * Only an edited table is tidied. A table you merely walked the cursor through
 * should come back exactly as it was — and without this, undoing a tidy and
 * moving away would tidy it straight back, which makes the undo look broken.
 */
const editedTable = new WeakMap<EditorView, number | null>()

/**
 * Tidy a table when the cursor leaves it, if it was edited while inside.
 *
 * `enabled` is off in Reading mode, where the source is never shown and never
 * edited, so there is nothing to tidy.
 */
export function tableAutoFormat(enabled: boolean): Extension {
  if (!enabled) return []

  return EditorView.updateListener.of((update) => {
    const here = tableAt(update.state, update.state.selection.main.head)

    if (update.docChanged) {
      // Typing inside a table marks it; typing anywhere else does not.
      if (here) editedTable.set(update.view, here.from)
      return
    }
    if (!update.selectionSet) return

    const before = tableAt(update.startState, update.startState.selection.main.head)
    if (!before) return
    // Still in the same table: nothing has been left yet.
    if (here && here.from === before.from) return

    const edited = editedTable.get(update.view)
    if (edited !== before.from) return
    editedTable.set(update.view, null)

    // The positions come from the state before this update, and nothing in it
    // changed the document, so they still address the same lines.
    formatTableAt(update.view, before.from)
  })
}
