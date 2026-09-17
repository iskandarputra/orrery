import type { DocumentKind } from './document-kind'

/**
 * The three ways a note can be shown: its markdown source, rendered while it is
 * edited (Hybrid), or rendered and read-only.
 *
 * Only a note has them. Code, boards and diffs each have one view, and an HTML
 * file has its own two, kept by the reader.
 */
export const VIEW_MODES = ['source', 'live', 'reading'] as const
export type ViewMode = (typeof VIEW_MODES)[number]

/**
 * The mode a note is shown in: the one chosen for its tab, else the default.
 *
 * The default used to be the only mode there was. The switch in the header
 * wrote it, so reading one note set how every note opened afterwards, a new
 * empty one included, which then could not be typed into.
 */
export function shownViewMode(chosen: ViewMode | undefined, defaultMode: ViewMode): ViewMode {
  return chosen ?? defaultMode
}

/**
 * Settings as one document's editor sees them, with `editor.viewMode` holding
 * that document's mode rather than the default.
 *
 * Rewritten rather than passed alongside, because plugins read the mode off
 * the settings they are handed. Wikilinks does, to decide whether a click
 * reveals the source, and it would reveal it in a note being read if it saw
 * the default instead. The same object comes back when nothing differs.
 */
export function settingsForDocument<S extends { editor: { viewMode: ViewMode } }>(
  settings: S,
  chosen: ViewMode | undefined
): S {
  const mode = shownViewMode(chosen, settings.editor.viewMode)
  if (mode === settings.editor.viewMode) return settings
  return { ...settings, editor: { ...settings.editor, viewMode: mode } }
}

/**
 * A mode to fix on a note's tab as it opens, or undefined to leave the tab
 * following the default.
 *
 * A blank note never opens in Reading. There is nothing in it to read, and
 * Reading is the one mode with no caret, so a note made to be written in
 * arrived refusing every keystroke. Both ways of making one produce this case:
 * Ctrl+N starts an untitled buffer with no text, and the file tree creates an
 * empty file and opens it. It is fixed at open rather than worked out on each
 * render, or the first character typed would make the note not blank any more
 * and flip it into Reading under the cursor.
 */
export function openingViewMode(
  kind: DocumentKind,
  defaultMode: ViewMode,
  content: string
): ViewMode | undefined {
  if (kind !== 'markdown' || defaultMode !== 'reading') return undefined
  // Whitespace renders as nothing, so a file of newlines is as blank as ''.
  return /\S/.test(content) ? undefined : 'live'
}

/** The order Cycle View Mode steps through: Hybrid, Reading, Edit, and round. */
export function nextViewMode(mode: ViewMode): ViewMode {
  if (mode === 'live') return 'reading'
  if (mode === 'reading') return 'source'
  return 'live'
}
