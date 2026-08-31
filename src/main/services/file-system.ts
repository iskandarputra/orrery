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

  /**
   * The vault's top level, one directory deep.
   *
   * Deliberately not recursive. This used to read the whole tree before the
   * window could show anything, which is fine for a folder of notes and ruinous
   * for a folder like `~/Documents`: measured on one with 59,000 directories
   * and 365,000 files it took eight seconds of solid I/O and produced seventy
   * megabytes of JSON, all of which then crossed the process boundary and was
   * held in the renderer. A directory now arrives when somebody opens it.
   *
   * A directory that has not been read yet has no `children` at all, which is
   * how the tree tells "empty" from "not looked at".
   */
  async readTree(dirPath: string): Promise<FileNode> {
    try {
      const name = path.basename(dirPath)
      return { name, path: dirPath, kind: 'directory', children: await this.readDir(dirPath) }
    } catch (err) {
      throw toIpcError(err)
    }
  }

  /** One directory's entries, sorted: directories first, then files, alphabetically. */
  async readDir(dirPath: string): Promise<FileNode[]> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      const nodes: FileNode[] = []
      for (const entry of entries) {
        if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue
        const full = path.join(dirPath, entry.name)
        if (entry.isDirectory()) nodes.push({ name: entry.name, path: full, kind: 'directory' })
        else if (entry.isFile()) nodes.push({ name: entry.name, path: full, kind: 'file' })
      }
      nodes.sort((a, b) =>
        a.kind !== b.kind
          ? a.kind === 'directory'
            ? -1
            : 1
          : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      )
      return nodes
    } catch (err) {
      throw toIpcError(err)
    }
  }

  /**
   * Every file in the vault, as a flat list, for the things that need names
   * rather than shape: opening a file by name, resolving a wikilink, listing
   * the notes.
   *
   * Breadth-first and level-by-level in parallel, because the walk is I/O and
   * doing it one directory at a time wastes almost all of the wait: the same
   * 365,000-file folder takes 2.4 seconds this way against 8 serially, and
   * comes back as a list of strings rather than a tree of objects.
   *
   * Bounded, and honest about it. A folder large enough to hit the limit is a
   * folder where the index would cost more than it is worth, and the caller is
   * told so it can say so rather than quietly missing files.
   */
  async listFiles(root: string, limit: number): Promise<{ paths: string[]; truncated: boolean }> {
    const paths: string[] = []
    let truncated = false
    let level = [root]

    while (level.length > 0 && !truncated) {
      const next: string[] = []
      await Promise.all(
        level.map(async (dir) => {
          let entries
          try {
            entries = await fs.readdir(dir, { withFileTypes: true })
          } catch {
            return // unreadable directory — skipped, not fatal
          }
          for (const entry of entries) {
            if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) next.push(full)
            else if (entry.isFile()) {
              if (paths.length >= limit) {
                truncated = true
                return
              }
              paths.push(full)
            }
          }
        })
      )
      level = next
    }
    return { paths, truncated }
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
   * Write bytes over a file, with the same conflict check text saves use.
   *
   * Temp file and rename, so a save that fails halfway leaves the original
   * document intact rather than a truncated one — which for the only copy of a
   * signed contract is the difference between an inconvenience and a loss.
   */
  async writeBytes(
    filePath: string,
    bytes: Uint8Array,
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
      await fs.writeFile(tmp, bytes)
      await fs.rename(tmp, filePath)
      const stat = await fs.stat(filePath)
      return { path: filePath, mtimeMs: stat.mtimeMs }
    } catch (err) {
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
