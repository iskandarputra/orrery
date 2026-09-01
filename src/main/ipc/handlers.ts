import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { app, dialog, nativeImage, shell } from 'electron'
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
import type { McpHostService } from '../services/mcp-host'
import type { SqliteService } from '../services/sqlite'
import type { TerminalService } from '../services/terminal'
import type { LinkScanner } from '../services/link-scanner'
import { readFile } from 'node:fs/promises'
import { IpcError } from './errors'
import {
  addImageObject,
  addTextObject,
  applyPagePlan,
  editTextRun,
  moveObject,
  pageCount,
  pageObjects,
  removePageObjects,
  rotateObject,
  resizeObject
} from '../services/pdfium'
import type { PdfHistory } from '../services/pdf-history'
import type { PdfDrafts } from '../services/pdf-drafts'
import type { PdfTextService } from '../services/pdf-text'
import type { SettingsStore } from '../services/settings-store'
import type { WatcherService } from '../services/watcher'
import type { WindowManager } from '../windows'
import { buildAppMenu } from '../menu'
import { handle, send } from './registry'

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
  mcpHost: McpHostService
  sqlite: SqliteService
  pdfText: PdfTextService
  pdfHistory: PdfHistory
  pdfDrafts: PdfDrafts
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
    mcpHost,
    mcpAudit,
    askUser,
    sqlite,
    pdfText,
    pdfHistory,
    pdfDrafts
  } = deps

  /**
   * Bumped whenever any document's draft changes.
   *
   * The reader hangs its reload off this: the same URL twice is served from the
   * cache, so a number that moves is what makes the pages redraw. One counter
   * across every document rather than one each — it only has to change, not to
   * mean anything.
   */
  let pdfVersion = 0

  // --- dialogs -------------------------------------------------------------
  handle('dialog:pickImage', null, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }]
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle('dialog:pickPdf', null, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

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
  handle('fs:readDir', pathReq, (_e, req) => fs.readDir(req.path))
  handle('fs:stat', pathReq, (_e, req) => fs.stat(req.path))
  handle(
    'fs:listFiles',
    z.object({ path: z.string().min(1), limit: z.number().int().min(1).max(200_000) }),
    (_e, req) => fs.listFiles(req.path, req.limit)
  )

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

  handle(
    'workspace:graph',
    z.object({ rootPath: z.string().min(1), withCode: z.boolean().optional() }),
    (_e, req) => links.graph(req.rootPath, req.withCode === true)
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

  const hostStatus = (): { running: boolean; url: string; token: string; allowWrites: boolean } => {
    const { host } = settings.get().mcp
    return {
      running: mcpHost.running,
      url: mcpHost.url,
      token: host.token,
      allowWrites: host.allowWrites
    }
  }

  handle('mcp:hostStatus', null, () => hostStatus())
  handle('mcp:hostSync', null, async () => {
    await mcpHost.sync()
    return hostStatus()
  })
  handle('mcp:hostRegenerateToken', null, async () => {
    const { mcp: current } = settings.get()
    // Stop first: a client holding the old token should lose the connection
    // rather than keep a session that outlived its credential.
    await mcpHost.stop()
    settings.set({ mcp: { ...current, host: { ...current.host, token: '' } } })
    await mcpHost.sync()
    return hostStatus()
  })

  const chatReq = z.object({
    system: z.string(),
    messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
  })

  handle('ai:chat', chatReq, (_e, req) => ai.chat(req.system, req.messages))

  handle('ai:chatWithTools', chatReq, (_e, req) => {
    // The catalogue is taken once per question, so a server that reconnects
    // mid-answer cannot change which tool a name refers to halfway through.
    const catalogue = mcp.toolCatalogue()
    const specs = catalogue.map((entry) => ({
      name: entry.qualified,
      // The server's name is part of the description because the model chooses
      // by description, and "search" from two servers is otherwise a coin toss.
      description: `[${entry.serverName}] ${entry.tool.description ?? entry.tool.name}`,
      inputSchema: entry.tool.inputSchema ?? {}
    }))

    return ai.chatWithTools(
      req.system,
      req.messages,
      specs,
      async (call) => {
        const entry = catalogue.find((candidate) => candidate.qualified === call.name)
        if (!entry) return { text: `There is no tool called ${call.name}.`, isError: true }
        // Straight to the service, which asks before anything runs.
        const result = await mcp.callTool(entry.serverId, entry.tool.name, call.args, 'model')
        return { text: result.text, isError: result.isError }
      },
      (step) => {
        const win = windows.window
        if (win) send(win, 'ai:toolStep', step)
      }
    )
  })

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

  // --- PDFs -----------------------------------------------------------------

  /**
   * A PDF, as the app currently shows it.
   *
   * Every change below reads through this and writes back to it, so a second
   * edit lands on top of the first and none of them touches the file. `pdf:save`
   * is the only thing that writes.
   */
  const currentPdf = (target: string): Promise<Uint8Array> =>
    pdfDrafts.read(target, async (file) => new Uint8Array(await readFile(file)))

  /**
   * Carry out one change to a document, keeping what it said before.
   *
   * Every one of these is the same three steps — read what the document says
   * now, remember it so the change can be taken back, put the result where the
   * reader will find it — and doing them in nine places is how they end up
   * being done nine slightly different ways.
   */
  const changePdf = async (
    target: string,
    change: (source: Uint8Array) => Promise<Uint8Array>
  ): Promise<{ version: number }> => {
    const source = await currentPdf(target)
    await pdfHistory.remember(target, source)
    pdfDrafts.set(target, await change(source))
    return { version: ++pdfVersion }
  }

  handle('pdf:canUndo', pathReq, (_e, req) => ({
    ...pdfHistory.can(req.path),
    drafted: pdfDrafts.has(req.path)
  }))
  handle('pdf:discard', pathReq, async (_e, req) => {
    pdfDrafts.discard(req.path)
    await pdfHistory.forget(req.path)
  })
  handle(
    'pdf:stage',
    z.object({ path: z.string().min(1), bytes: z.instanceof(Uint8Array) }),
    (_e, req) => {
      // No history step: this is not a change somebody made, it is the change
      // they already made arriving from the other side. The edit that follows
      // remembers these bytes, so undo goes back to the annotated document
      // rather than to one the annotation was never in.
      pdfDrafts.set(req.path, req.bytes)
      return { version: ++pdfVersion }
    }
  )
  handle(
    'pdf:undo',
    z.object({ path: z.string().min(1), direction: z.enum(['undo', 'redo']) }),
    async (_e, req) => {
      const current = await currentPdf(req.path)
      const bytes =
        req.direction === 'undo'
          ? await pdfHistory.undo(req.path, current)
          : await pdfHistory.redo(req.path, current)
      if (!bytes) return null
      // Into the draft, not onto the disk: taking back a change that was never
      // written must not be the thing that writes one.
      pdfDrafts.set(req.path, bytes)
      return { version: ++pdfVersion, ...pdfHistory.can(req.path) }
    }
  )

  handle('pdf:text', pathReq, (_e, req) => pdfText.read(req.path))
  handle(
    'pdf:objects',
    z.object({ path: z.string().min(1), page: z.number().int().min(0) }),
    async (_e, req) => pageObjects(await currentPdf(req.path), req.page)
  )
  handle(
    'pdf:editObject',
    z.object({
      path: z.string().min(1),
      page: z.number().int().min(0),
      indexes: z.array(z.number().int().min(0)).min(1).max(5000),
      text: z.string().max(20_000)
    }),
    (_e, req) =>
      changePdf(req.path, (source) => editTextRun(source, req.page, req.indexes, req.text))
  )
  handle(
    'pdf:moveObject',
    z.object({
      path: z.string().min(1),
      page: z.number().int().min(0),
      index: z.number().int().min(0),
      // Bounded to a page's worth of movement in either direction.
      dx: z.number().min(-20_000).max(20_000),
      dy: z.number().min(-20_000).max(20_000)
    }),
    (_e, req) =>
      changePdf(req.path, (source) => moveObject(source, req.page, req.index, req.dx, req.dy))
  )
  handle(
    'pdf:addImage',
    z.object({
      path: z.string().min(1),
      page: z.number().int().min(0),
      image: z.string().min(1),
      x: z.number(),
      y: z.number(),
      width: z.number().min(1).max(20_000),
      height: z.number().min(1).max(20_000)
    }),
    (_e, req) => {
      // Decoded by Electron, which reads every format the app can show. The
      // renderer sends a path, not pixels: a screenshot is megabytes, and there
      // is no reason for them to cross the boundary twice.
      const picture = nativeImage.createFromPath(req.image)
      if (picture.isEmpty()) throw new IpcError('UNKNOWN', 'That image could not be read')
      const { width, height } = picture.getSize()
      return changePdf(req.path, (source) =>
        addImageObject(
          source,
          req.page,
          { pixels: new Uint8Array(picture.toBitmap()), width, height },
          req.x,
          req.y,
          req.width,
          req.height
        )
      )
    }
  )
  handle(
    'pdf:addText',
    z.object({
      path: z.string().min(1),
      page: z.number().int().min(0),
      text: z.string().min(1).max(20_000),
      x: z.number(),
      y: z.number(),
      size: z.number().min(1).max(400)
    }),
    (_e, req) =>
      changePdf(req.path, (source) =>
        addTextObject(source, req.page, req.text, req.x, req.y, req.size)
      )
  )
  handle(
    'pdf:resizeObject',
    z.object({
      path: z.string().min(1),
      page: z.number().int().min(0),
      index: z.number().int().min(0),
      // A hundredth to a hundred times: past either end is a mistake, not a
      // resize, and an object scaled to nothing cannot be got back by dragging.
      sx: z.number().min(0.01).max(100),
      sy: z.number().min(0.01).max(100)
    }),
    (_e, req) =>
      changePdf(req.path, (source) => resizeObject(source, req.page, req.index, req.sx, req.sy))
  )
  handle(
    'pdf:rotateObject',
    z.object({
      path: z.string().min(1),
      page: z.number().int().min(0),
      index: z.number().int().min(0),
      // Any angle, but never so many turns that the matrix stops meaning
      // anything; the editor sends what the handle was dragged to.
      degrees: z.number().min(-360).max(360)
    }),
    (_e, req) =>
      changePdf(req.path, (source) => rotateObject(source, req.page, req.index, req.degrees))
  )
  handle('pdf:pageCount', pathReq, async (_e, req) => pageCount(await currentPdf(req.path)))
  handle(
    'pdf:removeObjects',
    z.object({
      path: z.string().min(1),
      page: z.number().int().min(0),
      indexes: z.array(z.number().int().min(0)).max(5000)
    }),
    (_e, req) => changePdf(req.path, (source) => removePageObjects(source, req.page, req.indexes))
  )
  const pagePlan = z.object({
    order: z.array(z.number().int().min(0)).max(20_000),
    rotate: z.array(z.number().int()).max(20_000)
  })
  handle(
    'pdf:pages',
    z.object({
      path: z.string().min(1),
      plan: pagePlan,
      also: z.array(z.string().min(1)).max(50).optional()
    }),
    async (_e, req) => {
      // The other documents are read as they are on disk unless they are open
      // and being edited too, in which case what you can see is what gets
      // merged in.
      const others = await Promise.all((req.also ?? []).map((file) => currentPdf(file)))
      return changePdf(req.path, (source) => applyPagePlan([source, ...others], req.plan))
    }
  )
  handle(
    'pdf:extractPages',
    z.object({ path: z.string().min(1), plan: pagePlan, saveAs: z.string().min(1) }),
    async (_e, req) => {
      const bytes = await applyPagePlan([await currentPdf(req.path)], req.plan)
      // Writing somewhere new never overwrites: extracting pages twice is a
      // thing people do, and the second attempt must not eat the first. A new
      // file has nothing to conflict with, so there is no check to make.
      const result = await fs.writeBytes(await fs.freeName(req.saveAs), bytes, null)
      await pdfText.forget(result.path)
      return result
    }
  )
  handle(
    'pdf:save',
    z.object({
      path: z.string().min(1),
      bytes: z.instanceof(Uint8Array).nullable(),
      expectedMtimeMs: z.number().nullable()
    }),
    async (_e, req) => {
      // What the reader is holding, when it is holding anything: annotations
      // and form values are pdf.js's to serialise, and they arrive here as the
      // whole document with those folded in. It becomes the draft first, so a
      // save that fails the conflict check leaves the app showing what it was
      // showing rather than quietly dropping the marks.
      if (req.bytes) {
        await pdfHistory.remember(req.path, await currentPdf(req.path))
        pdfDrafts.set(req.path, req.bytes)
      }
      const result = await fs.writeBytes(req.path, await currentPdf(req.path), req.expectedMtimeMs)
      // The file is now what the draft said, so there is no longer a draft.
      pdfDrafts.discard(req.path)
      // The document has changed, so what it says has changed: the next search
      // must read it again rather than answer from what it used to say.
      await pdfText.forget(req.path)
      return result
    }
  )
  handle(
    'pdf:recognised',
    z.object({
      path: z.string().min(1),
      pages: z
        .array(z.object({ page: z.number().int().min(1), text: z.string().max(2_000_000) }))
        .max(5000)
    }),
    (_e, req) =>
      pdfText.merge(req.path, new Map(req.pages.map((entry) => [entry.page, entry.text])))
  )

  // --- databases ------------------------------------------------------------

  handle('db:available', null, () => sqlite.available)
  handle('db:tables', pathReq, (_e, req) => sqlite.tables(req.path))
  handle(
    'db:rows',
    z.object({
      path: z.string().min(1),
      table: z.string().min(1),
      limit: z.number().int().min(1).max(5000).optional(),
      offset: z.number().int().min(0).optional(),
      orderBy: z.string().optional(),
      descending: z.boolean().optional()
    }),
    (_e, req) =>
      sqlite.rows(req.path, req.table, {
        limit: req.limit ?? 200,
        offset: req.offset ?? 0,
        orderBy: req.orderBy ?? '',
        descending: req.descending === true
      })
  )
  handle('db:query', z.object({ path: z.string().min(1), sql: z.string() }), (_e, req) =>
    sqlite.query(req.path, req.sql)
  )
  handle('db:close', pathReq, (_e, req) => sqlite.close(req.path))

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
  handle(
    'fs:watchPaths',
    // Bounded: this is a list from the renderer, and every entry becomes a
    // file handle.
    z.object({ watchId: z.string(), paths: z.array(z.string().min(1)).max(2000) }),
    (_e, req) => watcher.setPaths(req.watchId, req.paths)
  )

  // --- version history -----------------------------------------------------
  handle('history:list', z.object({ path: z.string().min(1) }), (_e, req) => history.list(req.path))
  handle('history:read', z.object({ path: z.string().min(1), id: z.string().min(1) }), (_e, req) =>
    history.read(req.path, req.id)
  )

  // --- settings ------------------------------------------------------------
  handle('settings:get', null, () => settings.get())
  // The zod merge inside SettingsStore.set validates the patch; pass raw here.
  handle(
    'window:setZoom',
    z.object({ by: z.number().optional(), level: z.number().optional() }),
    (_e, req) => {
      if (typeof req.level === 'number') windows.setZoom(req.level)
      else windows.zoomBy(req.by ?? 0)
      return settings.get().zoomLevel
    }
  )

  handle('settings:set', null, (_e, patch) => {
    const before = settings.get().lastOpenedFolder
    const beforeRecent = settings.get().recentFolders
    const next = settings.set(patch)
    // The Open Recent submenu is built from settings, so it is rebuilt when
    // they change. A native menu cannot read state; it is state, copied.
    if (
      (patch && typeof patch === 'object' && 'keybindings' in patch) ||
      next.recentFolders !== beforeRecent
    ) {
      buildAppMenu(next.keybindings, {
        files: next.recentFiles,
        folders: next.recentFolders
      })
    }
    // Opening another vault moves the one root every server was given. A
    // server still answering about the old folder is worse than one with none.
    if (next.lastOpenedFolder !== before) mcp.rootsChanged()
    return next
  })

  // --- app -----------------------------------------------------------------
  handle('app:getRecentFiles', null, () => settings.get().recentFiles)

  handle('app:addRecentFile', pathReq, (_e, req) => {
    const next = settings.set({ recentFiles: pushRecent(settings.get().recentFiles, req.path) })
    app.addRecentDocument(req.path)
    buildAppMenu(next.keybindings, { files: next.recentFiles, folders: next.recentFolders })
  })

  handle('app:getRecentFolders', null, () => settings.get().recentFolders)
  handle('app:clearRecent', null, () => {
    const next = settings.set({ recentFiles: [], recentFolders: [] })
    app.clearRecentDocuments()
    buildAppMenu(next.keybindings, { files: [], folders: [] })
  })

  // --- window --------------------------------------------------------------
  handle('window:readyToClose', null, () => windows.confirmClose())

  handle('window:setTitle', z.object({ title: z.string() }), (_e, req) => {
    windows.window?.setTitle(req.title)
  })
}
