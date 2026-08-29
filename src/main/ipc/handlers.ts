import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { app, dialog, shell } from 'electron'
import { z } from 'zod'
import { pushRecent } from '@core/recent'
import type { AiService } from '../services/ai'
import type { EmbeddingService } from '../services/embeddings'
import type { ExportService } from '../services/exporter'
import type { HistoryService } from '../services/history'
import type { FileSystemService } from '../services/file-system'
import type { GitService } from '../services/git'
import type { LspService } from '../services/lsp'
import type { AskUser } from '../services/ask-user'
import type { McpAudit } from '../services/mcp-audit'
import type { McpClientService } from '../services/mcp-client'
import type { TerminalService } from '../services/terminal'
import type { LinkScanner } from '../services/link-scanner'
import type { SettingsStore } from '../services/settings-store'
import type { WatcherService } from '../services/watcher'
import type { WindowManager } from '../windows'
import { buildAppMenu } from '../menu'
import { handle } from './registry'

export interface HandlerDeps {
  fs: FileSystemService
  watcher: WatcherService
  settings: SettingsStore
  windows: WindowManager
  links: LinkScanner
  exporter: ExportService
  ai: AiService
  embeddings: EmbeddingService
  history: HistoryService
  git: GitService
  lsp: LspService
  terminal: TerminalService
  mcp: McpClientService
  mcpAudit: McpAudit
  askUser: AskUser
}

const pathReq = z.object({ path: z.string().min(1) })

const MARKDOWN_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] },
  { name: 'All Files', extensions: ['*'] }
]

