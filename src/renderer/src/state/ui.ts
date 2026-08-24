import type { StateCreator } from 'zustand'
import { defaultSettings, type Settings } from '@shared/settings'
import { getTheme } from '@/themes/themes'
import { invoke } from '@/services/client'
import type { AppState } from './store'

/** Inline editing state in the file tree (create/rename inputs). */
export interface TreeEdit {
  type: 'create-file' | 'create-dir' | 'rename'
  /** Directory the new entry goes into (create-*). */
  dirPath: string
  /** Node being renamed (rename only). */
  path?: string
  initialValue?: string
}

export interface ToastMessage {
  id: string
  message: string
  type: 'info' | 'success' | 'warning' | 'error'
}

export interface UiSlice {
  /** Mirror of main-process settings; defaults until loadSettings resolves. */
  settings: Settings
  settingsLoaded: boolean
  /** Settings dialog visibility (transient, not persisted). */
  settingsOpen: boolean
  /** Right side panel: outline (TOC), backlinks, global search, AI, or stats. */
  sidePanel: 'outline' | 'backlinks' | 'search' | 'ai' | 'stats' | null
  /** Full-screen vault graph overlay. */
  graphOpen: boolean
  /** Quick switcher ('files') or command palette ('commands'). */
  paletteMode: 'files' | 'commands' | null
  /** Expanded directories in the file tree (transient, session-scoped). */
  expandedDirs: Record<string, true>
  treeEdit: TreeEdit | null
  /** Formatting toolbar visibility. */
  showFormattingToolbar: boolean
  /** Active toast notification. */
  toast: ToastMessage | null
  /** File tree live search filter query. */
  fileTreeFilter: string
  /** File tree sort mode. */
  fileTreeSort: 'name' | 'modified'
  /** Zen / Focus distraction-free full mode. */
  zenMode: boolean
  /** Document statistics drawer/modal. */
  docStatsOpen: boolean

  loadSettings(): Promise<void>
  /** Optimistic local update, persisted through main. */
  updateSettings(patch: Partial<Settings>): void
  openSettings(): void
  closeSettings(): void
  toggleSidePanel(panel: 'outline' | 'backlinks' | 'search' | 'ai' | 'stats'): void
  toggleGraph(): void
  openPalette(mode: 'files' | 'commands'): void
  closePalette(): void
  setTreeEdit(edit: TreeEdit | null): void
  toggleSidebar(): void
  setSidebarWidth(width: number): void
  setRightPanelWidth(width: number): void
  setThemeMode(mode: Settings['theme']): void
  /** Pick a palette: applies immediately and remembers it for its appearance. */
  selectTheme(themeId: string): void
  toggleDir(path: string): void
  collapseAllDirs(): void
  toggleFormattingToolbar(): void
  showToast(message: string, type?: 'info' | 'success' | 'warning' | 'error', duration?: number): void
  clearToast(): void
  setFileTreeFilter(filter: string): void
  setFileTreeSort(sort: 'name' | 'modified'): void
  toggleZenMode(): void
  setDocStatsOpen(open: boolean): void
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const createUiSlice: StateCreator<AppState, [], [], UiSlice> = (set, get) => ({
  settings: defaultSettings,
  settingsLoaded: false,
  settingsOpen: false,
  sidePanel: null,
  graphOpen: false,
  paletteMode: null,
  expandedDirs: {},
  treeEdit: null,
  showFormattingToolbar: false,
  toast: null,
  fileTreeFilter: '',
  fileTreeSort: 'name',
  zenMode: false,
  docStatsOpen: false,

  async loadSettings() {
    const settings = await invoke('settings:get', undefined)
    set({ settings, settingsLoaded: true })
  },

  updateSettings(patch) {
    set({ settings: { ...get().settings, ...patch } })
    void invoke('settings:set', patch).then((confirmed) => set({ settings: confirmed }))
  },

  openSettings() {
    set({ settingsOpen: true })
  },

  closeSettings() {
    set({ settingsOpen: false })
  },

  toggleSidePanel(panel) {
    set((s) => ({ sidePanel: s.sidePanel === panel ? null : panel }))
  },

  toggleGraph() {
    set((s) => ({ graphOpen: !s.graphOpen }))
  },

  openPalette(mode) {
    set({ paletteMode: mode })
  },

  closePalette() {
    set({ paletteMode: null })
  },

  setTreeEdit(edit) {
    // Creating inside a collapsed folder should reveal the input.
    if (edit && edit.type !== 'rename' && edit.dirPath) {
      set((s) => ({ treeEdit: edit, expandedDirs: { ...s.expandedDirs, [edit.dirPath]: true } }))
    } else {
      set({ treeEdit: edit })
    }
  },

  toggleSidebar() {
    const { sidebar } = get().settings
    get().updateSettings({ sidebar: { ...sidebar, visible: !sidebar.visible } })
  },

  setSidebarWidth(width) {
    const { sidebar } = get().settings
    get().updateSettings({ sidebar: { ...sidebar, width } })
  },

  setRightPanelWidth(width) {
    const { rightPanel } = get().settings
    get().updateSettings({ rightPanel: { ...rightPanel, width } })
  },

  setThemeMode(mode) {
    get().updateSettings({ theme: mode })
  },

  selectTheme(themeId) {
    const spec = getTheme(themeId)
    if (spec.appearance === 'dark') {
      get().updateSettings({ darkTheme: spec.id, theme: 'dark' })
    } else {
      get().updateSettings({ lightTheme: spec.id, theme: 'light' })
    }
  },

  toggleDir(path) {
    set((s) => {
      const next = { ...s.expandedDirs }
      if (next[path]) delete next[path]
      else next[path] = true
      return { expandedDirs: next }
    })
  },

  collapseAllDirs() {
    set({ expandedDirs: {} })
  },

  toggleFormattingToolbar() {
    set((s) => ({ showFormattingToolbar: !s.showFormattingToolbar }))
  },

  showToast(message, type = 'info', duration = 3000) {
    if (toastTimer) clearTimeout(toastTimer)
    const id = String(Date.now())
    set({ toast: { id, message, type } })
    toastTimer = setTimeout(() => {
      set((s) => (s.toast?.id === id ? { toast: null } : {}))
    }, duration)
  },

  clearToast() {
    if (toastTimer) clearTimeout(toastTimer)
    set({ toast: null })
  },

  setFileTreeFilter(filter) {
    set({ fileTreeFilter: filter })
  },

  setFileTreeSort(sort) {
    set({ fileTreeSort: sort })
  },

  toggleZenMode() {
    set((s) => ({ zenMode: !s.zenMode }))
  },

  setDocStatsOpen(open) {
    set({ docStatsOpen: open })
  }
})
