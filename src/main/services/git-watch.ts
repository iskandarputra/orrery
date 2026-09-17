import { relative } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { isRepositoryState, isWatchedGitPath } from '@core/git-watch'

/** One commit writes the index, a ref, HEAD's log and more in a few ms. */
const SETTLE_MS = 150

/**
 * Tells the renderer when a repository's state moves, whoever moved it.
 *
 * A commit, a stage or a checkout made in a terminal, another editor or a git
 * client never touched a file the vault watch reports on, because that watch
 * leaves `.git` out, and rightly: most of what lands there is objects. So this
 * watches only the handful of files that record state (see `core/git-watch`),
 * in whichever directories git says hold it, and reports one change per burst.
 *
 * One repository at a time, because there is one window and one vault.
 */
export class GitWatchService {
  private watcher: FSWatcher | null = null
  private watching: { rootPath: string; dirs: string } | null = null
  private timer: NodeJS.Timeout | null = null
  /** Bumped per call, so a slower earlier call cannot install its watch last. */
  private generation = 0

  constructor(
    private readonly gitDirectories: (rootPath: string) => Promise<string[]>,
    private readonly onChange: (rootPath: string) => void,
    private readonly settleMs = SETTLE_MS
  ) {}

  /**
   * Watch this vault's repository, replacing any other.
   *
   * Cheap to call again with the same vault: git is asked where the state
   * lives, and nothing is rebuilt if the answer has not changed.
   */
  async watch(rootPath: string): Promise<void> {
    const generation = ++this.generation
    const dirs = await this.gitDirectories(rootPath)
    if (generation !== this.generation) return
    const key = dirs.join('\n')
    if (this.watching?.rootPath === rootPath && this.watching.dirs === key) return

    await this.stop()
    if (generation !== this.generation || dirs.length === 0) return

    const inside = (path: string, test: (rel: string) => boolean): boolean =>
      dirs.some((dir) => test(relative(dir, path)))
    const watcher = chokidar.watch(dirs, {
      ignoreInitial: true,
      ignored: (path) => !inside(path, isWatchedGitPath)
    })
    watcher
      .on('all', (_event, path) => {
        if (inside(path, isRepositoryState)) this.schedule(rootPath)
      })
      // A repository on a mount that goes away must not take main down with an
      // unhandled 'error' event.
      .on('error', () => undefined)
    this.watcher = watcher
    this.watching = { rootPath, dirs: key }
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const watcher = this.watcher
    this.watcher = null
    this.watching = null
    await watcher?.close()
  }

  async dispose(): Promise<void> {
    this.generation++
    await this.stop()
  }

  private schedule(rootPath: string): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.onChange(rootPath)
    }, this.settleMs)
  }
}
