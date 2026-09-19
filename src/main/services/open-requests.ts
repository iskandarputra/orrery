import { promises as fsp } from 'node:fs'
import type { OpenRequest } from '@shared/types'

/** Hand the request to the window. False when there is no window to hand it to. */
export type Deliver = (request: OpenRequest) => boolean

/**
 * Paths the operating system asked us to open, held until somebody can show
 * them.
 *
 * On a cold start nobody can. `app:openPath` is a push, and the renderer only
 * subscribes to it part way through its own boot, so a file double-clicked
 * while the app was not running is sent into a window that is not listening
 * yet and is simply lost. The renderer pulls instead, with `app:takeOpenPaths`,
 * once it is ready.
 *
 * The ordering is the other half of it. `openPaths` activates the last file it
 * opens, so delivering the double-clicked file before the session restore
 * would put it behind whichever tab was open when the app was last quit: the
 * file *is* open, in a tab nobody can see, which reads as the same bug. The
 * renderer therefore takes this queue at the end of its restore, not the
 * start.
 *
 * Once it has taken once, the window exists and is listening, so everything
 * after that (a second instance, Finder's `open-file`) is pushed straight
 * through.
 */
export class OpenRequests {
  private pending: OpenRequest = { files: [], folders: [] }
  /** Set by the first `take`: from then on there is a renderer to push to. */
  private listening = false

  constructor(private readonly deliver: Deliver) {}

  /** Queue what was asked for, or deliver it if there is anywhere to put it. */
  async request(paths: readonly string[]): Promise<void> {
    const request = await classify(paths)
    if (request.files.length === 0 && request.folders.length === 0) return
    if (this.listening && this.deliver(request)) return
    // No window: the last one was closed, or this is the cold start. Back in
    // the queue, and the next renderer to boot takes it.
    this.listening = false
    this.pending.files.push(...request.files)
    this.pending.folders.push(...request.folders)
  }

  /** The renderer, at the end of its restore, asking what the launch wanted. */
  take(): OpenRequest {
    const taken = this.pending
    this.pending = { files: [], folders: [] }
    this.listening = true
    return taken
  }
}

/**
 * File or folder, and neither if it is gone.
 *
 * A path that no longer exists is dropped here rather than opened: a stale
 * argument should cost nothing, and `openPaths` logging an ENOENT it could not
 * have avoided is not something anybody can act on.
 */
async function classify(paths: readonly string[]): Promise<OpenRequest> {
  const request: OpenRequest = { files: [], folders: [] }
  // In order, one at a time. `openPaths` shows the last file it is given, so
  // which of several arguments ends up on screen is decided here; racing the
  // stats would decide it by whichever disk answered first.
  for (const path of paths) {
    try {
      const stats = await fsp.stat(path)
      if (stats.isDirectory()) request.folders.push(path)
      else if (stats.isFile()) request.files.push(path)
    } catch {
      console.warn('Asked to open something that is not there:', path)
    }
  }
  return request
}
