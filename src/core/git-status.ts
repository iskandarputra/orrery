/**
 * Parsing `git status --porcelain=v2 -z --branch`.
 *
 * Porcelain v2 is the format git documents as stable for scripts, and `-z`
 * makes it NUL-separated so a path containing a newline, a quote or a tab is
 * carried verbatim rather than escaped. A vault is full of such names.
 *
 * Kept free of processes so the parsing — which is where the bugs live — can be
 * tested against captured output.
 */

/** What happened to a file, on one side of the index. */
export type GitFileState =
  'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'conflicted'

export interface GitChange {
  /** Repository-relative, exactly as git reports it. */
  path: string
  /** Change staged for the next commit, or null when the index matches HEAD. */
  staged: GitFileState | null
  /** Change in the working tree, or null when it matches the index. */
  unstaged: GitFileState | null
  /** Where a renamed or copied file came from. */
  from?: string
}

export interface GitStatus {
  /** Null on a detached HEAD, or before the first commit on some gits. */
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  changes: GitChange[]
}

export const EMPTY_STATUS: GitStatus = {
  branch: null,
  upstream: null,
  ahead: 0,
  behind: 0,
  changes: []
}

/** The XY letters in porcelain v2; `.` means "unchanged on this side". */
function stateOf(code: string): GitFileState | null {
  switch (code) {
    case 'M':
      return 'modified'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    // `T` is a type change (file → symlink). It is a modification as far as
    // anything the UI does with it is concerned.
    case 'T':
      return 'modified'
    default:
      return null
  }
}

export function parseGitStatus(stdout: string): GitStatus {
  const status: GitStatus = { ...EMPTY_STATUS, changes: [] }
  // Trailing NUL leaves an empty final entry; drop empties rather than special-case.
  const entries = stdout.split('\0').filter((e) => e.length > 0)

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!

    if (entry.startsWith('# ')) {
      const [, key, ...rest] = entry.split(' ')
      const value = rest.join(' ')
      if (key === 'branch.head') status.branch = value === '(detached)' ? null : value
      else if (key === 'branch.upstream') status.upstream = value
      else if (key === 'branch.ab') {
        // "+3 -2"
        const ahead = /\+(\d+)/.exec(value)
        const behind = /-(\d+)/.exec(value)
        status.ahead = ahead ? Number(ahead[1]) : 0
        status.behind = behind ? Number(behind[1]) : 0
      }
      continue
    }

    const kind = entry[0]

    if (kind === '?') {
      status.changes.push({ path: entry.slice(2), staged: null, unstaged: 'untracked' })
      continue
    }
    if (kind === '!') continue // ignored; never shown

    if (kind === 'u') {
      // Unmerged. The XY pair describes both sides of the conflict; for the UI
      // it is one state, and it is never partially stageable.
      const path = entry.split(' ').slice(10).join(' ')
      status.changes.push({ path, staged: null, unstaged: 'conflicted' })
      continue
    }

    if (kind === '1' || kind === '2') {
      const fields = entry.split(' ')
      const xy = fields[1] ?? '..'
      // `1` has 8 leading fields before the path; `2` has 9 (it adds a rename
      // score), and its original path follows in the *next* NUL entry.
      const leading = kind === '1' ? 8 : 9
      const path = fields.slice(leading).join(' ')
      const change: GitChange = {
        path,
        staged: stateOf(xy[0] ?? '.'),
        unstaged: stateOf(xy[1] ?? '.')
      }
      if (kind === '2') {
        const from = entries[i + 1]
        if (from !== undefined) {
          change.from = from
          i++ // consume it
        }
      }
      status.changes.push(change)
      continue
    }
  }

  return status
}

/** Files whose staged change would go into the next commit. */
export function stagedChanges(status: GitStatus): GitChange[] {
  return status.changes.filter((c) => c.staged !== null)
}

/** Files with work not yet staged, including untracked and conflicted ones. */
export function unstagedChanges(status: GitStatus): GitChange[] {
  return status.changes.filter((c) => c.unstaged !== null)
}
