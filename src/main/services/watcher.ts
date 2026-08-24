import { randomUUID } from 'node:crypto'
import chokidar, { type FSWatcher } from 'chokidar'
import type { FsEvent, FsEventKind } from '@shared/types'

type Listener = (watchId: string, events: FsEvent[]) => void

const DEBOUNCE_MS = 120

/**
 * Watches folders with chokidar and coalesces bursts of raw events into a
 * single debounced batch per watch id (observer pattern: chokidar -> this
 * service -> IPC push -> renderer store).
 */
export class WatcherService {
  private watchers = new Map<string, FSWatcher>()
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
    this.watchers.set(watchId, watcher)
    return watchId
  }

  async unwatch(watchId: string): Promise<void> {
    const watcher = this.watchers.get(watchId)
    this.watchers.delete(watchId)
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
