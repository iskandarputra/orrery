import type { EditorContextRequest } from '@shared/ipc'
import type { MenuItem } from './context-menu/context-menu'

/** Longest selection shown inside the "Search vault for…" label. */
const SEARCH_LABEL_CHARS = 28

export interface EditorMenuActions {
  cut(): void
  copy(): void
  paste(): void
  selectAll(): void
  /** Wrap the selection in a markdown marker, e.g. `**` or `_`. */
  format(marker: string): void
  insertLink(): void
  searchVault(query: string): void
  correctSpelling(word: string): void
}

/**
 * The right-click menu for the editor, as data.
 *
 * Built from the params Electron reports for the click, so the menu reflects
 * what is actually there: no paste where nothing can be typed, no formatting
 * without a selection, and the spellchecker's suggestions at the top where a
 * flagged word is what the user right-clicked to fix.
 */
export function buildEditorMenu(
  request: EditorContextRequest,
  actions: EditorMenuActions
): MenuItem[] {
  const items: MenuItem[] = []
  const selection = request.selectionText.trim()

  if (request.misspelledWord) {
    if (request.dictionarySuggestions.length > 0) {
      for (const suggestion of request.dictionarySuggestions) {
        items.push({ label: suggestion, onSelect: () => actions.correctSpelling(suggestion) })
      }
    } else {
      items.push({ label: 'No suggestions', disabled: true, onSelect: () => {} })
    }
    items.push({ separator: true })
  }

  items.push(
    { label: 'Cut', icon: 'trash', disabled: !selection, onSelect: actions.cut },
    { label: 'Copy', icon: 'copy', disabled: !selection, onSelect: actions.copy }
  )
  if (request.isEditable) items.push({ label: 'Paste', icon: 'download', onSelect: actions.paste })
  items.push({ label: 'Select all', onSelect: actions.selectAll })

  if (selection && request.isEditable) {
    items.push(
      { separator: true },
      { label: 'Bold', icon: 'bold', onSelect: () => actions.format('**') },
      { label: 'Italic', icon: 'italic', onSelect: () => actions.format('_') },
      { label: 'Highlight', icon: 'pencil', onSelect: () => actions.format('==') },
      { label: 'Inline code', icon: 'code', onSelect: () => actions.format('`') },
      { label: 'Link', icon: 'link', onSelect: actions.insertLink }
    )
  }

  if (selection) {
    const shown =
      selection.length > SEARCH_LABEL_CHARS
        ? `${selection.slice(0, SEARCH_LABEL_CHARS - 1)}…`
        : selection
    items.push(
      { separator: true },
      {
        label: `Search vault for “${shown}”`,
        icon: 'search',
        onSelect: () => actions.searchVault(selection)
      }
    )
  }

  return items
}
