import type { StateCreator } from 'zustand'
import type { FileNode, FsEvent } from '@shared/types'
import { filesFromPaths, notesFromPaths, type NoteRef } from '@core/notes'
import { loadedDirs, parentDir, withChildren } from '@core/file-tree'
import { pushRecent } from '@core/recent'
import { EMPTY_STATUS, type GitStatus } from '@core/git-status'
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

  /**
   * Bumped when the repository's state moves: a commit, a stage, a checkout, a
   * new branch, wherever it was done. Status and history both read again.
   */
  gitRepositoryRevision: number
  /** Bumped when files in the work tree may have changed. Status reads again. */
  gitWorktreeRevision: number
  /**
   * Say that something git reports on may have changed.
   *
   * Coalesced, because the signals come in bursts: a save is a write and a
   * rename, a checkout rewrites many files, and each read of status is a git
   * process. A burst is one read.
   */
  noteGitChange(scope: 'repository' | 'worktree'): void
  /**
   * The vault's repository status, as of the last read: what the source control
   * icon counts and the panel lists. Kept here rather than in the panel, because
   * the icon has to show it while the panel is not on screen. Null before the
   * first read; `rootPath` says which vault it belongs to.
   */
  gitStatus: { rootPath: string; isRepo: boolean; status: GitStatus } | null
  /** Read it again, and start hearing about the repository if there is one. */
  refreshGitStatus(): Promise<void>
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
/** Short enough not to be noticed, long enough to swallow a burst. */
const GIT_SETTLE_MS = 150
/** Bumped per status read, so an answer that has been overtaken is dropped. */
let statusReads = 0
const gitTimers: Record<'repository' | 'worktree', ReturnType<typeof setTimeout> | null> = {
  repository: null,
  worktree: null
}
/** Directories with changes waiting to be read again. */
const pendingDirs = new Set<string>()

/**
 * Drop what the settings say not to show.
 *
 * Hidden files are decided here rather than in the read, because the read
 * happens once and the setting can be turned off a moment later; asking git
 * about the entries it just listed is cheap and the answer is only about them.
 *
 * Both filters are subtractive and neither is ever asked to hide something the
 * other showed, so the order they run in does not matter.
 */
async function visibleChildren(
  rootPath: string,
  children: FileNode[],
  settings: { showHidden: boolean; showIgnored: boolean }
): Promise<FileNode[]> {
  let kept = settings.showHidden ? children : children.filter((c) => !c.name.startsWith('.'))
  if (!settings.showIgnored && kept.length > 0) {
    const ignored = new Set(
      await invoke('git:ignored', { rootPath, paths: kept.map((c) => c.path) })
    )
    // `check-ignore` echoes the path it was given, so the comparison is against
    // what was sent rather than against anything re-derived from it.
    kept = kept.filter((c) => !ignored.has(c.path))
  }
  return kept
}

export const createWorkspaceSlice: StateCreator<AppState, [], [], WorkspaceSlice> = (set, get) => ({
  rootPath: null,
  tree: null,
  watchId: null,
  noteIndex: [],
  fileIndex: [],
  indexTruncated: false,
  gitRepositoryRevision: 0,
  gitWorktreeRevision: 0,
  gitStatus: null,

  async openFolder(path) {
    const target = path ?? (await invoke('dialog:openFolder', undefined))
    if (!target) return

    const previousWatch = get().watchId
    if (previousWatch) void invoke('fs:unwatch', { watchId: previousWatch })

    try {
      // The top level only. Everything below it arrives when somebody opens it,
      // which is what keeps opening a folder instant however much is in it.
      const sidebar = get().settings.sidebar
      const tree = await invoke('fs:readTree', { path: target, showHidden: sidebar.showHidden })
      if (tree.children) {
        tree.children = await visibleChildren(target, tree.children, sidebar)
      }
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
      // From the moment the vault opens, not when the panel does: the icon's
      // count has to be right, and kept right, with the file tree on screen.
      void get().refreshGitStatus()
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
      const sidebar = get().settings.sidebar
      const tree = await invoke('fs:readTree', { path: root, showHidden: sidebar.showHidden })
      if (tree.children) tree.children = await visibleChildren(root, tree.children, sidebar)
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
      const sidebar = get().settings.sidebar
      const listed = await invoke('fs:readDir', { path: dirPath, showHidden: sidebar.showHidden })
      const children = await visibleChildren(get().rootPath ?? dirPath, listed, sidebar)
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
    // Any of these can change what git reports, a file's contents as much as
    // its existence.
    if (events.length > 0) get().noteGitChange('worktree')
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
  },

  noteGitChange(scope) {
    const timer = gitTimers[scope]
    if (timer) clearTimeout(timer)
    gitTimers[scope] = setTimeout(() => {
      gitTimers[scope] = null
      set((s) =>
        scope === 'repository'
          ? { gitRepositoryRevision: s.gitRepositoryRevision + 1 }
          : { gitWorktreeRevision: s.gitWorktreeRevision + 1 }
      )
      void get().refreshGitStatus()
    }, GIT_SETTLE_MS)
  },

  async refreshGitStatus() {
    const rootPath = get().rootPath
    if (!rootPath) return
    const read = ++statusReads
    let isRepo = false
    let status = EMPTY_STATUS
    try {
      isRepo = (await invoke('git:isRepository', { rootPath })) === true
      if (isRepo) status = (await invoke('git:status', { rootPath })) ?? EMPTY_STATUS
    } catch {
      // No answer is no repository, which is what the panel then says.
    }
    // Overtaken by a later read, or by another vault opening in the meantime.
    if (read !== statusReads || get().rootPath !== rootPath) return
    set({ gitStatus: { rootPath, isRepo, status } })
    // Here rather than once at open, so a repository made with `git init`
    // after the vault opened starts being watched on the next read. Main does
    // nothing when it is already watching this one.
    if (isRepo) void invoke('git:watch', { rootPath }).catch(() => undefined)
  }
})
