import type { StateCreator } from 'zustand'
import { basename, retargetPath } from '@core/paths'
import { bufferRegistry } from '@/editor/buffer-registry'
import { surfaceForKind } from '@/plugins/registry'
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
  /**
   * Which untitled note this is: 1 is "Untitled", 2 is "Untitled 2".
   *
   * Only set while the note has no file. It is what names the tab and what a
   * kept note is restored under, and it lives on the buffer rather than in a
   * map beside it so that it goes when the buffer does.
   */
  untitledNumber?: number
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
  /** Reopen the unsaved notes a previous run left behind. */
  restoreUntitled(): Promise<void>
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

/** "Untitled", then "Untitled 2". The first one does not need a number. */
function untitledName(n: number): string {
  return n === 1 ? 'Untitled' : `Untitled ${n}`
}

/** Every note currently open that has never been given a file. */
function untitledBuffers(state: AppState): DocumentBuffer[] {
  return state.tabOrder
    .map((id) => state.buffers[id])
    .filter((b): b is DocumentBuffer => !!b && !b.filePath && b.untitledNumber !== undefined)
}

/**
 * The number the next new note gets: one past the highest already open.
 *
 * Counted from what is there rather than from a running total, so it survives
 * notes being restored at start-up — a counter beginning at nought would hand
 * the next note a name a restored one is already using.
 */
function nextUntitledNumber(state: AppState): number {
  return (
    untitledBuffers(state).reduce((highest, b) => Math.max(highest, b.untitledNumber ?? 0), 0) + 1
  )
}

const draftTimers = new Map<string, ReturnType<typeof setTimeout>>()

function cancelDraft(id: string): void {
  const timer = draftTimers.get(id)
  if (timer) clearTimeout(timer)
  draftTimers.delete(id)
}

/**
 * Keep an unsaved note where a restart can find it.
 *
 * Debounced, because this runs on every keystroke and a note is written whole
 * each time. Nothing is asked of the user: the note comes back with the app,
 * and the question is asked when the note itself is closed.
 */
function rememberDraft(state: AppState, id: string): void {
  const buffer = state.buffers[id]
  const n = buffer?.untitledNumber
  if (!buffer || buffer.filePath || n === undefined) return
  cancelDraft(id)
  draftTimers.set(
    id,
    setTimeout(() => {
      draftTimers.delete(id)
      void writeDraft(state, id, n)
    }, 500)
  )
}

/** The same, now rather than in half a second — for quitting. */
async function writeDraft(state: AppState, id: string, n: number): Promise<void> {
  const editor = getBufferEditorState(id, state.activeId)
  if (!editor) return
  try {
    await invoke('drafts:put', { id, n, content: editor.doc.toString() })
  } catch {
    // A note that could not be kept is one that will ask on quit, as it always
    // did. Never a reason to stop the thing that was being done.
  }
}

/** It has a file now, or somebody threw it away: stop keeping it. */
function forgetDraft(state: AppState, id: string): void {
  cancelDraft(id)
  if (state.buffers[id]?.untitledNumber === undefined) return
  void invoke('drafts:forget', { id }).catch(() => undefined)
}

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
    const n = nextUntitledNumber(get())
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
          fileName: untitledName(n),
          savedMtimeMs: null,
          isDirty: false,
          kind: 'markdown' as const,
          untitledNumber: n
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

  async restoreUntitled() {
    let drafts: { id: string; n: number; content: string }[]
    try {
      drafts = await invoke('drafts:list', undefined)
    } catch {
      return
    }
    if (drafts.length === 0) return

    for (const draft of drafts) {
      // Its own id, not a fresh one: the note keeps the file it is kept in, so
      // typing into it after a restart replaces what is there rather than
      // leaving the old copy behind to be restored a second time.
      const { id, n, content } = draft
      if (get().buffers[id]) continue
      const state = createDocumentState({
        id,
        content,
        settings: get().settings,
        onDirtyChange: (dirty) => get().setDirty(id, dirty)
      })
      // No saved document to compare against, which is what an unsaved note is:
      // it comes back with its dot, because it still has nowhere to be.
      bufferRegistry.create(id, state, null)
      set((s) => ({
        buffers: {
          ...s.buffers,
          [id]: {
            id,
            filePath: null,
            fileName: untitledName(n),
            savedMtimeMs: null,
            isDirty: content.length > 0,
            kind: 'markdown' as const,
            // Kept, so the next new note is named past this one rather than
            // over it.
            untitledNumber: n
          }
        },
        tabOrder: [...s.tabOrder, id]
      }))
    }

    // Focused only if there was nothing else to look at. Coming back to a vault
    // and being put in front of a note you left half-written is worse than
    // finding it waiting in the tab bar.
    const state = get()
    if (!state.activeId) {
      const first = drafts[0]
      if (first && state.buffers[first.id]) state.setActive(first.id)
    }
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

    // A note with no file cannot be autosaved anywhere, so it is kept instead.
    if (!buffer.filePath) rememberDraft(get(), id)

    if (buffer.isDirty === dirty) return
    set((s) => ({ buffers: { ...s.buffers, [id]: { ...buffer, isDirty: dirty } } }))
  },

  async save(id, opts) {
    const buffer = get().buffers[id]
    if (!buffer) return false

    // A surface whose file is not text saves itself. Falling through would
    // write this buffer's document over it, and for a binary surface that
    // document is empty — a saved PDF would become a nought-byte file.
    const surface = buffer.kind ? surfaceForKind(buffer.kind) : null
    if (surface?.save) return surface.save(id)

    const state = getBufferEditorState(id, get().activeId)
    if (!state) return false

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
      // It has a file now, so it is no longer a note being kept for want of one.
      forgetDraft(get(), id)
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
            isDirty: false,
            // It has a name of its own now, so it is not an untitled note and
            // must not be counted as one when the next is named.
            untitledNumber: undefined
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
    // Closing a note is still a decision about it — the prompt above asked, and
    // this is the answer being carried out. Quitting is the case that no longer
    // asks, and quitting does not come through here.
    forgetDraft(get(), id)
    // A surface that holds unsaved work of its own is told the tab has gone, so
    // "close without saving" actually throws it away. After the prompt above:
    // whatever the answer was, it has been given.
    if (buffer.kind) surfaceForKind(buffer.kind)?.close?.(id)
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
    // Every unsaved note goes to where a restart will find it, now rather than
    // on the timer it was scheduled on — the process is about to end.
    await Promise.all(
      untitledBuffers(get()).map((buffer) => {
        cancelDraft(buffer.id)
        return writeDraft(get(), buffer.id, buffer.untitledNumber!)
      })
    )
    // And they are not asked about. A note with no file has nothing on disk to
    // overwrite and nothing to lose by waiting; a note that has one is a
    // different question, and still worth asking.
    const dirty = Object.values(get().buffers).filter((b) => b.isDirty && b.filePath)
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
