import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { BrowserWindow, dialog } from 'electron'
import { toIpcError } from '../ipc/errors'
import { buildExportHtml } from './export-html'

/** Exports the active note to standalone HTML or PDF (via a hidden window). */
export class ExportService {
  async exportHtml(title: string, markdown: string): Promise<string | null> {
    const target = await this.pickPath(title, 'html', [
      { name: 'HTML', extensions: ['html', 'htm'] }
    ])
    if (!target) return null
    try {
      await fs.writeFile(target, await buildExportHtml(title, markdown), 'utf-8')
      return target
    } catch (err) {
      throw toIpcError(err)
    }
  }

  async exportPdf(title: string, markdown: string): Promise<string | null> {
    const target = await this.pickPath(title, 'pdf', [{ name: 'PDF', extensions: ['pdf'] }])
    if (!target) return null

    const tmp = path.join(os.tmpdir(), `orrery-export-${randomUUID()}.html`)
    let win: BrowserWindow | null = null
    try {
      await fs.writeFile(tmp, await buildExportHtml(title, markdown), 'utf-8')
      win = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, contextIsolation: true }
      })
      await win.loadFile(tmp)
      const pdf = await win.webContents.printToPDF({
        printBackground: true,
        margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
        pageSize: 'A4'
      })
      await fs.writeFile(target, pdf)
      return target
    } catch (err) {
      throw toIpcError(err)
    } finally {
      win?.destroy()
      void fs.unlink(tmp).catch(() => undefined)
    }
  }

  /**
   * Print the rendered note, not the app window: the same export HTML the PDF
   * path uses is loaded in a hidden window and printed from there, so the
   * sidebar, tabs and panels don't end up on paper.
   */
  async print(title: string, markdown: string): Promise<boolean> {
    const tmp = path.join(os.tmpdir(), `orrery-print-${randomUUID()}.html`)
    let win: BrowserWindow | null = null
    try {
      await fs.writeFile(tmp, await buildExportHtml(title, markdown), 'utf-8')
      win = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, contextIsolation: true }
      })
      await win.loadFile(tmp)
      const target = win
      return await new Promise<boolean>((resolve) => {
        target.webContents.print({ printBackground: true }, (success) => resolve(success))
      })
    } catch (err) {
      throw toIpcError(err)
    } finally {
      win?.destroy()
      void fs.unlink(tmp).catch(() => undefined)
    }
  }

  private async pickPath(
    title: string,
    ext: string,
    filters: Electron.FileFilter[]
  ): Promise<string | null> {
    const safe = title.replace(/[\\/:*?"<>|]/g, '').trim() || 'export'
    const result = await dialog.showSaveDialog({
      defaultPath: `${safe}.${ext}`,
      filters
    })
    return result.canceled ? null : (result.filePath ?? null)
  }
}
