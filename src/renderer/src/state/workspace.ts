import type { StateCreator } from 'zustand'
import type { FileNode, FsEvent } from '@shared/types'
import { buildNoteIndex, type NoteRef } from '@core/notes'
import { pushRecent } from '@core/recent'
import { invoke, parseIpcError } from '@/services/client'
import type { AppState } from './store'

export interface WorkspaceSlice {
  rootPath: string | null
  tree: FileNode | null
  watchId: string | null
  /** Markdown notes in the workspace — powers wikilink resolution/completion. */
  noteIndex: NoteRef[]

  /** Open a folder as the workspace; no argument shows the folder picker. */
  openFolder(path?: string): Promise<void>
  refreshTree(): Promise<void>
  onFsChanged(events: FsEvent[]): void
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null

export const createWorkspaceSlice: StateCreator<AppState, [], [], WorkspaceSlice> = (set, get) => ({
  rootPath: null,
  tree: null,
  watchId: null,
  noteIndex: [],

  async openFolder(path) {
    const target = path ?? (await invoke('dialog:openFolder', undefined))
    if (!target) return

    const previousWatch = get().watchId
    if (previousWatch) void invoke('fs:unwatch', { watchId: previousWatch })

    try {
      const tree = await invoke('fs:readTree', { path: target })
      const { watchId } = await invoke('fs:watch', { path: target })
      set({ rootPath: target, tree, watchId, noteIndex: buildNoteIndex(tree) })
      get().updateSettings({
        lastOpenedFolder: target,
        recentFolders: pushRecent(get().settings.recentFolders, target)
      })
    } catch (err) {
      // Folder gone (e.g. a stale recent entry) — drop it from the list.
      console.error('Could not open folder', target, parseIpcError(err).message)
      get().updateSettings({
        recentFolders: get().settings.recentFolders.filter((f) => f !== target)
      })
    }
  },

  async refreshTree() {
    const root = get().rootPath
    if (!root) return
    try {
      const tree = await invoke('fs:readTree', { path: root })
      set({ tree, noteIndex: buildNoteIndex(tree) })
    } catch {
      // Root folder disappeared — close the workspace.
      set({ rootPath: null, tree: null, watchId: null, noteIndex: [] })
    }
  },

  onFsChanged(events) {
    // Reload open buffers whose backing file changed externally (clean only).
    for (const event of events) {
      if (event.kind === 'changed' && !event.isDirectory) {
        void get().reloadFromDisk(event.path)
      }
    }
    // Structure changes: debounce a full tree re-read (simple and robust).
    if (events.some((e) => e.kind === 'created' || e.kind === 'removed')) {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        void get().refreshTree()
      }, 200)
    }
  }
})