/** Bind every contract channel to its service. All channels registered here. */
export function registerIpcHandlers(deps: HandlerDeps): void {
  const {
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
    mcpAudit,
    askUser
  } = deps

  // --- dialogs -------------------------------------------------------------
  handle('dialog:openFile', null, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: MARKDOWN_FILTERS
    })
    return result.canceled ? null : result.filePaths
  })

  handle('dialog:openFolder', null, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle(
    'dialog:saveAs',
    z.object({ suggestedName: z.string().optional(), defaultDir: z.string().optional() }),
    async (_e, req) => {
      const result = await dialog.showSaveDialog({
        defaultPath: req.defaultDir
          ? `${req.defaultDir}/${req.suggestedName ?? 'untitled.md'}`
          : (req.suggestedName ?? 'untitled.md'),
        filters: MARKDOWN_FILTERS
      })
      return result.canceled ? null : (result.filePath ?? null)
    }
  )

  handle('dialog:confirmClose', z.object({ fileNames: z.array(z.string()) }), async (_e, req) => {
    const win = windows.window
    if (!win) return 'discard'
    const list = req.fileNames.slice(0, 5).join('\n')
    const more = req.fileNames.length > 5 ? `\n…and ${req.fileNames.length - 5} more` : ''
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Save All', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message:
        req.fileNames.length === 1
          ? `Do you want to save the changes you made to ${req.fileNames[0]}?`
          : `Do you want to save changes to ${req.fileNames.length} files?`,
      detail: `${list}${more}\n\nYour changes will be lost if you don't save them.`
    })
    return (['save', 'discard', 'cancel'] as const)[response] ?? 'cancel'
  })

  // --- file system ---------------------------------------------------------
  handle('fs:readFile', pathReq, (_e, req) => fs.readFile(req.path))

  // --- terminal -------------------------------------------------------------
  const termId = z.object({ id: z.string().min(1) })
  handle('terminal:available', null, () => terminal.available)
  handle(
    'terminal:create',
    z.object({ cwd: z.string(), cols: z.number(), rows: z.number() }),
    (_e, req) => terminal.create(req.cwd, req.cols, req.rows)
  )
  handle('terminal:write', termId.extend({ data: z.string() }), (_e, req) =>
    terminal.write(req.id, req.data)
  )
  handle('terminal:resize', termId.extend({ cols: z.number(), rows: z.number() }), (_e, req) =>
    terminal.resize(req.id, req.cols, req.rows)
  )
  handle('terminal:kill', termId, (_e, req) => terminal.kill(req.id))

  // --- git ------------------------------------------------------------------
  handle('git:fileChanges', pathReq, (_e, req) => git.fileChanges(req.path))
  const rootReq = z.object({ rootPath: z.string().min(1) })
  const rootPathsReq = rootReq.extend({ paths: z.array(z.string()) })
  handle('git:isRepository', rootReq, (_e, req) => git.isRepository(req.rootPath))
  handle('git:status', rootReq, (_e, req) => git.status(req.rootPath))
  handle('git:stage', rootPathsReq, (_e, req) => git.stage(req.rootPath, req.paths))
  handle('git:unstage', rootPathsReq, (_e, req) => git.unstage(req.rootPath, req.paths))
  handle('git:discard', rootPathsReq.extend({ untracked: z.array(z.string()) }), (_e, req) =>
    git.discard(req.rootPath, req.paths, req.untracked)
  )
  handle('git:log', rootReq.extend({ limit: z.number().int().min(1).max(1000) }), (_e, req) =>
    git.log(req.rootPath, req.limit)
  )
  handle('git:absolutePath', rootReq.extend({ path: z.string().min(1) }), (_e, req) =>
    path.join(req.rootPath, req.path)
  )
  // A commit-ish, kept to what git can name: hashes, refs, and the `^`/`~`
  // suffixes. It reaches a command line, so the shape is checked here.
  const commitish = z
    .string()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9._/^~-]+$/, 'not a valid git reference')

  handle(
    'git:fileContents',
    rootReq.extend({
      path: z.string().min(1),
      staged: z.boolean(),
      commit: commitish.optional()
    }),
    (_e, req) => git.fileContents(req.rootPath, req.path, req.staged, req.commit)
  )
  handle('git:commitDetail', rootReq.extend({ hash: commitish }), (_e, req) =>
    git.commitDetail(req.rootPath, req.hash)
  )
  handle('git:checkout', rootReq.extend({ ref: commitish }), (_e, req) =>
    git.checkout(req.rootPath, req.ref)
  )
  handle('git:createBranch', rootReq.extend({ name: commitish, at: commitish }), (_e, req) =>
    git.createBranch(req.rootPath, req.name, req.at)
  )
  handle('git:revert', rootReq.extend({ hash: commitish }), (_e, req) =>
    git.revert(req.rootPath, req.hash)
  )
  handle('git:cherryPick', rootReq.extend({ hash: commitish }), (_e, req) =>
    git.cherryPick(req.rootPath, req.hash)
  )
  handle(
    'git:fileDiff',
    rootReq.extend({
      path: z.string().min(1),
      staged: z.boolean(),
      commit: commitish.optional()
    }),
    (_e, req) => git.fileDiff(req.rootPath, req.path, req.staged, req.commit)
  )
  handle('git:commit', rootReq.extend({ message: z.string() }), (_e, req) =>
    git.commit(req.rootPath, req.message)
  )

  // --- language servers -----------------------------------------------------
  const docReq = z.object({ path: z.string().min(1), text: z.string() })
  handle('lsp:openDocument', docReq, (_e, req) => lsp.openDocument(req.path, req.text))
  handle('lsp:changeDocument', docReq, (_e, req) => lsp.changeDocument(req.path, req.text))
  handle('lsp:closeDocument', pathReq, (_e, req) => lsp.closeDocument(req.path))
  handle('lsp:installed', null, () => lsp.installed())
  const posReq = z.object({
    path: z.string().min(1),
    line: z.number().int().min(0),
    character: z.number().int().min(0)
  })
  handle('lsp:hover', posReq, (_e, req) => lsp.hover(req.path, req.line, req.character))
  handle('lsp:complete', posReq, (_e, req) => lsp.complete(req.path, req.line, req.character))
  handle('lsp:definition', posReq, (_e, req) => lsp.definition(req.path, req.line, req.character))

  handle(
    'fs:writeFile',
    z.object({
      path: z.string().min(1),
      content: z.string(),
      expectedMtimeMs: z.number().nullable()
    }),
    async (_e, req) => {
      const result = await fs.writeFile(req.path, req.content, req.expectedMtimeMs)
      // Record the version only once the file is safely on disk, and never let
      // a history failure cost the user their save.
      await history.record(req.path, req.content).catch(() => undefined)
      return result
    }
  )

  handle('fs:readTree', pathReq, (_e, req) => fs.readTree(req.path))

  handle(
    'fs:createFile',
    z.object({ dirPath: z.string().min(1), name: z.string().min(1) }),
    (_e, req) => fs.createFile(req.dirPath, req.name)
  )
  handle(
    'fs:writeAsset',
    z.object({ dirPath: z.string().min(1), name: z.string().min(1), base64: z.string() }),
    (_e, req) => fs.writeAsset(req.dirPath, req.name, req.base64)
  )
  handle('fs:ensureFile', z.object({ path: z.string().min(1), content: z.string() }), (_e, req) =>
    fs.ensureFile(req.path, req.content)
  )

  handle(
    'fs:createDirectory',
    z.object({ dirPath: z.string().min(1), name: z.string().min(1) }),
    (_e, req) => fs.createDirectory(req.dirPath, req.name)
  )

  handle('shell:showItemInFolder', pathReq, (_e, req) => {
    shell.showItemInFolder(req.path)
  })

  handle(
    'workspace:scanLinks',
    z.object({ rootPath: z.string().min(1), targetStem: z.string().min(1) }),
    (_e, req) => links.scan(req.rootPath, req.targetStem)
  )

  handle(
    'workspace:search',
    z.object({
      rootPath: z.string().min(1),
      query: z.string().min(1),
      regex: z.boolean(),
      caseSensitive: z.boolean(),
      wholeWord: z.boolean(),
      // Bounded: these become regular expressions, and an unbounded pattern
      // from the renderer is an unbounded pattern in the walk.
      include: z.string().max(512),
      exclude: z.string().max(512)
    }),
    (_e, req) =>
      links.search(req.rootPath, req.query, {
        regex: req.regex,
        caseSensitive: req.caseSensitive,
        wholeWord: req.wholeWord,
        include: req.include,
        exclude: req.exclude
      })
  )

  handle('workspace:graph', z.object({ rootPath: z.string().min(1) }), (_e, req) =>
    links.graph(req.rootPath)
  )

  handle('plugins:list', null, async () => {
    const dir = path.join(app.getPath('userData'), 'plugins')
    try {
      const entries = await fsp.readdir(dir)
      const out: { name: string; source: string }[] = []
      for (const name of entries.filter((n) => n.endsWith('.js')).slice(0, 50)) {
        out.push({ name, source: await fsp.readFile(path.join(dir, name), 'utf-8') })
      }
      return out
    } catch {
      return []
    }
  })

  // --- MCP ------------------------------------------------------------------
  const serverId = z.object({ id: z.string().min(1) })

  handle('mcp:status', null, () => mcp.statuses())
  handle('mcp:connect', serverId, (_e, req) => mcp.connect(req.id))
  handle('mcp:disconnect', serverId, (_e, req) => mcp.disconnect(req.id))
  handle('mcp:refresh', serverId, (_e, req) => mcp.refresh(req.id))
  handle(
    'mcp:callTool',
    serverId.extend({ tool: z.string().min(1), args: z.record(z.string(), z.unknown()) }),
    // `user`: this path is only reached by someone clicking run. The model's
    // calls go through the service directly, and are labelled as such.
    (_e, req) => mcp.callTool(req.id, req.tool, req.args, 'user')
  )
  handle('mcp:readResource', serverId.extend({ uri: z.string().min(1) }), (_e, req) =>
    mcp.readResource(req.id, req.uri)
  )
  handle(
    'mcp:getPrompt',
    serverId.extend({
      name: z.string().min(1),
      args: z.record(z.string(), z.string()).optional()
    }),
    (_e, req) => mcp.getPrompt(req.id, req.name, req.args ?? {})
  )
  handle('mcp:answer', z.object({ id: z.string().min(1), value: z.unknown() }), (_e, req) => {
    askUser.answer(req.id, req.value)
  })
  handle('mcp:audit', z.object({ limit: z.number().int().min(1).max(500) }), (_e, req) =>
    mcpAudit.recent(req.limit)
  )

  handle(
    'ai:chat',
    z.object({
      system: z.string(),
      messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    }),
    (_e, req) => ai.chat(req.system, req.messages)
  )

  handle('embeddings:reindex', z.object({ rootPath: z.string().min(1) }), (_e, req) =>
    embeddings.reindex(req.rootPath)
  )
  handle(
    'embeddings:search',
    z.object({ rootPath: z.string().min(1), query: z.string().min(1), k: z.number().int() }),
    (_e, req) => embeddings.search(req.rootPath, req.query, req.k)
  )
  handle(
    'embeddings:suggestLinks',
    z.object({
      rootPath: z.string().min(1),
      path: z.string().min(1),
      limit: z.number().int().min(1).max(20)
    }),
    (_e, req) => embeddings.suggestLinks(req.rootPath, req.path, req.limit)
  )

  const exportReq = z.object({ title: z.string(), markdown: z.string() })
  handle('export:html', exportReq, (_e, req) => exporter.exportHtml(req.title, req.markdown))
  handle('export:pdf', exportReq, (_e, req) => exporter.exportPdf(req.title, req.markdown))
  handle('export:print', exportReq, (_e, req) => exporter.print(req.title, req.markdown))
  handle('editor:replaceMisspelling', z.object({ word: z.string() }), (event, req) => {
    event.sender.replaceMisspelling(req.word)
  })

  handle(
    'fs:rename',
    z.object({ path: z.string().min(1), newName: z.string().min(1) }),
    (_e, req) => fs.rename(req.path, req.newName)
  )

  handle('fs:trash', pathReq, (_e, req) => fs.trash(req.path))

  handle('fs:watch', pathReq, async (_e, req) => ({ watchId: await watcher.watch(req.path) }))

  handle('fs:unwatch', z.object({ watchId: z.string() }), (_e, req) => watcher.unwatch(req.watchId))

  // --- version history -----------------------------------------------------
  handle('history:list', z.object({ path: z.string().min(1) }), (_e, req) => history.list(req.path))
  handle('history:read', z.object({ path: z.string().min(1), id: z.string().min(1) }), (_e, req) =>
    history.read(req.path, req.id)
  )

  // --- settings ------------------------------------------------------------
  handle('settings:get', null, () => settings.get())
  // The zod merge inside SettingsStore.set validates the patch; pass raw here.
  handle('settings:set', null, (_e, patch) => {
    const next = settings.set(patch)
    if (patch && typeof patch === 'object' && 'keybindings' in patch) {
      buildAppMenu(next.keybindings)
    }
    return next
  })

  // --- app -----------------------------------------------------------------
  handle('app:getRecentFiles', null, () => settings.get().recentFiles)

  handle('app:addRecentFile', pathReq, (_e, req) => {
    settings.set({ recentFiles: pushRecent(settings.get().recentFiles, req.path) })
    app.addRecentDocument(req.path)
  })

  // --- window --------------------------------------------------------------
  handle('window:readyToClose', null, () => windows.confirmClose())

  handle('window:setTitle', z.object({ title: z.string() }), (_e, req) => {
    windows.window?.setTitle(req.title)
  })
}
