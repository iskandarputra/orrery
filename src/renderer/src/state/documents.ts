import type { StateCreator } from 'zustand'
import { basename, retargetPath } from '@core/paths'
import { bufferRegistry } from '@/editor/buffer-registry'
import { createDocumentState } from '@/editor/create-state'
import { getActiveView, viewForBuffer } from '@/editor/active-view'
import { invalidateEmbed } from '@/editor/live-preview/embeds'
import { refreshGitGutter } from '@/editor/git-gutter'
import { invoke, parseIpcError } from '@/services/client'
import { EditorState } from '@codemirror/state'
import type { AppState } from './app-state'
import { documentKind, type DocumentKind } from '@core/document-kind'
import * as tabs from '@core/tab-layout'
import { equalSizes, fitSizes } from '@core/pane-sizes'
import { captureWorkspace, pathsToOpen, restoreLayout, restoreSizes } from '@core/workspaces'
import { surfaceForFile } from '@/plugins/registry'
import { closeDocument } from '@/editor/lsp-session'

export type { DocumentKind }

/**
 * What kind of document a path is.
 *
 * A plugin-registered surface is asked first: claiming an extension that would
 * otherwise be read as code is the whole reason to register one.
 */
function kindOf(path: string): DocumentKind {
  return surfaceForFile(path)?.id ?? documentKind(path)
}

export interface DocumentBuffer {
  /** Stable tab identity — NOT the path (untitled docs have no path). */
  id: string
  filePath: string | null
  fileName: string
  /** mtime the renderer last saw; guards against clobbering external edits. */
  savedMtimeMs: number | null
  isDirty: boolean
  kind: DocumentKind
  /** What this tab is a diff of (kind 'diff' only). */
  diff?: { path: string; staged: boolean; commit?: string }
}

export interface DocumentsSlice {
  /** Open a file's diff as a tab, focusing an existing one if it is already open. */
  openDiff(path: string, staged: boolean, commit?: string): void

  buffers: Record<string, DocumentBuffer>
  tabOrder: string[]
  /** Buffer in the focused pane — a mirror of `paneIds[focusedPane]`. */
  activeId: string | null
  /** One entry per pane, left to right; always at least one. Null is an empty pane. */
  paneIds: (string | null)[]
  focusedPane: number
  /**
   * How wide each pane is, as fractions of the editor adding up to 1.
   *
   * Fractions rather than pixels so that resizing the window, opening the
   * sidebar or closing a pane changes the space without changing the
   * proportions somebody chose.
   */
  paneSizes: number[]

  openPaths(paths: string[]): Promise<void>
  openFileDialog(): Promise<void>
  newUntitled(): void
  setActive(id: string): void
  /** Open a second pane beside the first, or close it. */
  toggleSplit(): void
  /** Move focus between panes. Notes stay where they are; only focus moves. */
  focusPane(pane: number): void
  focusNextPane(): void
  /** A new pane beside the focused one, showing `id` or the first free tab. */
  splitRight(id?: string): void
  /** Open one file in a pane of its own, to the right of the focused one. */
  openToSide(path: string): Promise<void>
  /** Set the column widths, as fractions. */
  setPaneSizes(sizes: number[]): void
  /** Close one pane, leaving its tab open. */
  closePane(index: number): void

  /** Save the tabs, panes and side panel under a name. */
  saveWorkspace(name: string): void
  /** Reopen a saved workspace, dropping whatever no longer exists. */
  applyWorkspace(name: string): Promise<void>
  deleteWorkspace(name: string): void
  setDirty(id: string, dirty: boolean): void
  /** Returns true if the document ended up saved. */
  save(id: string, opts?: { forceSaveAs?: boolean }): Promise<boolean>
  /** Returns true if the tab was closed. */
  closeTab(id: string): Promise<boolean>
  /** Close every tab except `id`. Stops at the first cancelled dirty prompt. */
  closeOthers(id: string): Promise<void>
  /** Close tabs after `id` in tab order. */
  closeToRight(id: string): Promise<void>
  closeAllTabs(): Promise<void>
  /** Repoint open buffers after a file or ancestor folder rename. */
  updatePathsAfterRename(oldPath: string, newPath: string): void
  /** Reload a clean buffer whose file changed on disk. */
  reloadFromDisk(path: string): Promise<void>
  /** Full unsaved-changes flow after main intercepts window close. */
  handleWindowCloseRequest(): Promise<void>
}

