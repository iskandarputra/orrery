import { randomUUID } from 'node:crypto'
import chokidar, { type FSWatcher } from 'chokidar'
import type { FsEvent, FsEventKind } from '@shared/types'

type Listener = (watchId: string, events: FsEvent[]) => void

const DEBOUNCE_MS = 120

/**
 * Watches folders with chokidar and coalesces bursts of raw events into a
 * single debounced batch per watch id (observer pattern: chokidar -> this
 * service -> IPC push -> renderer store).
 *
 * Only the directories somebody is actually looking at, one level each. A
 * recursive watch on a folder like `~/Documents` means tens of thousands of
 * inotify handles and an initial scan that walks every file in it — measured on
 * one, chokidar had not finished after a minute, and the app it is supposed to
 * be serving spends that minute competing with it for the disk. What the app
 * needs to know about is the tree it has loaded and the files it has open, and
 * `setPaths` keeps the watch to exactly that as directories are opened and
 * closed.
 */
export class WatcherService {
  private watchers = new Map<string, FSWatcher>()
  private watched = new Map<string, Set<string>>()
  private pending = new Map<string, Map<string, FsEvent>>()
  private timers = new Map<string, NodeJS.Timeout>()

  constructor(private onBatch: Listener) {}

  async watch(dirPath: string): Promise<string> {
    const watchId = randomUUID()
    const watcher = chokidar.watch(dirPath, {
      ignored: (p, stats) =>
        /(^|[\\/])(\.git|node_modules|\.svn|\.hg)([\\/]|$)/.test(p) ||
        (!!stats?.isFile() && /(^|[\\/])\..*\.tmp$/.test(p)),
      ignoreInitial: true,
      // This directory's own entries and no deeper. Depth is what keeps a watch
      // proportional to what is on screen rather than to what is on disk.
      depth: 0,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
    })
    const push = (kind: FsEventKind, isDirectory: boolean) => (path: string) =>
      this.enqueue(watchId, { kind, path, isDirectory })
    watcher
      .on('add', push('created', false))
      .on('addDir', push('created', true))
      .on('change', push('changed', false))
      .on('unlink', push('removed', false))
      .on('unlinkDir', push('removed', true))
      // A vault can easily contain something this user cannot read — a config
      // directory belonging to another program, a mount that has gone away.
      // Without a listener chokidar's error event is an unhandled 'error' on an
      // EventEmitter, which throws, and one unreadable file takes the whole
      // watch down with it.
      .on('error', () => undefined)
    this.watchers.set(watchId, watcher)
    this.watched.set(watchId, new Set([dirPath]))
    return watchId
  }

  /**
   * Watch exactly these directories, and stop watching the rest.
   *
   * The renderer sends the set it cares about — the vault root plus whichever
   * directories are open in the tree — whenever it changes. Diffed rather than
   * torn down and rebuilt, because re-adding a directory means chokidar reads
   * it again.
   */
  setPaths(watchId: string, paths: readonly string[]): void {
    const watcher = this.watchers.get(watchId)
    const current = this.watched.get(watchId)
    if (!watcher || !current) return

    const wanted = new Set(paths)
    for (const dir of current) {
      if (!wanted.has(dir)) {
        watcher.unwatch(dir)
        current.delete(dir)
      }
    }
    for (const dir of wanted) {
      if (!current.has(dir)) {
        watcher.add(dir)
        current.add(dir)
      }
    }
  }

  async unwatch(watchId: string): Promise<void> {
    const watcher = this.watchers.get(watchId)
    this.watchers.delete(watchId)
    this.watched.delete(watchId)
    const timer = this.timers.get(watchId)
    if (timer) clearTimeout(timer)
    this.timers.delete(watchId)
    this.pending.delete(watchId)
    await watcher?.close()
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.watchers.keys()].map((id) => this.unwatch(id)))
  }

  private enqueue(watchId: string, event: FsEvent): void {
    if (!this.watchers.has(watchId)) return
    let batch = this.pending.get(watchId)
    if (!batch) {
      batch = new Map()
      this.pending.set(watchId, batch)
    }
    // Latest event per path wins within a batch.
    batch.set(event.path, event)
    const existing = this.timers.get(watchId)
    if (existing) clearTimeout(existing)
    this.timers.set(
      watchId,
      setTimeout(() => {
        this.timers.delete(watchId)
        const events = [...(this.pending.get(watchId)?.values() ?? [])]
        this.pending.delete(watchId)
        if (events.length > 0) this.onBatch(watchId, events)
      }, DEBOUNCE_MS)
    )
  }
}
