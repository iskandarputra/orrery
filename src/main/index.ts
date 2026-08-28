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
import { ExportService } from './services/exporter'
import { FileSystemService } from './services/file-system'
import { LinkScanner } from './services/link-scanner'
import { SettingsStore } from './services/settings-store'
import { WatcherService } from './services/watcher'
import { WindowManager } from './windows'

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
  const links = new LinkScanner()
  const exporter = new ExportService()
  const ai = new AiService(() => settings.get())
  const embeddings = new EmbeddingService(() => settings.get(), app.getPath('userData'))
  const history = new HistoryService(app.getPath('userData'))
  const git = new GitService()
  const lsp = new LspService((payload) => {
    const win = windows.window
    if (win) send(win, 'lsp:diagnostics', payload)
  })

  // Language servers are children of this process; leaving them running
  // after a quit would leak one per session.
  app.on('will-quit', () => lsp.shutdown())

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
      lsp
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
