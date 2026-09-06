import type { StateCreator } from 'zustand'
import { defaultSettings, type Settings } from '@shared/settings'
import { remember, withdraw, type HtmlGrant } from '@core/html-trust'
import { getTheme } from '@/themes/themes'
import { invoke } from '@/services/client'
import type { AppState } from './app-state'

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

/** What the palette is listing. */
/**
 * `line` and `symbol` are the same box seeded with a prefix, not separate
 * pickers — Goto Anything is one input where what you type decides what is
 * searched, and having a command open it primed is only a shortcut to typing
 * the prefix yourself.
 */
export type PaletteMode =
  | 'files'
  | 'commands'
  | 'templates'
  | 'line'
  | 'symbol'
  | 'workspaces'
  | 'workspacesDelete'
  | 'recent'

/** Tabs of the right side panel. */
export type SidePanel =
  | 'outline'
  | 'backlinks'
  | 'outgoing'
  | 'bookmarks'
  | 'search'
  | 'ai'
  | 'stats'
  | 'analysis'
  | 'tags'
  | 'mcp'

/** One run of code sharing a colour, as already worked out by the renderer. */
export interface CodeSpan {
  text: string
  cls: string
}

/** A block opened full screen in the media viewer. */
export interface MediaViewerTarget {
  kind: 'image' | 'mermaid' | 'math' | 'code'
  /** Resolved image URL (kind 'image'). */
  src?: string
  /** Diagram, equation or code source (every kind but 'image'). */
  code?: string
  /** Language label (kind 'code'). */
  lang?: string
  /**
   * Pre-coloured runs (kind 'code'). Carried rather than recomputed: the
   * colours come from the editor's syntax tree, which the modal has no access
   * to, and re-parsing to get them back would mean loading a second parser.
   */
  spans?: CodeSpan[]
  /** Alt text, used as the dialog's accessible name when there is one. */
  alt?: string
}

/** What the media viewer calls each kind, in labels and announcements. */
export const MEDIA_NOUN: Record<MediaViewerTarget['kind'], string> = {
  image: 'image',
  mermaid: 'diagram',
  math: 'equation',
  code: 'code block'
}

export interface UiSlice {
  /** Mirror of main-process settings; defaults until loadSettings resolves. */
  settings: Settings
  settingsLoaded: boolean
  /** Settings dialog visibility (transient, not persisted). */
  settingsOpen: boolean
  /** Right side panel: outline (TOC), backlinks, search, AI, stats or analysis. */
  sidePanel: SidePanel | null
  /** Full-screen vault graph overlay. */
  graphOpen: boolean
  /** Full-screen vault analytics overlay. */
  analyticsOpen: boolean
  /** Version history dialog for the open note. */
  historyOpen: boolean
  /** Quick switcher, command palette, or the template picker. */
  paletteMode: PaletteMode | null
  /** Expanded directories in the file tree (transient, session-scoped). */
  expandedDirs: Record<string, true>
  /**
   * A PDF somebody asked to see a particular page of.
   *
   * A search hit and a `[[paper.pdf#page=12]]` link both mean "open this there",
   * and the reader is a component that may not exist yet when the request is
   * made. The token makes asking for the same page twice a new request rather
   * than a no-op.
   */
  pdfTarget: { path: string; page: number; token: number } | null
  treeEdit: TreeEdit | null
  /** Formatting toolbar visibility. */
  showFormattingToolbar: boolean
  /** Active toast notification. */
  toast: ToastMessage | null
  /** File tree live search filter query. */
  fileTreeFilter: string
  /**
   * Query to run when the search panel opens (right-click → search). The token
   * makes each request distinct, so the panel can tell a new one from a repeat
   * without the store having to be cleared afterwards.
   */
  searchSeed: { query: string; token: number }
  /** File tree sort mode. */
  fileTreeSort: 'name' | 'modified'
  /** Zen / Focus distraction-free full mode. */
  zenMode: boolean
  /** Document statistics drawer/modal. */
  docStatsOpen: boolean
  /**
   * HTML files currently being read rather than edited, which of them may fetch
   * their remote pictures, and which of them are running their own code.
   *
   * Per buffer rather than a setting, unlike the markdown view mode. Reading
   * one page is not a statement about how every other file should open, and
   * with the editor split in two, "read this one" has to be able to mean the
   * pane it was asked in. The two consents are per buffer for a stronger
   * reason: they are about one document, and the next file opened has not
   * earned either of them.
   *
   * Which is a different question from how long a consent lasts. These three
   * are the live state of a tab; `settings.htmlTrust` is what a page was
   * allowed last time, keyed by file and by a digest of it, and is what fills
   * the two consents back in when the same document is opened again. See
   * `core/html-trust`.
   */
  htmlReading: Record<string, true>
  htmlRemote: Record<string, true>
  htmlScripts: Record<string, true>
  /** Integrated terminal panel, along the bottom of the workspace. */
  terminalOpen: boolean
  /**
   * The block currently open in the full-screen media viewer.
   *
   * It lives here rather than in the editor because the viewer is a React
   * modal mounted beside the other dialogs, while the control that opens it is
   * a CodeMirror widget — the store is the seam between the two.
   */
  mediaViewer: MediaViewerTarget | null

