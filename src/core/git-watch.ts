/**
 * Which files inside a git directory say that status or history has moved.
 *
 * The source control panel read status when it opened and when a button in it
 * was pressed, and at no other time, so a commit made in a terminal left it
 * showing the files as changed until someone pressed Refresh. The directory
 * that records those operations is `.git`, and almost none of it matters for
 * that question: `objects/` is where most of its writes land and says nothing
 * a status or a log would show, and watching it means a handle per pack.
 *
 * Paths are relative to the git directory, with either separator.
 */

/** Files at the top of a git directory whose change moves status or history. */
const STATE_FILES = new Set([
  // The branch or commit checked out.
  'HEAD',
  // What is staged.
  'index',
  // Branches and tags once git has packed them, which it does on its own.
  'packed-refs',
  // Operations in progress, which change what a commit would do.
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD'
])

function normalise(relative: string): string {
  return relative.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

/**
 * Whether a change to this file means status or history may now read
 * differently.
 *
 * A lock file is never it. Git writes `index.lock` and renames it over
 * `index`, so the change worth hearing about is the rename, and the lock
 * itself appears and vanishes on every read that refreshes the index.
 */
export function isRepositoryState(relative: string): boolean {
  const path = normalise(relative)
  if (path.endsWith('.lock')) return false
  if (STATE_FILES.has(path)) return true
  // Branches, tags, remote-tracking branches and the stash, loose.
  return path.startsWith('refs/')
}

/**
 * Whether a watch on the git directory should look at this path at all.
 *
 * The state files above, and the directories that lead to them: the git
 * directory itself and `refs`. Everything else is left unwatched rather than
 * watched and filtered, so the watch never walks `objects/`.
 */
export function isWatchedGitPath(relative: string): boolean {
  const path = normalise(relative)
  if (path === '' || path === 'refs') return true
  // Outside the git directory altogether.
  if (path === '..' || path.startsWith('../')) return false
  return isRepositoryState(path)
}
