import type { DocumentsSlice } from './documents'
import type { GraphSlice } from './graph'
import type { McpSlice } from './mcp'
import type { UiSlice } from './ui'
import type { WorkspaceSlice } from './workspace'

/**
 * The whole store's type, in a module of its own.
 *
 * Every slice needs it — a slice action reaches the rest of the store through
 * `get()` — and the store needs every slice. Declaring it in `store.ts` made
 * that a cycle: four of them, one per slice. They were type-only and so erased
 * before they could do any harm at runtime, but a dependency graph that reports
 * cycles is one nobody reads, and the next cycle would be a real one.
 */
export type AppState = DocumentsSlice & WorkspaceSlice & UiSlice & GraphSlice & McpSlice

/** The file in the focused pane, or '' when the pane holds nothing saved yet. */
export function activeFilePath(state: AppState): string {
  return (state.activeId && state.buffers[state.activeId]?.filePath) || ''
}
