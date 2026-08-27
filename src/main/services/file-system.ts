import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { shell } from 'electron'
import type { FileNode, FileReadResult, FileWriteResult } from '@shared/types'
import { IpcError, toIpcError } from '../ipc/errors'

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.svn', '.hg'])

export class FileSystemService {
  async readFile(filePath: string): Promise<FileReadResult> {
    try {
      const [content, stat] = await Promise.all([fs.readFile(filePath, 'utf-8'), fs.stat(filePath)])
      return { path: filePath, content, mtimeMs: stat.mtimeMs }
    } catch (err) {
      throw toIpcError(err)
    }
  }

  /**
   * Atomic write (temp file + rename) with optimistic-concurrency check:
   * if the file on disk is newer than what the caller last saw, refuse with
   * CONFLICT so the renderer can prompt overwrite/reload.
   */
  async writeFile(
    filePath: string,
    content: string,
    expectedMtimeMs: number | null
  ): Promise<FileWriteResult> {
    try {
      if (expectedMtimeMs !== null) {
        const stat = await fs.stat(filePath).catch(() => null)
        if (stat && Math.abs(stat.mtimeMs - expectedMtimeMs) > 1) {
          throw new IpcError('CONFLICT', 'File was modified outside orrery since it was loaded')
        }
      }
      const tmp = path.join(
        path.dirname(filePath),
        `.${path.basename(filePath)}.${randomUUID()}.tmp`
      )
      await fs.writeFile(tmp, content, 'utf-8')
      await fs.rename(tmp, filePath)
      const stat = await fs.stat(filePath)
      return { path: filePath, mtimeMs: stat.mtimeMs }
    } catch (err) {
      throw toIpcError(err)
    }
  }

  /** Read a directory tree recursively. Files sorted after directories, both alphabetical. */
  async readTree(dirPath: string): Promise<FileNode> {
    try {
      const name = path.basename(dirPath)
      return { name, path: dirPath, kind: 'directory', children: await this.readChildren(dirPath) }
    } catch (err) {
      throw toIpcError(err)
    }
  }

  private async readChildren(dirPath: string): Promise<FileNode[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const nodes: FileNode[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue
      const full = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        nodes.push({
          name: entry.name,
          path: full,
          kind: 'directory',
          children: await this.readChildren(full)
        })
      } else if (entry.isFile()) {
        nodes.push({ name: entry.name, path: full, kind: 'file' })
      }
    }
    nodes.sort((a, b) =>
      a.kind !== b.kind
        ? a.kind === 'directory'
          ? -1
          : 1
        : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    )
    return nodes
  }

  async createFile(dirPath: string, name: string): Promise<FileNode> {
    try {
      const full = path.join(dirPath, name)
      await fs.writeFile(full, '', { flag: 'wx' })
      return { name: path.basename(full), path: full, kind: 'file' }
    } catch (err) {
      throw toIpcError(err)
    }
  }

  /**
   * Create the note if it's missing, along with any parent folders, and report
   * whether it had to. Existing files are never touched — a daily note you
   * already wrote in must survive being "opened" again.
   */
  async ensureFile(target: string, content: string): Promise<{ path: string; created: boolean }> {
    try {
      await fs.access(target)
      return { path: target, created: false }
    } catch {
      // not there yet — fall through and create it
    }
    try {
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, content, { flag: 'wx' })
      return { path: target, created: true }
    } catch (err) {
      // A racing writer got there first: treat as existing rather than failing.
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        return { path: target, created: false }
      }
      throw toIpcError(err)
    }
  }

  /**
   * File a pasted or dropped asset into the vault. Never overwrites: a name
   * already in use gets a numbered variant, because losing an image someone
   * pasted earlier is not a recoverable mistake.
   */
  async writeAsset(dirPath: string, name: string, base64: string): Promise<{ path: string }> {
    try {
      await fs.mkdir(dirPath, { recursive: true })
      const ext = path.extname(name)
      const stem = path.basename(name, ext)
      for (let attempt = 0; attempt < 100; attempt++) {
        const candidate = path.join(dirPath, attempt === 0 ? name : `${stem}-${attempt}${ext}`)
        try {
          await fs.writeFile(candidate, Buffer.from(base64, 'base64'), { flag: 'wx' })
          return { path: candidate }
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
        }
      }
      throw new Error('Could not find a free asset name')
    } catch (err) {
      throw toIpcError(err)
    }
  }

  async createDirectory(dirPath: string, name: string): Promise<FileNode> {
    try {
      const full = path.join(dirPath, name)
      await fs.mkdir(full)
      return { name: path.basename(full), path: full, kind: 'directory', children: [] }
    } catch (err) {
      throw toIpcError(err)
    }
  }

  async rename(oldPath: string, newName: string): Promise<string> {
    try {
      const newPath = path.join(path.dirname(oldPath), newName)
      await fs.access(newPath).then(
        () => {
          throw new IpcError('EEXIST', 'A file with that name already exists')
        },
        () => undefined
      )
      await fs.rename(oldPath, newPath)
      return newPath
    } catch (err) {
      throw toIpcError(err)
    }
  }

  async trash(targetPath: string): Promise<void> {
    try {
      await shell.trashItem(targetPath)
    } catch (err) {
      throw toIpcError(err)
    }
  }
}
