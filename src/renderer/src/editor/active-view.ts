import type { EditorView } from '@codemirror/view'

/**
 * The single live EditorView (one editor pane for now). Held outside React
 * and Zustand so commands and store actions can reach the current document
 * without threading the view through state.
 */
let activeView: EditorView | null = null

export function setActiveView(view: EditorView | null): void {
  activeView = view
}

export function getActiveView(): EditorView | null {
  return activeView
}

/**
 * Live views by buffer, one per visible pane. Saving must read the *editor's*
 * state rather than the registry's periodic copy, or a split pane could lose
 * the last second of typing; with two panes, "the active view" is no longer
 * enough to find it.
 */
const paneViews = new Map<string, EditorView>()

export function registerPaneView(bufferId: string, view: EditorView | null): void {
  if (view) paneViews.set(bufferId, view)
  else paneViews.delete(bufferId)
}

export function viewForBuffer(bufferId: string): EditorView | null {
  return paneViews.get(bufferId) ?? null
}