let untitledCounter = 0

/** Debounced autosave timers, keyed by buffer id (Settings → General). */
const autosaveTimers = new Map<string, ReturnType<typeof setTimeout>>()

function cancelAutosave(id: string): void {
  const timer = autosaveTimers.get(id)
  if (timer) clearTimeout(timer)
  autosaveTimers.delete(id)
}

/** Current EditorState of a buffer — live view for the active tab, registry otherwise. */
function getBufferEditorState(id: string, activeId: string | null): EditorState | null {
  // A visible pane's own view is the truth; the registry's copy lags by up to
  // a second, which is exactly the typing a save would drop.
  const pane = viewForBuffer(id)
  if (pane) return pane.state
  if (id === activeId) {
    const view = getActiveView()
    if (view) return view.state
  }
  return bufferRegistry.get(id)?.state ?? null
}

let sessionTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Remember which notes are open so a restart doesn't cost the working set.
 * Debounced and settings-backed: tab churn shouldn't mean a write per click,
 * and untitled buffers have no path to remember.
 */
function rememberSession(state: AppState): void {
  if (sessionTimer) clearTimeout(sessionTimer)
  sessionTimer = setTimeout(() => {
    sessionTimer = null
    const openPaths = state.tabOrder
      .map((id) => state.buffers[id]?.filePath)
      .filter((path): path is string => !!path)
    const activePath = (state.activeId && state.buffers[state.activeId]?.filePath) || ''
    state.updateSettings({ session: { openPaths, activePath } })
  }, 400)
}