  loadSettings(): Promise<void>
  /** Optimistic local update, persisted through main. */
  updateSettings(patch: Partial<Settings>): void
  /** Pin a file, or unpin it if it is already pinned. */
  toggleBookmark(path: string): void
  openSettings(): void
  closeSettings(): void
  toggleSidePanel(panel: SidePanel): void
  /** Show a panel (or none) and remember the choice across restarts. */
  setSidePanel(panel: SidePanel | null): void
  /** Open the search panel already looking for `query`. */
  searchVaultFor(query: string): void
  toggleGraph(): void
  toggleAnalytics(): void
  toggleHistory(): void
  openPalette(mode: PaletteMode): void
  closePalette(): void
  setTreeEdit(edit: TreeEdit | null): void
  toggleSidebar(): void
  /**
   * Show a sidebar view, or hide the sidebar if it is already showing it.
   *
   * Both rail icons go through this. The folder icon used to call
   * `toggleSidebar` directly, which was right while the sidebar had one view
   * and wrong the moment it had two: asking for the file tree while source
   * control was showing hid the sidebar instead of switching to it.
   */
  showSidebarView(view: Settings['sidebar']['view']): void
  setSidebarWidth(width: number): void
  setRightPanelWidth(width: number): void
  /** The left column's share of a side-by-side diff. */
  setDiffSplit(share: number): void
  setThemeMode(mode: Settings['theme']): void
  /** Pick a palette: applies immediately and remembers it for its appearance. */
  selectTheme(themeId: string): void
  /** Open a PDF and turn to a page. */
  openPdfAt(path: string, page: number): void
  toggleDir(path: string): void
  collapseAllDirs(): void
  toggleFormattingToolbar(): void
  showToast(
    message: string,
    type?: 'info' | 'success' | 'warning' | 'error',
    duration?: number
  ): void
  clearToast(): void
  setFileTreeFilter(filter: string): void
  setFileTreeSort(sort: 'name' | 'modified'): void
  toggleZenMode(): void
  setDocStatsOpen(open: boolean): void
  /** Switch one HTML buffer between its source and the rendered page. */
  setHtmlReading(bufferId: string, reading: boolean): void
  toggleHtmlReading(bufferId: string): void
  /** Let one HTML buffer fetch the remote pictures it asks for. */
  allowHtmlRemote(bufferId: string): void
  /**
   * Let one HTML buffer run its own scripts.
   *
   * The flag is per buffer, because a decision has to be able to mean the pane
   * it was asked in. Whether it outlives the tab is a separate question, and
   * `core/html-trust` answers it: consent is recorded against the file and the
   * bytes it had, so a page you keep coming back to is not asked every time and
   * a page whose contents have been swapped is.
   */
  allowHtmlScripts(bufferId: string): void
  /** Take a consent back, here and on disk. Both take the file with them. */
  stopHtmlRemote(bufferId: string, path: string | null): void
  stopHtmlScripts(bufferId: string, path: string | null): void
  /**
   * Record what a page is allowed to do, against the bytes it has now.
   *
   * Called on every render that has a path, not only where a button was
   * pressed: that is what keeps the digest following a file whose author is
   * editing it, and what clears an entry once its last consent is gone. It
   * writes nothing when nothing would change.
   */
  rememberHtmlTrust(path: string, digest: string, grant: HtmlGrant): void
  /** Forget a page entirely, whichever consent was withdrawn. */
  forgetHtmlTrust(path: string): void
  /** Drop what was being remembered about a buffer that has gone. */
  forgetHtmlView(bufferId: string): void
  toggleTerminal(): void
  closeTerminal(): void
  openMediaViewer(target: MediaViewerTarget): void
  closeMediaViewer(): void
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const createUiSlice: StateCreator<AppState, [], [], UiSlice> = (set, get) => ({
  settings: defaultSettings,
  settingsLoaded: false,
  settingsOpen: false,
  sidePanel: null,
  graphOpen: false,
  analyticsOpen: false,
  historyOpen: false,
  paletteMode: null,
  expandedDirs: {},
  pdfTarget: null,
  treeEdit: null,
  showFormattingToolbar: false,
  toast: null,
  fileTreeFilter: '',
  searchSeed: { query: '', token: 0 },
  fileTreeSort: 'name',
  zenMode: false,
  docStatsOpen: false,
  htmlReading: {},
  htmlRemote: {},
  htmlScripts: {},
  terminalOpen: false,
  mediaViewer: null,

  async loadSettings() {
    const settings = await invoke('settings:get', undefined)
    // The open panel is restored from settings rather than starting closed, so
    // a first run opens on the outline and every run after that reopens
    // whatever was left showing.
    set({ settings, settingsLoaded: true, sidePanel: settings.rightPanel.panel })
  },

  /** Open a panel and remember it, so the choice survives a restart. */
  setSidePanel(panel) {
    set({ sidePanel: panel })
    const { rightPanel } = get().settings
    if (rightPanel.panel !== panel) get().updateSettings({ rightPanel: { ...rightPanel, panel } })
  },

  updateSettings(patch) {
    set({ settings: { ...get().settings, ...patch } })
    void invoke('settings:set', patch).then((confirmed) => set({ settings: confirmed }))
  },

  toggleBookmark(path) {
    const current = get().settings.bookmarks
    // Newest first, so the list reads as "what I pinned recently" rather than
    // as whatever order the filesystem happened to hand back.
    const next = current.includes(path) ? current.filter((p) => p !== path) : [path, ...current]
    get().updateSettings({ bookmarks: next })
  },

  openSettings() {
    set({ settingsOpen: true })
  },

  closeSettings() {
    set({ settingsOpen: false })
  },

  toggleSidePanel(panel) {
    get().setSidePanel(get().sidePanel === panel ? null : panel)
  },

  searchVaultFor(query) {
    get().setSidePanel('search')
    set((s) => ({
      sidePanel: 'search',
      searchSeed: { query, token: s.searchSeed.token + 1 }
    }))
  },

  toggleGraph() {
    set((s) => ({ graphOpen: !s.graphOpen }))
  },

  toggleAnalytics() {
    set((s) => ({ analyticsOpen: !s.analyticsOpen }))
  },

  toggleHistory() {
    set((s) => ({ historyOpen: !s.historyOpen }))
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

  showSidebarView(view) {
    const { sidebar } = get().settings
    // Hiding leaves `view` alone, so reopening returns to what was last read.
    const hiding = sidebar.visible && sidebar.view === view
    get().updateSettings({ sidebar: { ...sidebar, visible: !hiding, view } })
  },

  setSidebarWidth(width) {
    const { sidebar } = get().settings
    get().updateSettings({ sidebar: { ...sidebar, width } })
  },

  setRightPanelWidth(width) {
    const { rightPanel } = get().settings
    get().updateSettings({ rightPanel: { ...rightPanel, width } })
  },

  setDiffSplit(share) {
    get().updateSettings({ diff: { ...get().settings.diff, split: share } })
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

  openPdfAt(path, page) {
    set((s) => ({ pdfTarget: { path, page, token: (s.pdfTarget?.token ?? 0) + 1 } }))
    void get().openPaths([path])
  },

  toggleDir(path) {
    let opening = false
    set((s) => {
      const next = { ...s.expandedDirs }
      if (next[path]) delete next[path]
      else {
        next[path] = true
        opening = true
      }
      return { expandedDirs: next }
    })
    // The tree is read a directory at a time, so opening one is what fetches
    // it. Already-read directories are re-read too: a folder you come back to
    // should show what is in it now, not what was in it when you first looked.
    if (opening) void get().loadDir(path)
    get().syncWatchPaths()
  },

  collapseAllDirs() {
    set({ expandedDirs: {} })
    get().syncWatchPaths()
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
  },

  setHtmlReading(bufferId, reading) {
    set((state) => {
      if (!!state.htmlReading[bufferId] === reading) return {}
      const htmlReading = { ...state.htmlReading }
      if (reading) htmlReading[bufferId] = true
      else delete htmlReading[bufferId]
      return { htmlReading }
    })
  },

  toggleHtmlReading(bufferId) {
    get().setHtmlReading(bufferId, !get().htmlReading[bufferId])
  },

  allowHtmlRemote(bufferId) {
    set((state) => ({ htmlRemote: { ...state.htmlRemote, [bufferId]: true } }))
  },

  allowHtmlScripts(bufferId) {
    set((state) => ({ htmlScripts: { ...state.htmlScripts, [bufferId]: true } }))
  },

  stopHtmlRemote(bufferId, path) {
    set((state) => {
      const htmlRemote = { ...state.htmlRemote }
      delete htmlRemote[bufferId]
      return { htmlRemote }
    })
    if (path) get().forgetHtmlTrust(path)
  },

  stopHtmlScripts(bufferId, path) {
    set((state) => {
      const htmlScripts = { ...state.htmlScripts }
      delete htmlScripts[bufferId]
      return { htmlScripts }
    })
    if (path) get().forgetHtmlTrust(path)
  },

  rememberHtmlTrust(path, digest, grant) {
    const current = get().settings.htmlTrust
    const next = remember(current, path, digest, grant, Date.now())
    // By identity, which is the whole reason `remember` returns its argument
    // unchanged: this runs on every rebuild, and a rebuild happens a quarter of
    // a second after each keystroke in the pane next door.
    if (next !== current) get().updateSettings({ htmlTrust: next })
  },

  /**
   * Forget a page completely rather than only the consent that was withdrawn.
   *
   * Stopping the scripts on a page that may also fetch remote content drops
   * both rows, and the rebuild that follows records whatever is still live.
   * Going through nothing is the safe way round: the worst case is being asked
   * once more about something you had already allowed.
   */
  forgetHtmlTrust(path) {
    const current = get().settings.htmlTrust
    const next = withdraw(current, path)
    if (next !== current) get().updateSettings({ htmlTrust: next })
  },

  /**
   * Buffer ids are not reused, but a map nothing ever removes from is a leak
   * with a long fuse.
   *
   * Only the leak now. This used to be the whole of how a consent expired, and
   * it is not any more: the record in settings is keyed by file and outlives
   * every tab that showed it. Ending one is `stopHtmlRemote` and
   * `stopHtmlScripts`, which is a thing the reader has a button for.
   */
  forgetHtmlView(bufferId) {
    set((state) => {
      if (
        !state.htmlReading[bufferId] &&
        !state.htmlRemote[bufferId] &&
        !state.htmlScripts[bufferId]
      ) {
        return {}
      }
      const htmlReading = { ...state.htmlReading }
      const htmlRemote = { ...state.htmlRemote }
      const htmlScripts = { ...state.htmlScripts }
      delete htmlReading[bufferId]
      delete htmlRemote[bufferId]
      delete htmlScripts[bufferId]
      return { htmlReading, htmlRemote, htmlScripts }
    })
  },

  toggleTerminal() {
    set((s) => ({ terminalOpen: !s.terminalOpen }))
  },

  closeTerminal() {
    set({ terminalOpen: false })
  },

  openMediaViewer(target) {
    set({ mediaViewer: target })
  },

  closeMediaViewer() {
    set({ mediaViewer: null })
  }
})
