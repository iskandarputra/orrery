import type { StateCreator } from 'zustand'
import { basename } from '@core/paths'
import { bufferRegistry } from '@/editor/buffer-registry'
import { createDocumentState } from '@/editor/create-state'
import { getActiveView } from '@/editor/active-view'
import { invoke, parseIpcError } from '@/services/client'
import type { EditorState } from '@codemirror/state'
import type { AppState } from './store'

/** Which editor surface a buffer belongs in. */
export type DocumentKind = 'markdown' | 'canvas'

/** `.canvas` files are JSON boards, everything else is markdown text. */
export function documentKind(fileName: string): DocumentKind {
  return /\.canvas$/i.test(fileName) ? 'canvas' : 'markdown'
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
}

export interface DocumentsSlice {
  buffers: Record<string, DocumentBuffer>
  tabOrder: string[]
  activeId: string | null

  openPaths(paths: string[]): Promise<void>
  openFileDialog(): Promise<void>
  newUntitled(): void
  setActive(id: string): void
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

  async openPaths(paths) {
    for (const path of paths) {
      const existing = Object.values(get().buffers).find((b) => b.filePath === path)
      if (existing) {
        get().setActive(existing.id)
        continue
      }
      try {
        const file = await invoke('fs:readFile', { path })
        const id = crypto.randomUUID()
        const state = createDocumentState({
          id,
          content: file.content,
          settings: get().settings,
          filePath: path,
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
              kind: documentKind(path)
            }
          },
          tabOrder: [...s.tabOrder, id],
          activeId: id
        }))
        void invoke('app:addRecentFile', { path })
      } catch (err) {
        console.error('Failed to open', path, parseIpcError(err).message)
      }
    }
    rememberSession(get())
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
      activeId: id
    }))
  },

  setActive(id) {
    if (!get().buffers[id]) return
    set({ activeId: id })
    rememberSession(get())
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
    bufferRegistry.remove(id)
    set((s) => {
      const { [id]: _removed, ...rest } = s.buffers
      const tabOrder = s.tabOrder.filter((t) => t !== id)
      let activeId = s.activeId
      if (activeId === id) {
        const idx = s.tabOrder.indexOf(id)
        activeId = tabOrder[Math.min(idx, tabOrder.length - 1)] ?? null
      }
      return { buffers: rest, tabOrder, activeId }
    })
    rememberSession(get())
    return true
  },

  async closeOthers(id) {
    for (const other of [...get().tabOrder].filter((t) => t !== id)) {
      if (!(await get().closeTab(other))) return
    }
  },

  async closeToRight(id) {
    const order = get().tabOrder
    const idx = order.indexOf(id)
    if (idx === -1) return
    for (const other of order.slice(idx + 1)) {
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
      let next: string | null = null
      if (buffer.filePath === oldPath) {
        next = newPath
      } else if (buffer.filePath.startsWith(oldPath + '/')) {
        next = newPath + buffer.filePath.slice(oldPath.length)
      }
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
