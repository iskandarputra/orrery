import type { EditorView } from '@codemirror/view'
import { serverForFile } from '@core/lsp-servers'
import { appState } from '@/state/app-state-access'
import { invoke } from '@/services/client'
import { docPathFacet } from './doc-context'
import { offsetToPosition, positionToOffset } from './lsp-position'
import { viewForBuffer } from './active-view'

/**
 * Jump to where the symbol under the cursor is defined.
 *
 * The target may be in another file, so the note is opened first and the jump
 * runs once its view exists — which is a frame later, since opening a buffer
 * mounts an editor.
 */
export async function goToDefinition(view: EditorView): Promise<boolean> {
  const path = view.state.facet(docPathFacet)
  if (!path || !serverForFile(path)) return false

  const { line, character } = offsetToPosition(view.state, view.state.selection.main.head)
  let target: { path: string; line: number; character: number } | null = null
  try {
    target = await invoke('lsp:definition', { path, line, character })
  } catch {
    return false
  }
  if (!target) return false

  if (target.path === path) {
    reveal(view, target.line, target.character)
    return true
  }

  const store = appState()
  await store.openPaths([target.path])
  const bufferId = Object.values(appState().buffers).find(
    (b) => b.filePath === target.path
  )?.id
  if (!bufferId) return false
  // The pane mounts its view after the store updates, so the jump waits a frame.
  await new Promise((resolve) => requestAnimationFrame(resolve))
  const opened = viewForBuffer(bufferId)
  if (!opened) return false
  reveal(opened, target.line, target.character)
  return true
}

function reveal(view: EditorView, line: number, character: number): void {
  const pos = positionToOffset(view.state, { line, character })
  view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
  view.focus()
}
