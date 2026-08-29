import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { parseDiffHunks, type LineChange } from '@core/git-diff'
import { EMPTY_STATUS, parseGitStatus, type GitStatus } from '@core/git-status'
import { EMPTY_DIFF, parseUnifiedDiff, type FileDiff } from '@core/unified-diff'
import { parseGitLog, type Commit } from '@core/git-graph'
import { EMPTY_COMMIT_DETAIL, parseCommitDetail, type CommitDetail } from '@core/commit-detail'

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
  /**
   * Run git inside a working tree.
   *
   * Always `execFile` with an argument vector, never a shell: paths and commit
   * messages are user data, and a vault is full of names with spaces, quotes
   * and `$` in them.
   */
  private async git(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await run('git', ['--no-pager', ...args], {
      cwd,
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT
    })
    return stdout
  }

  /**
   * Working-tree status for the whole repository.
   *
   * Resolves to an empty status rather than throwing when git cannot answer —
   * no git installed, not a repository, a timeout. The panel then shows nothing
   * rather than an error, which is the honest rendering of "there is no
   * repository here".
   */
  async status(rootPath: string): Promise<GitStatus> {
    try {
      // -z so paths with newlines or quotes arrive verbatim; --untracked-files=all
      // so a new folder lists its files rather than just itself.
      const stdout = await this.git(rootPath, [
        'status',
        '--porcelain=v2',
        '--branch',
        '-z',
        '--untracked-files=all'
      ])
      return parseGitStatus(stdout)
    } catch {
      return EMPTY_STATUS
    }
  }

  /**
   * The diff for one file, as the source-control panel shows it.
   *
   * `staged` picks which side to look at: the index against HEAD, or the
   * working tree against the index — the same split the panel groups by.
   *
   * An untracked file has nothing in git to compare against, so it is diffed
   * against /dev/null with `--no-index`, which renders it as an all-addition
   * file. That command exits 1 when there is a difference, which is the normal
   * case here, so its failure carries the output we want.
   */
  /**
   * The two sides of a diff, in full.
   *
   * A hunk only describes what changed, which is not enough to put two files
   * side by side — the unchanged stretches have to be rendered too. So the
   * whole of each side is read: for a staged diff that is HEAD against the
   * index, and for a working-tree diff the index against the file on disk.
   *
   * A missing side is empty rather than an error: that is exactly what an added
   * or deleted file looks like, and it is the common case, not a fault.
   */
  async fileContents(
    rootPath: string,
    path: string,
    staged: boolean,
    commit?: string
  ): Promise<{ old: string; new: string }> {
    const show = async (rev: string): Promise<string> => {
      try {
        return await this.git(rootPath, ['show', `${rev}:${path}`])
      } catch {
        return '' // not in that revision — an addition
      }
    }
    const worktree = async (): Promise<string> => {
      try {
        return await readFile(join(rootPath, path), 'utf8')
      } catch {
        return '' // deleted from the working tree
      }
    }
    // A commit is read against its own parent, which is what "what this commit
    // did" means. A root commit has no parent, so the old side is empty.
    if (commit) return { old: await show(`${commit}^`), new: await show(commit) }
    return staged
      ? { old: await show('HEAD'), new: await show('') }
      : { old: await show(''), new: await worktree() }
  }

  async fileDiff(
    rootPath: string,
    path: string,
    staged: boolean,
    commit?: string
  ): Promise<FileDiff> {
    const common = ['diff', '--no-color', '--no-ext-diff']
    if (commit) {
      try {
        return parseUnifiedDiff(
          await this.git(rootPath, ['show', '--no-color', '--format=', commit, '--', path])
        )
      } catch {
        return EMPTY_DIFF
      }
    }
    try {
      const stdout = await this.git(rootPath, [
        ...common,
        ...(staged ? ['--cached'] : []),
        '--',
        path
      ])
      if (stdout.trim()) return parseUnifiedDiff(stdout)
    } catch {
      return EMPTY_DIFF
    }

    // Empty output means either "tracked and unchanged" or "untracked", and
    // those need opposite answers: nothing at all, versus the whole file as an
    // addition. Asking git which it is costs one call and is the difference
    // between an empty diff and a spurious full-file one.
    if (staged) return EMPTY_DIFF
    try {
      const tracked = await this.git(rootPath, ['ls-files', '--', path])
      if (tracked.trim()) return EMPTY_DIFF
    } catch {
      return EMPTY_DIFF
    }
    try {
      await this.git(rootPath, [...common, '--no-index', '--', '/dev/null', path])
      return EMPTY_DIFF // identical to nothing: an empty file
    } catch (err) {
      const stdout = (err as { stdout?: string }).stdout
      return stdout ? parseUnifiedDiff(stdout) : EMPTY_DIFF
    }
  }

  /**
   * Recent commits across every branch, for the graph.
   *
   * Capped rather than unbounded: the graph is a view of where you are, and a
   * vault with years of history would otherwise pay to lay out thousands of
   * rows nobody scrolls to. Fields are separated by U+001F and commits by NUL,
   * so a subject containing any ordinary punctuation survives intact.
   */
  async log(rootPath: string, limit: number): Promise<Commit[]> {
    const format = ['%H', '%P', '%an', '%ar', '%D', '%s'].join('%x1f')
    try {
      const stdout = await this.git(rootPath, [
        'log',
        '--all',
        '-z',
        `--max-count=${limit}`,
        `--pretty=format:${format}`
      ])
      return parseGitLog(stdout)
    } catch {
      return []
    }
  }

  /**
   * What one commit did: the body of its message, and the files it touched.
   *
   * `-z` because a path may contain anything at all, newlines included, and the
   * newline-delimited form escapes those in a way that has to be undone again.
   */
  async commitDetail(rootPath: string, hash: string): Promise<CommitDetail> {
    try {
      return parseCommitDetail(
        await this.git(rootPath, ['show', '--name-status', '-z', '--format=%b', hash])
      )
    } catch {
      return EMPTY_COMMIT_DETAIL
    }
  }

  /**
   * Move the working tree to a commit or branch.
   *
   * Git refuses when the move would overwrite uncommitted work, and that
   * refusal is what protects the user here, so the error is allowed through to
   * be shown rather than swallowed like a status read.
   */
  async checkout(rootPath: string, ref: string): Promise<void> {
    await this.git(rootPath, ['checkout', ref])
  }

  /** A new branch at a commit, and switch to it. */
  async createBranch(rootPath: string, name: string, at: string): Promise<void> {
    await this.git(rootPath, ['checkout', '-b', name, at])
  }

  /**
   * Undo a commit by making another that reverses it.
   *
   * `--no-edit` because an editor cannot open from here; the default message
   * names the commit being reverted, which is what anyone would have written.
   */
  async revert(rootPath: string, hash: string): Promise<void> {
    await this.git(rootPath, ['revert', '--no-edit', hash])
  }

  /** Apply one commit's changes on top of the current branch. */
  async cherryPick(rootPath: string, hash: string): Promise<void> {
    await this.git(rootPath, ['cherry-pick', hash])
  }

  /** Whether this directory is inside a git work tree at all. */
  async isRepository(rootPath: string): Promise<boolean> {
    try {
      const out = await this.git(rootPath, ['rev-parse', '--is-inside-work-tree'])
      return out.trim() === 'true'
    } catch {
      return false
    }
  }

  /** Stage paths. `--` separates them from options, so a file named `-f` is safe. */
  async stage(rootPath: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return
    await this.git(rootPath, ['add', '--', ...paths])
  }

  /** Unstage paths, leaving the working tree untouched. */
  async unstage(rootPath: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return
    await this.git(rootPath, ['restore', '--staged', '--', ...paths])
  }

  /**
   * Throw away working-tree changes.
   *
   * Destructive and unrecoverable — git keeps no copy of what was discarded —
   * so the renderer confirms before calling this. An untracked file is deleted
   * rather than restored, since there is no version to restore it to.
   */
  async discard(rootPath: string, paths: string[], untracked: string[]): Promise<void> {
    if (paths.length > 0) await this.git(rootPath, ['restore', '--', ...paths])
    if (untracked.length > 0) await this.git(rootPath, ['clean', '-f', '--', ...untracked])
  }

  /**
   * Commit what is staged. Returns the message git printed, or null when it
   * refused — nothing staged, no identity configured, a hook rejecting it.
   */
  async commit(rootPath: string, message: string): Promise<string | null> {
    try {
      // The message goes through argv, so it is never interpreted by a shell.
      return (await this.git(rootPath, ['commit', '-m', message])).trim()
    } catch {
      return null
    }
  }

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
