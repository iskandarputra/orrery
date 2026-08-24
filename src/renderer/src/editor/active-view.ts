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
