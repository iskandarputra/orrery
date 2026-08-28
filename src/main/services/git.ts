import { execFile } from 'node:child_process'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import { parseDiffHunks, type LineChange } from '@core/git-diff'

const run = promisify(execFile)

/** A diff this large is not something a gutter can usefully draw. */
const MAX_OUTPUT = 2 * 1024 * 1024
/** Git on a cold cache is slow; a hung one must not wedge the editor. */
const TIMEOUT_MS = 5000

/**
 * Line-level git status for a single file, for the editor gutter.
 *
 * `execFile` with an argument vector, never `exec` and never a shell: a file
 * path is user data, and the vault is full of names with spaces, quotes and
 * `$` in them.
 *
 * Every failure means the same thing to the caller — draw no gutter — so they
 * collapse to an empty result rather than an error: no git on PATH, not a
 * repository, a file outside the work tree, an untracked file, a timeout.
 */
export class GitService {
  async fileChanges(filePath: string): Promise<LineChange[]> {
    try {
      const { stdout } = await run(
        'git',
        [
          '--no-pager',
          'diff',
          '--no-color',
          '--no-ext-diff',
          // No context lines: the hunk headers alone carry what a gutter needs.
          '-U0',
          '--',
          filePath
        ],
        { cwd: dirname(filePath), timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT }
      )
      return parseDiffHunks(stdout)
    } catch {
      return []
    }
  }
}
