import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { prune, shouldSnapshot, type Snapshot } from '@core/history'
import { toIpcError } from '../ipc/errors'

/** Versions kept per note, and for how long. */
const KEEP_PER_NOTE = 50
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000

/**
 * Local version history for notes.
 *
 * Snapshots live under userData, not beside the notes: a vault is the user's
 * own folder, often in a synced directory or a git repo, and quietly filling it
 * with hidden version files would be rude and confusing.
 */
export class HistoryService {
  constructor(private userDataDir: string) {}

  private folderFor(notePath: string): string {
    const hash = createHash('sha1').update(notePath).digest('hex').slice(0, 16)
    return path.join(this.userDataDir, 'history', hash)
  }

  private async entries(notePath: string): Promise<Snapshot[]> {
    const dir = this.folderFor(notePath)
    let names: string[]
    try {
      names = await fs.readdir(dir)
    } catch {
      return []
    }
    const found: Snapshot[] = []
    for (const name of names) {
      if (!name.endsWith('.md')) continue
      const at = Number(name.slice(0, -3))
      if (!Number.isFinite(at)) continue
      try {
        const stat = await fs.stat(path.join(dir, name))
        found.push({ id: name.slice(0, -3), at, bytes: stat.size })
      } catch {
        // vanished between listing and stat
      }
    }
    return found.sort((a, b) => b.at - a.at)
  }

  /** Versions of a note, newest first. */
  async list(notePath: string): Promise<Snapshot[]> {
    return this.entries(notePath)
  }

  async read(notePath: string, id: string): Promise<string> {
    try {
      return await fs.readFile(path.join(this.folderFor(notePath), `${id}.md`), 'utf-8')
    } catch (err) {
      throw toIpcError(err)
    }
  }

  /**
   * Record a version if this save deserves one, then trim old ones. Returns
   * whether a version was written, so a caller can say so.
   */
  async record(notePath: string, content: string, now = Date.now()): Promise<boolean> {
    const existing = await this.entries(notePath)
    const newest = existing[0]
    const last = newest
      ? { content: await this.read(notePath, newest.id).catch(() => ''), at: newest.at }
      : null

    if (!shouldSnapshot({ last, next: content, now })) return false

    const dir = this.folderFor(notePath)
    try {
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(path.join(dir, `${now}.md`), content, 'utf-8')
    } catch (err) {
      throw toIpcError(err)
    }

    const stale = prune([{ id: String(now), at: now, bytes: content.length }, ...existing], {
      keep: KEEP_PER_NOTE,
      maxAgeMs: MAX_AGE_MS,
      now
    })
    await Promise.all(
      stale.map((snapshot) =>
        fs.unlink(path.join(dir, `${snapshot.id}.md`)).catch(() => undefined)
      )
    )
    return true
  }
}
