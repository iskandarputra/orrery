import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { app, dialog, shell } from 'electron'
import { z } from 'zod'
import { pushRecent } from '@core/recent'
import type { AiService } from '../services/ai'
import type { EmbeddingService } from '../services/embeddings'
import type { ExportService } from '../services/exporter'
import type { FileSystemService } from '../services/file-system'
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
}

const pathReq = z.object({ path: z.string().min(1) })

const MARKDOWN_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] },
  { name: 'All Files', extensions: ['*'] }
]

/** Bind every contract channel to its service. All channels registered here. */
export function registerIpcHandlers(deps: HandlerDeps): void {
  const { fs, watcher, settings, windows, links, exporter, ai, embeddings } = deps

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

  handle(
    'fs:writeFile',
    z.object({
      path: z.string().min(1),
      content: z.string(),
      expectedMtimeMs: z.number().nullable()
    }),
    (_e, req) => fs.writeFile(req.path, req.content, req.expectedMtimeMs)
  )

  handle('fs:readTree', pathReq, (_e, req) => fs.readTree(req.path))

  handle(
    'fs:createFile',
    z.object({ dirPath: z.string().min(1), name: z.string().min(1) }),
    (_e, req) => fs.createFile(req.dirPath, req.name)
  )
  handle(
    'fs:ensureFile',
    z.object({ path: z.string().min(1), content: z.string() }),
    (_e, req) => fs.ensureFile(req.path, req.content)
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
      caseSensitive: z.boolean()
    }),
    (_e, req) => links.search(req.rootPath, req.query, req.regex, req.caseSensitive)
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

  handle(
    'fs:rename',
    z.object({ path: z.string().min(1), newName: z.string().min(1) }),
    (_e, req) => fs.rename(req.path, req.newName)
  )

  handle('fs:trash', pathReq, (_e, req) => fs.trash(req.path))

  handle('fs:watch', pathReq, async (_e, req) => ({ watchId: await watcher.watch(req.path) }))

  handle('fs:unwatch', z.object({ watchId: z.string() }), (_e, req) => watcher.unwatch(req.watchId))

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
