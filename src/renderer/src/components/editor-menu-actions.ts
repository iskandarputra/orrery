import { selectAll } from '@codemirror/commands'
import { applyInlineFormat, insertSnippet } from '@/editor/format-helpers'
import { getActiveView } from '@/editor/active-view'
import { appState } from '@/state/app-state-access'
import { invoke } from '@/services/client'
import type { EditorMenuActions } from './editor-menu'

/**
 * What the editor's context menu actually does. Clipboard actions go through
 * `execCommand` because the selection lives in a contenteditable the browser
 * already owns — routing them through the clipboard API would need permissions
 * and lose the editor's own undo grouping.
 */
export function editorMenuActions(): EditorMenuActions {
  return {
    cut: () => document.execCommand('cut'),
    copy: () => document.execCommand('copy'),
    paste: () => document.execCommand('paste'),
    selectAll: () => {
      const view = getActiveView()
      if (view) {
        selectAll(view)
        view.focus()
      }
    },
    format: (marker) => applyInlineFormat(marker),
    insertLink: () => {
      const view = getActiveView()
      const selected = view
        ? view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)
        : ''
      // Caret lands inside the target, which is what you still have to fill in.
      insertSnippet(`[${selected}]()`, selected.length + 3)
    },
    searchVault: (query) => appState().searchVaultFor(query),
    correctSpelling: (word) => void invoke('editor:replaceMisspelling', { word })
  }
}
