/**
 * How much each file changed, as `git diff --numstat` reports it.
 *
 * The status letter says a file was modified; it does not say whether that
 * means a typo or a rewrite. Scanning a list of thirty changed files for the
 * two worth reading is the thing this answers, and it is the number every git
 * interface shows next to the name for exactly that reason.
 */

export interface DiffStat {
  insertions: number
  deletions: number
  /**
   * Git counts lines, and a binary file has none.
   *
   * Reported rather than folded into `0 / 0`, because "changed by nothing" and
   * "changed by an amount lines cannot express" are different answers and a
   * reader deserves to be told which one this is.
   */
  binary: boolean
}

/** Stats by repository-relative path, for one side of the working tree. */
export type DiffStatsByPath = Record<string, DiffStat>

/**
 * Both sides at once, because the panel draws both and a file can be on each —
 * staged in one shape and edited again into another.
 */
export interface DiffStats {
  staged: DiffStatsByPath
  unstaged: DiffStatsByPath
}

export const EMPTY_DIFF_STATS: DiffStats = { staged: {}, unstaged: {} }

/**
 * Parse `git diff --numstat -z`.
 *
 * `-z` because a path may contain anything at all, newlines included, and the
 * newline-delimited form escapes those in a way that has to be undone again.
 *
 * The shape is two counts and a path per record, NUL-terminated:
 *
 *     15<TAB>0<TAB>README.md<NUL>
 *
 * except for a rename or a copy, where the path field is *empty* and the two
 * paths follow as their own NUL-separated fields:
 *
 *     0<TAB>0<TAB><NUL>old/path.ts<NUL>new/path.ts<NUL>
 *
 * which is why this walks the fields with an index rather than mapping over
 * them. The new path is the one recorded: it is what the panel lists, and what
 * a reader is going to look for.
 *
 * A binary file reports `-` for both counts rather than a number.
 */
export function parseNumstat(stdout: string): DiffStatsByPath {
  const stats: DiffStatsByPath = {}
  const fields = stdout.split('\0')

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]
    // The trailing NUL leaves an empty final field, and a blank one anywhere
    // else is not a record either.
    if (!field) continue

    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(field)
    if (!match) continue

    let path = match[3]!
    if (path === '') {
      // A rename or copy: the two paths are the next two fields. Skipped over
      // together, so the `from` path is never mistaken for the next record.
      i += 2
      path = fields[i] ?? ''
      if (!path) continue
    }

    const binary = match[1] === '-' || match[2] === '-'
    stats[path] = {
      insertions: binary ? 0 : Number(match[1]),
      deletions: binary ? 0 : Number(match[2]),
      binary
    }
  }

  return stats
}

/**
 * The insertions an untracked file counts as.
 *
 * Git has nothing to diff a file it does not know against, so `--numstat` says
 * nothing about one — but every line in it is going to be an addition, and a
 * new file is often the largest thing in a list of changes. Leaving it blank
 * would hide exactly the entry the counts exist to find.
 *
 * A trailing newline ends the last line rather than starting another, which is
 * the same arithmetic `git diff --no-index` does against /dev/null.
 */
export function countLines(content: string): number {
  if (content === '') return 0
  let lines = 0
  for (let i = 0; i < content.length; i++) if (content[i] === '\n') lines++
  return content.endsWith('\n') ? lines : lines + 1
}
