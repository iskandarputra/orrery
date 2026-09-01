import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * Notes that have been written but never given a file.
 *
 * A new note starts as a buffer with no path. Until now, quitting with one open
 * put you in front of a dialog: "Save All" opened a file picker before the app
 * would close, and "Don't Save" threw the note away — and it really was thrown
 * away, because the session remembers tabs by path and an untitled note has
 * none. Two clicks from writing something to losing it.
 *
 * So an untitled note is kept here instead, and comes back with the app. It is
 * the same bargain Sublime and VS Code make: quitting is not a decision about
 * your work, and the question is asked when you close the note rather than when
 * you close the application.
 *
 * Only untitled notes. A note that already has a file is a different case — the
 * file on disk would go on saying something the app does not, indefinitely,
 * while search and backlinks read the file and not the buffer. There is nothing
 * to diverge from here: no file exists yet.
 *
 * One JSON file per note, under `drafts` in the application's data folder.
 * Together rather than in the settings file because a note is as long as
 * somebody wants it to be, and settings are read and rewritten constantly.
 */

export interface DraftNote {
  /** The buffer it was written in; also the name of the file it is kept in. */
  id: string
  /** Which untitled note this is: 1 is "Untitled", 2 is "Untitled 2". */
  n: number
  content: string
}

/**
 * Ids come from the renderer and become a path, so they are checked rather than
 * trusted: anything but a plain identifier is refused before it can climb out
 * of the folder.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

export class DraftNotes {
  constructor(private readonly dir: string) {}

  /** Every kept note, oldest first, so tabs come back in the order they were made. */
  async list(): Promise<DraftNote[]> {
    let names: string[]
    try {
      names = await fs.readdir(this.dir)
    } catch {
      // No folder yet is the ordinary case: nobody has left an unsaved note.
      return []
    }
    const drafts: DraftNote[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const id = name.slice(0, -'.json'.length)
      if (!SAFE_ID.test(id)) continue
      try {
        const raw: unknown = JSON.parse(await fs.readFile(path.join(this.dir, name), 'utf-8'))
        if (raw === null || typeof raw !== 'object') continue
        const { n, content } = raw as { n?: unknown; content?: unknown }
        if (typeof n !== 'number' || !Number.isFinite(n) || typeof content !== 'string') continue
        drafts.push({ id, n, content })
      } catch {
        // A note that cannot be read is one note lost, not a failed start.
      }
    }
    return drafts.sort((a, b) => a.n - b.n)
  }

  /** Keep what this note says now, replacing what it said before. */
  async put(draft: DraftNote): Promise<void> {
    if (!SAFE_ID.test(draft.id)) return
    await fs.mkdir(this.dir, { recursive: true })
    // Written beside and moved into place: a note is saved on a timer while
    // somebody types, and a process that stops mid-write would otherwise leave
    // half a file to be restored from.
    const target = this.fileFor(draft.id)
    const temporary = `${target}.writing`
    await fs.writeFile(temporary, JSON.stringify({ n: draft.n, content: draft.content }), 'utf-8')
    await fs.rename(temporary, target)
  }

  /** Forget it: the note has been given a file, or thrown away on purpose. */
  async forget(id: string): Promise<void> {
    if (!SAFE_ID.test(id)) return
    await fs.rm(this.fileFor(id), { force: true }).catch(() => undefined)
  }

  private fileFor(id: string): string {
    return path.join(this.dir, `${id}.json`)
  }
}