export const createDocumentsSlice: StateCreator<AppState, [], [], DocumentsSlice> = (set, get) => ({
  buffers: {},
  tabOrder: [],
  activeId: null,
  paneIds: [null],
  focusedPane: 0,
  paneSizes: [1],

  async openPaths(paths) {
    for (const path of paths) {
      const existing = Object.values(get().buffers).find((b) => b.filePath === path)
      if (existing) {
        get().setActive(existing.id)
        continue
      }
      try {
        // A binary surface reads its own file, by path: slurping a database
        // into a text document would decode megabytes of B-tree as UTF-8 and
        // hold it for nothing.
        const surface = surfaceForFile(basename(path))
        const file = surface?.binary
          ? { path, content: '', mtimeMs: Date.now() }
          : await invoke('fs:readFile', { path })
        const id = crypto.randomUUID()
        const state = createDocumentState({
          id,
          content: file.content,
          settings: get().settings,
          filePath: path,
          kind: kindOf(path),
          onDirtyChange: (dirty) => get().setDirty(id, dirty)
        })
        bufferRegistry.create(id, state, state.doc)
        set((s) => ({
          buffers: {
            ...s.buffers,
            [id]: {
              id,
              filePath: path,
              fileName: basename(path),
              savedMtimeMs: file.mtimeMs,
              isDirty: false,
              kind: kindOf(path)
            }
          },
          tabOrder: [...s.tabOrder, id],
          activeId: id,
          paneIds: s.paneIds.map((pane, i) => (i === s.focusedPane ? id : pane))
        }))
        void invoke('app:addRecentFile', { path })
      } catch (err) {
        console.error('Failed to open', path, parseIpcError(err).message)
      }
    }
    rememberSession(get())
  },

  /**
   * Open a diff as a tab.
   *
   * A tab rather than a dialog, because that is what a diff is: something you
   * look at beside your work, switch away from and come back to. Reopening the
   * same file's diff focuses the existing tab instead of stacking duplicates.
   */
  openDiff(path, staged, commit) {
    const existing = Object.values(get().buffers).find(
      (b) =>
        b.kind === 'diff' &&
        b.diff?.path === path &&
        b.diff?.staged === staged &&
        b.diff?.commit === commit
    )
    if (existing) {
      get().setActive(existing.id)
      return
    }
    const id = crypto.randomUUID()
    // A diff has no text of its own; the empty state exists only so the pane
    // machinery, which assumes every buffer has one, keeps working.
    bufferRegistry.create(id, EditorState.create({ doc: '' }), null)
    set((s) => ({
      buffers: {
        ...s.buffers,
        [id]: {
          id,
          filePath: null,
          fileName: commit
            ? `${basename(path)} @ ${commit.slice(0, 7)}`
            : `${basename(path)} (diff)`,
          savedMtimeMs: null,
          isDirty: false,
          kind: 'diff' as const,
          diff: { path, staged, commit }
        }
      },
      tabOrder: [...s.tabOrder, id],
      activeId: id,
      paneIds: s.paneIds.map((pane, i) => (i === s.focusedPane ? id : pane))
    }))
  },

  async openFileDialog() {
    const paths = await invoke('dialog:openFile', undefined)
    if (paths && paths.length > 0) await get().openPaths(paths)
  },

  newUntitled() {
    const id = crypto.randomUUID()
    untitledCounter += 1
    const state = createDocumentState({
      id,
      content: '',
      settings: get().settings,
      onDirtyChange: (dirty) => get().setDirty(id, dirty)
    })
    bufferRegistry.create(id, state, null)
    set((s) => ({
      buffers: {
        ...s.buffers,
        [id]: {
          id,
          filePath: null,
          fileName: untitledCounter === 1 ? 'Untitled' : `Untitled ${untitledCounter}`,
          savedMtimeMs: null,
          isDirty: false,
          kind: 'markdown' as const
        }
      },
      tabOrder: [...s.tabOrder, id],
      activeId: id,
      // `activeId` mirrors `paneIds[focusedPane]`; setting it alone left the
      // tab bar showing the new note while the pane still held the old one, so
      // the pane never swapped buffers and never took focus — the new note
      // looked open but could not be typed into.
      paneIds: s.paneIds.map((pane, i) => (i === s.focusedPane ? id : pane))
    }))
  },

  setActive(id) {
    if (!get().buffers[id]) return
    set((s) => tabs.activate(s, id))
    rememberSession(get())
  },

  toggleSplit() {
    set((s) => tabs.toggleSplit(s))
    set((s) => ({ paneSizes: equalSizes(s.paneIds.length) }))
  },

  focusPane(pane) {
    set((s) => tabs.focusPane(s, pane))
  },

  focusNextPane() {
    set((s) => tabs.focusNextPane(s))
  },

  splitRight(id) {
    set((s) => tabs.splitRight(s, id))
    set((s) => ({ paneSizes: fitSizes(s.paneSizes, s.paneIds.length) }))
    rememberSession(get())
  },

  /**
   * Open a file beside what is being read, rather than over it.
   *
   * Opening normally puts the file in the focused pane, so this notes what was
   * there, opens, then gives that pane its file back and puts the new one in a
   * pane of its own to the right. At the pane limit it goes to the last pane
   * instead: still not the one you were reading in.
   */
  async openToSide(path) {
    const before = get()
    const previous = before.paneIds[before.focusedPane] ?? null
    const home = before.focusedPane

    await get().openPaths([path])
    const opened = get().activeId
    if (!opened) return

    const now = get()
    // Already on screen: opening it moved focus to the pane it was in, and
    // there is nothing to move.
    if (now.focusedPane !== home || previous === opened) return
    // An empty pane is already a pane of its own.
    if (previous === null) return

    if (now.paneIds.length >= tabs.MAX_PANES) {
      const last = now.paneIds.length - 1
      if (last === home) return
      set((s) => {
        const paneIds = [...s.paneIds]
        paneIds[home] = previous
        paneIds[last] = opened
        return tabs.settle({ ...s, paneIds, focusedPane: last, activeId: opened })
      })
    } else {
      set((s) => {
        const paneIds = [...s.paneIds]
        paneIds[home] = previous
        paneIds.splice(home + 1, 0, opened)
        return tabs.settle({ ...s, paneIds, focusedPane: home + 1, activeId: opened })
      })
    }

    set((s) => ({ paneSizes: fitSizes(s.paneSizes, s.paneIds.length) }))
    rememberSession(get())
  },

  setPaneSizes(sizes) {
    set((s) => ({ paneSizes: fitSizes(sizes, s.paneIds.length) }))
  },

  closePane(index) {
    set((s) => tabs.closePane(s, index))
    set((s) => ({ paneSizes: fitSizes(s.paneSizes, s.paneIds.length) }))
    rememberSession(get())
  },

  saveWorkspace(name) {
    const trimmed = name.trim()
    if (!trimmed) return
    const state = get()
    const pathOf = (id: string | null): string | null => (id && state.buffers[id]?.filePath) || null

    const workspace = {
      ...captureWorkspace({
        openPaths: state.tabOrder.map((id) => pathOf(id) ?? ''),
        panePaths: state.paneIds.map(pathOf),
        activePath: pathOf(state.activeId),
        focusedPane: state.focusedPane,
        sidePanel: state.sidePanel,
        paneSizes: state.paneSizes
      }),
      // Narrower than what `core` hands back: on disk a panel name is one of a
      // known set, and that is the schema's business rather than the layout's.
      sidePanel: state.sidePanel
    }
    state.updateSettings({ workspaces: { ...state.settings.workspaces, [trimmed]: workspace } })
  },

  async applyWorkspace(name) {
    const workspace = get().settings.workspaces[name]
    if (!workspace) return

    // Open first, arrange second. Opening decides which paths still exist, and
    // the layout can only be rebuilt once their buffers have ids.
    await get().openPaths(pathsToOpen(workspace))

    const buffers = get().buffers
    const idFor = (path: string): string | null =>
      Object.keys(buffers).find((id) => buffers[id]?.filePath === path) ?? null

    const layout = restoreLayout(workspace, idFor)
    set({ ...layout, paneSizes: restoreSizes(workspace, layout.paneIds.length) })
    get().setSidePanel(workspace.sidePanel)
    rememberSession(get())
  },

  deleteWorkspace(name) {
    const { [name]: removed, ...rest } = get().settings.workspaces
    if (!removed) return
    get().updateSettings({ workspaces: rest })
  },

  setDirty(id, dirty) {
    const buffer = get().buffers[id]
    if (!buffer) return

    // Autosave debounces from the *latest* change, so reschedule on every call.
    const { general } = get().settings
    if (dirty && general.autosave && buffer.filePath) {
      cancelAutosave(id)
      autosaveTimers.set(
        id,
        setTimeout(() => {
          autosaveTimers.delete(id)
          if (get().buffers[id]?.isDirty) void get().save(id)
        }, general.autosaveDelay)
      )
    } else if (!dirty) {
      cancelAutosave(id)
    }

    if (buffer.isDirty === dirty) return
    set((s) => ({ buffers: { ...s.buffers, [id]: { ...buffer, isDirty: dirty } } }))
  },

  async save(id, opts) {
    const buffer = get().buffers[id]
    const state = getBufferEditorState(id, get().activeId)
    if (!buffer || !state) return false

    let targetPath = buffer.filePath
    let expectedMtimeMs: number | null = buffer.savedMtimeMs
    if (!targetPath || opts?.forceSaveAs) {
      targetPath = await invoke('dialog:saveAs', {
        suggestedName: buffer.filePath ? buffer.fileName : `${buffer.fileName}.md`,
        defaultDir: get().rootPath ?? undefined
      })
      if (!targetPath) return false
      expectedMtimeMs = null
    }

    const content = state.doc.toString()
    try {
      const result = await invoke('fs:writeFile', { path: targetPath, content, expectedMtimeMs })
      bufferRegistry.markSaved(id, state.doc)
      // Any embed showing this note is now stale.
      invalidateEmbed(targetPath)
      set((s) => ({
        buffers: {
          ...s.buffers,
          [id]: {
            ...buffer,
            filePath: targetPath,
            fileName: basename(targetPath),
            savedMtimeMs: result.mtimeMs,
            isDirty: false
          }
        }
      }))
      void invoke('app:addRecentFile', { path: targetPath })
      return true
    } catch (err) {
      const parsed = parseIpcError(err)
      if (parsed.code === 'CONFLICT') {
        const overwrite = window.confirm(
          `"${buffer.fileName}" changed on disk since you opened it.\nOverwrite the file on disk?`
        )
        if (overwrite) {
          const result = await invoke('fs:writeFile', {
            path: targetPath,
            content,
            expectedMtimeMs: null
          })
          bufferRegistry.markSaved(id, state.doc)
          set((s) => ({
            buffers: {
              ...s.buffers,
              [id]: { ...buffer, savedMtimeMs: result.mtimeMs, isDirty: false }
            }
          }))
          return true
        }
        return false
      }
      window.alert(`Could not save "${buffer.fileName}": ${parsed.message}`)
      return false
    }
  },

  async closeTab(id) {
    const buffer = get().buffers[id]
    if (!buffer) return true
    if (buffer.isDirty) {
      const choice = await invoke('dialog:confirmClose', { fileNames: [buffer.fileName] })
      if (choice === 'cancel') return false
      if (choice === 'save') {
        const saved = await get().save(id)
        if (!saved) return false
      }
    }
    cancelAutosave(id)
    // Let the language server drop the file too; a server that is never told
    // keeps analysing documents nobody has open.
    if (buffer.filePath) closeDocument(id, buffer.filePath)
    bufferRegistry.remove(id)
    set((s) => {
      const { [id]: _removed, ...rest } = s.buffers
      // The layout helper is handed the whole state as its layout, so what
      // comes back is a copy of every field in it — `buffers` included, still
      // holding the tab being closed. The removal has to be applied over the
      // top of it, or the buffer comes straight back: the tab disappears, the
      // buffer does not, and clicking that file again finds the leftover and
      // activates a tab that is no longer there, which looks like nothing
      // happening at all.
      return { ...tabs.closeTab(s, id), buffers: rest }
    })
    rememberSession(get())
    return true
  },

  async closeOthers(id) {
    for (const other of tabs.otherTabs(get(), id)) {
      if (!(await get().closeTab(other))) return
    }
  },

  async closeToRight(id) {
    for (const other of tabs.tabsToRight(get(), id)) {
      if (!(await get().closeTab(other))) return
    }
  },

  async closeAllTabs() {
    for (const id of [...get().tabOrder]) {
      if (!(await get().closeTab(id))) return
    }
  },

  updatePathsAfterRename(oldPath, newPath) {
    const buffers = { ...get().buffers }
    let changed = false
    for (const buffer of Object.values(buffers)) {
      if (!buffer.filePath) continue
      const next = retargetPath(buffer.filePath, oldPath, newPath)
      if (next) {
        buffers[buffer.id] = { ...buffer, filePath: next, fileName: basename(next) }
        changed = true
      }
    }
    if (changed) set({ buffers })
  },

  async reloadFromDisk(path) {
    const buffer = Object.values(get().buffers).find((b) => b.filePath === path)
    if (!buffer || buffer.isDirty) return
    try {
      const file = await invoke('fs:readFile', { path })
      const current = getBufferEditorState(buffer.id, get().activeId)
      if (!current || current.doc.toString() === file.content) {
        set((s) => ({
          buffers: {
            ...s.buffers,
            [buffer.id]: { ...buffer, savedMtimeMs: file.mtimeMs }
          }
        }))
        return
      }
      const view = buffer.id === get().activeId ? getActiveView() : null
      if (view) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: file.content } })
        bufferRegistry.markSaved(buffer.id, view.state.doc)
        // The reload replaces the whole document, so every change bar is anchored
        // inside the replaced range and is mapped away. Nothing else re-runs the
        // gutter for a buffer that neither changed identity nor dirty state, so
        // without this the bars stay wrong until the tab is switched away and back.
        void refreshGitGutter(view)
      } else {
        const state = createDocumentState({
          id: buffer.id,
          content: file.content,
          settings: get().settings,
          filePath: buffer.filePath,
          onDirtyChange: (dirty) => get().setDirty(buffer.id, dirty)
        })
        bufferRegistry.create(buffer.id, state, state.doc)
      }
      set((s) => ({
        buffers: {
          ...s.buffers,
          [buffer.id]: { ...buffer, savedMtimeMs: file.mtimeMs, isDirty: false }
        }
      }))
    } catch {
      // File may have been removed between the event and the read; tree refresh handles it.
    }
  },

  async handleWindowCloseRequest() {
    const dirty = Object.values(get().buffers).filter((b) => b.isDirty)
    if (dirty.length === 0) {
      await invoke('window:readyToClose', undefined)
      return
    }
    const choice = await invoke('dialog:confirmClose', {
      fileNames: dirty.map((b) => b.fileName)
    })
    if (choice === 'cancel') return
    if (choice === 'save') {
      for (const buffer of dirty) {
        const saved = await get().save(buffer.id)
        if (!saved) return // user cancelled a Save As — abort closing
      }
    }
    await invoke('window:readyToClose', undefined)
  }
})
