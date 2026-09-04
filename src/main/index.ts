import { join } from 'node:path'
import { app } from 'electron'
import { handleAssetProtocol, registerAssetScheme } from './asset-protocol'
import { handlePreviewProtocol, registerPreviewScheme } from './preview-protocol'
import { registerIpcHandlers } from './ipc/handlers'
import { send } from './ipc/registry'
import { buildAppMenu } from './menu'
import { AiService } from './services/ai'
import { EmbeddingService } from './services/embeddings'
import { HistoryService } from './services/history'
import { GitService } from './services/git'
import { LspService } from './services/lsp'
import { AskUser } from './services/ask-user'
import { McpAudit } from './services/mcp-audit'
import { McpClientService } from './services/mcp-client'
import { McpHostService } from './services/mcp-host'
import { SqliteService } from './services/sqlite'
import { PdfTextService } from './services/pdf-text'
import { PdfHistory } from './services/pdf-history'
import { PdfDrafts } from './services/pdf-drafts'
import { DraftNotes } from './services/draft-notes'
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
  registerPreviewScheme()

  const settings = new SettingsStore(app.getPath('userData'))

  const windows = new WindowManager({
    getSettings: () => settings.get(),
    saveWindowBounds: (bounds) => settings.set({ window: { ...settings.get().window, ...bounds } }),
    saveZoomLevel: (zoomLevel) => settings.set({ zoomLevel })
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
  // What PDFs say, so search can look inside them. Cached under userData: a
  // paper is parsed once and not on every search over the vault it lives in.
  const pdfText = new PdfTextService(join(app.getPath('userData'), 'pdf-text'))
  // What each document looked like before its last few changes. On disk, not in
  // memory: a scan is tens of megabytes and twenty of those is a quarter of a
  // gigabyte for a feature nobody thinks about until they need it.
  const pdfHistory = new PdfHistory(join(app.getPath('userData'), 'pdf-undo'))
  // Changes to a PDF that have not been saved yet. The asset protocol serves
  // them in place of the file, so the reader shows what you have done without
  // any of it being written.
  const pdfDrafts = new PdfDrafts()
  // Notes written but never given a file, kept across a quit.
  const draftNotes = new DraftNotes(join(app.getPath('userData'), 'drafts'))
  const links = new LinkScanner(sidecar, pdfText)
  const exporter = new ExportService()
  const ai = new AiService(() => settings.get())
  const embeddings = new EmbeddingService(() => settings.get(), app.getPath('userData'))
  const history = new HistoryService(app.getPath('userData'))
  const git = new GitService()
  const sqlite = new SqliteService()
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

  // MCP. `askUser` is the one place main asks the renderer a question rather
  // than answering one: no window means nobody can consent, which `AskUser`
  // turns into a refusal.
  const askUser = new AskUser((request) => {
    const win = windows.window
    if (!win) return false
    send(win, 'mcp:ask', request)
    return true
  })
  const mcpAudit = new McpAudit(join(app.getPath('userData'), 'mcp-log'))
  const mcp = new McpClientService(
    { get: () => settings.get(), set: (patch) => settings.set(patch) },
    askUser,
    mcpAudit,
    {
      onServerChanged: (status) => {
        const win = windows.window
        if (win) send(win, 'mcp:serverChanged', status)
      },
      onActivity: () => {
        const win = windows.window
        if (win) send(win, 'mcp:activity', undefined)
      }
    },
    () => settings.get().lastOpenedFolder,
    // Sampling runs through the user's own provider, so a server borrowing the
    // model borrows the one they configured and pays for.
    (system, prompt) => ai.chat(system, [{ role: 'user', content: prompt }])
  )

  // Language servers are children of this process; leaving them running
  // after a quit would leak one per session.
  // The vault, offered to other MCP clients. Off unless the user says so, and
  // started after settings have loaded.
  const mcpHost = new McpHostService({
    settings: { get: () => settings.get(), set: (patch) => settings.set(patch) },
    fs,
    links,
    git,
    ask: askUser,
    audit: mcpAudit,
    vaultRoot: () => settings.get().lastOpenedFolder,
    onChanged: () => {
      const win = windows.window
      if (win) send(win, 'mcp:activity', undefined)
    }
  })

  app.on('will-quit', () => {
    lsp.shutdown()
    // Somebody else's programs, started by us: none may outlive the window,
    // and anything still waiting on a dialog is refused rather than left.
    askUser.cancelAll()
    void mcp.shutdown()
    void mcpHost.stop()
    // Database handles are files held open; none may outlive the window.
    sqlite.close()
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
    handleAssetProtocol((filePath) => pdfDrafts.peek(filePath))
    handlePreviewProtocol()
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
      terminal,
      mcp,
      mcpHost,
      mcpAudit,
      askUser,
      sqlite,
      pdfText,
      pdfHistory,
      pdfDrafts,
      draftNotes
    })
    buildAppMenu(settings.get().keybindings, {
      files: settings.get().recentFiles,
      folders: settings.get().recentFolders
    })
    windows.createMainWindow()
    // After the window exists: connecting announces status, and an announcement
    // with nowhere to go is a status the panel never shows.
    void mcp.connectAll()
    // A server that was left on stays on across a restart: a client configured
    // against it should not need Orrery opened and a switch flipped.
    void mcpHost.sync().catch((err: unknown) => console.error('MCP host:', err))

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
