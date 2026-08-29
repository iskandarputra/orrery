import { app } from 'electron'
import { handleAssetProtocol, registerAssetScheme } from './asset-protocol'
import { registerIpcHandlers } from './ipc/handlers'
import { send } from './ipc/registry'
import { buildAppMenu } from './menu'
import { AiService } from './services/ai'
import { EmbeddingService } from './services/embeddings'
import { HistoryService } from './services/history'
import { GitService } from './services/git'
import { LspService } from './services/lsp'
import { TerminalService } from './services/terminal'
import { SidecarClient } from './services/sidecar'
import { sidecarPath } from './services/sidecar-path'
import { ExportService } from './services/exporter'
import { FileSystemService } from './services/file-system'
import { LinkScanner } from './services/link-scanner'
import { SettingsStore } from './services/settings-store'
import { WatcherService } from './services/watcher'
import { WindowManager } from './windows'

/**
 * A development run gets its own userData directory.
 *
 * Two things follow from sharing one. The single-instance lock is keyed on it,
 * so a dev instance left running makes the *installed* app exit half a second
 * after launch with no message — it hands off to the dev window and quits,
 * which looks exactly like the app failing to start. And a dev run writes to
 * the real app's settings and session, so testing a change edits the state of
 * the copy actually being used.
 *
 * Must happen before the lock is requested and before any service reads the
 * path.
 */
if (!app.isPackaged) {
  app.setPath('userData', `${app.getPath('userData')}-dev`)
}

// Composition root: construct services, wire dependencies, start the app.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  // Privileged scheme registration must happen before app `ready`.
  registerAssetScheme()

  const settings = new SettingsStore(app.getPath('userData'))

  const windows = new WindowManager({
    getSettings: () => settings.get(),
    saveWindowBounds: (bounds) => settings.set({ window: bounds })
  })

  const watcher = new WatcherService((watchId, events) => {
    const win = windows.window
    if (win) send(win, 'fs:changed', { watchId, events })
  })

  const fs = new FileSystemService()
  // Opt-in while the Rust sidecar is being evaluated: an env var rather than a
  // setting, so it needs no schema change and flows into the Playwright launches
  // that already pass `process.env` through. Off by default; when off, or when
  // the binary is absent, LinkScanner runs its TypeScript search exactly as before.
  const sidecar =
    process.env['ORRERY_RUST_SEARCH'] === '1' ? new SidecarClient(sidecarPath()) : null
  const links = new LinkScanner(sidecar)
  const exporter = new ExportService()
  const ai = new AiService(() => settings.get())
  const embeddings = new EmbeddingService(() => settings.get(), app.getPath('userData'))
  const history = new HistoryService(app.getPath('userData'))
  const git = new GitService()
  const terminal = new TerminalService({
    onData: (id, data) => {
      const win = windows.window
      if (win) send(win, 'terminal:data', { id, data })
    },
    onExit: (id, exitCode) => {
      const win = windows.window
      if (win) send(win, 'terminal:exit', { id, exitCode })
    }
  })
  const lsp = new LspService((payload) => {
    const win = windows.window
    if (win) send(win, 'lsp:diagnostics', payload)
  })

  // Language servers are children of this process; leaving them running
  // after a quit would leak one per session.
  app.on('will-quit', () => {
    lsp.shutdown()
    sidecar?.shutdown()
    // Shells are children of this process; none may outlive the window.
    terminal.shutdown()
  })

  app.on('second-instance', () => {
    const win = windows.window
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    await settings.load()
    handleAssetProtocol()
    registerIpcHandlers({
      fs,
      watcher,
      settings,
      windows,
      links,
      exporter,
      ai,
      embeddings,
      history,
      git,
      lsp,
      terminal
    })
    buildAppMenu(settings.get().keybindings)
    windows.createMainWindow()

    app.on('activate', () => {
      if (windows.window === null) windows.createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    void settings.flush()
    void watcher.dispose()
  })
}
