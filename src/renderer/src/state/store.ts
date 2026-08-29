import { create } from 'zustand'
import { createDocumentsSlice } from './documents'
import { createGraphSlice } from './graph'
import { createMcpSlice } from './mcp'
import { createUiSlice } from './ui'
import { createWorkspaceSlice } from './workspace'
import type { AppState } from './app-state'
import { provideAppState } from './app-state-access'

export type { AppState }

/**
 * Single store, five slices. Store logic is plain functions over the typed
 * IPC client seam, so every flow (open/save/close/dirty) is testable in Node
 * with a fake OrreryApi — no Electron, no React.
 */
export const useStore = create<AppState>()((...args) => ({
  ...createDocumentsSlice(...args),
  ...createWorkspaceSlice(...args),
  ...createUiSlice(...args),
  ...createGraphSlice(...args),
  ...createMcpSlice(...args)
}))

// Handed over once, here, so the modules the slices pull in can reach the store
// without importing it — see app-state-access.ts.
provideAppState(() => useStore.getState())
