import { create } from 'zustand'
import { createDocumentsSlice, type DocumentsSlice } from './documents'
import { createUiSlice, type UiSlice } from './ui'
import { createWorkspaceSlice, type WorkspaceSlice } from './workspace'

export type AppState = DocumentsSlice & WorkspaceSlice & UiSlice

/**
 * Single store, three slices. Store logic is plain functions over the typed
 * IPC client seam, so every flow (open/save/close/dirty) is testable in Node
 * with a fake ZymdApi — no Electron, no React.
 */
export const useStore = create<AppState>()((...args) => ({
  ...createDocumentsSlice(...args),
  ...createWorkspaceSlice(...args),
  ...createUiSlice(...args)
}))
