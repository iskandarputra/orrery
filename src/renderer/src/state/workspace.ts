import type { StateCreator } from 'zustand'
import type { FileNode, FsEvent } from '@shared/types'
import { filesFromPaths, notesFromPaths, type NoteRef } from '@core/notes'
import { loadedDirs, parentDir, withChildren } from '@core/file-tree'
import { pushRecent } from '@core/recent'
import { invoke, parseIpcError } from '@/services/client'
import type { AppState } from './app-state'

export interface WorkspaceSlice {
  rootPath: string | null
  tree: FileNode | null
  watchId: string | null
  /** Markdown notes in the workspace — powers wikilink resolution/completion. */
  noteIndex: NoteRef[]
  /** Every file, for quick open. Notes only would not find a code file. */
  fileIndex: NoteRef[]
  /**
   * True when the vault has more files than the index will hold.
   *
   * Said out loud rather than hidden: in a folder this size, quick open and
   * link resolution know about the first files they found and not the rest,
   * and somebody who cannot find a note deserves to know why.
   */
  indexTruncated: boolean

  /** Open a folder as the workspace; no argument shows the folder picker. */
  openFolder(path?: string): Promise<void>
  refreshTree(): Promise<void>
  /** Walk the vault for the quick-open and wikilink indexes. */
  refreshIndex(): Promise<void>
  /** Read one directory's entries into the tree, when it is opened. */
  loadDir(path: string): Promise<void>
  /** Watch the vault root and whichever directories are open, and nothing else. */
  syncWatchPaths(): void
  onFsChanged(events: FsEvent[]): void
}

/**
 * How many files the index will hold.
 *
 * Big enough for any vault anyone actually keeps notes in — the folder that
 * prompted this has 365,000 files in it, and an index of them would be a
 * quarter of a second of work and forty megabytes of strings to answer
 * questions about files nobody was going to open.
 */
const MAX_INDEXED_FILES = 60_000

let refreshTimer: ReturnType<typeof setTimeout> | null = null
/** Directories with changes waiting to be read again. */
const pendingDirs = new Set<string>()

export const createWorkspaceSlice: StateCreator<AppState, [], [], WorkspaceSlice> = (set, get) => ({
  rootPath: null,
  tree: null,
  watchId: null,
  noteIndex: [],
  fileIndex: [],
  indexTruncated: false,

  async openFolder(path) {
    const target = path ?? (await invoke('dialog:openFolder', undefined))
    if (!target) return

    const previousWatch = get().watchId
    if (previousWatch) void invoke('fs:unwatch', { watchId: previousWatch })

    try {
      // The top level only. Everything below it arrives when somebody opens it,
      // which is what keeps opening a folder instant however much is in it.
      const tree = await invoke('fs:readTree', { path: target })
      const { watchId } = await invoke('fs:watch', { path: target })
      set({
        rootPath: target,
        tree,
        watchId,
        noteIndex: [],
        fileIndex: [],
        indexTruncated: false
      })
      get().updateSettings({
        lastOpenedFolder: target,
        recentFolders: pushRecent(get().settings.recentFolders, target)
      })
      // Not awaited: the vault is usable — and the window responsive — while
      // the walk that finds every file for quick open and wikilinks is still
      // running.
      void get().refreshIndex()
    } catch (err) {
      // Folder gone (e.g. a stale recent entry) — drop it from the list.
      console.error('Could not open folder', target, parseIpcError(err).message)
      get().updateSettings({
        recentFolders: get().settings.recentFolders.filter((f) => f !== target)
      })
    }
  },

  /**
   * Read the vault again, keeping the directories that were open, open.
   *
   * A refresh used to re-read the entire tree; on a large folder that was
   * another eight seconds and another seventy megabytes. Only what is on
   * screen is read again, which is all that can have changed visibly.
   */
  async refreshTree() {
    const root = get().rootPath
    if (!root) return
    const open = loadedDirs(get().tree).filter((dir) => dir !== root)
    try {
      const tree = await invoke('fs:readTree', { path: root })
      set({ tree })
      for (const dir of open) await get().loadDir(dir)
      void get().refreshIndex()
    } catch {
      // Root folder disappeared — close the workspace.
      set({ rootPath: null, tree: null, watchId: null, noteIndex: [], fileIndex: [] })
    }
  },

  async loadDir(dirPath) {
    const tree = get().tree
    if (!tree) return
    try {
      const children = await invoke('fs:readDir', { path: dirPath })
      // Read against the tree as it is *now*: another directory may have
      // finished loading while this one was being read, and writing back a
      // tree captured beforehand would drop it.
      set((s) => ({ tree: s.tree ? withChildren(s.tree, dirPath, children) : s.tree }))
      // Watched once it is loaded, not when it is clicked: the click is where
      // the read starts, and a directory with no children yet is not one this
      // window can report changes about.
      get().syncWatchPaths()
    } catch {
      // A directory that cannot be read — gone, or not ours — stays unopened.
    }
  },

  /**
   * Every file in the vault, for quick open and for resolving links.
   *
   * Built from a flat walk rather than from the tree, because the tree only
   * knows about the parts somebody has opened, and a wikilink has to resolve
   * whether or not its folder has ever been expanded.
   */
  async refreshIndex() {
    const root = get().rootPath
    if (!root) return
    try {
      const { paths, truncated } = await invoke('fs:listFiles', {
        path: root,
        limit: MAX_INDEXED_FILES
      })
      if (get().rootPath !== root) return // another vault was opened meanwhile
      set({
        noteIndex: notesFromPaths(paths),
        fileIndex: filesFromPaths(paths),
        indexTruncated: truncated
      })
    } catch {
      // No index is a vault where quick open finds nothing, which is bad but
      // is not a reason for the window to stop working.
    }
  },

  syncWatchPaths() {
    const { watchId, rootPath, tree } = get()
    if (!watchId || !rootPath) return
    const expanded = get().expandedDirs
    // The root always, plus the directories actually open on screen. Watching
    // the rest would mean a file handle per directory in the vault for events
    // about files nobody can see.
    const paths = [rootPath, ...loadedDirs(tree).filter((dir) => expanded[dir])]
    void invoke('fs:watchPaths', { watchId, paths: paths.slice(0, 2000) })
  },

  onFsChanged(events) {
    // Reload open buffers whose backing file changed externally (clean only).
    for (const event of events) {
      if (event.kind === 'changed' && !event.isDirectory) {
        void get().reloadFromDisk(event.path)
      }
    }
    // A file appearing or disappearing changes one directory, so that is the
    // one that is read again — not the whole vault, which is how this used to
    // work and what made every save in a large folder cost a full rescan.
    const touched = new Set(
      events
        .filter((e) => e.kind === 'created' || e.kind === 'removed')
        .map((e) => parentDir(e.path))
    )
    if (touched.size === 0) return
    for (const dir of touched) pendingDirs.add(dir)
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      const dirs = [...pendingDirs]
      pendingDirs.clear()
      const open = new Set(loadedDirs(get().tree))
      for (const dir of dirs) if (open.has(dir)) void get().loadDir(dir)
      // The index is a list of names, and names have changed.
      void get().refreshIndex()
    }, 200)
  }
})
