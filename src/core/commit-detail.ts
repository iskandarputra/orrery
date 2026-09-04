/**
 * What one commit did, parsed from `git show --name-status`.
 *
 * The graph shows a subject line and nothing else, which is enough to find a
 * commit and never enough to decide anything about it. This is the rest: the
 * body of the message, and which files it touched.
 */

import type { DiffStat } from './git-numstat'

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'unknown'

export interface CommitFile {
  path: string
  /** Where it came from, for a rename or a copy. */
  from: string | null
  status: FileStatus
  /**
   * How many lines it changed, when the counts could be read.
   *
   * Optional because they come from a second command: `--name-status` says
   * what happened to a file and `--numstat` says how much, and a commit whose
   * counts cannot be read should still list its files.
   */
  stat?: DiffStat
}

export interface CommitDetail {
  /** The message below the subject line, trimmed. Empty for most commits. */
  body: string
  files: CommitFile[]
}

export const EMPTY_COMMIT_DETAIL: CommitDetail = { body: '', files: [] }

const STATUS: Record<string, FileStatus> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'modified' // a type change reads as a modification to anyone looking
}

/**
 * Parse `git show --name-status -z --format=%b`.
 *
 * `-z` because a path may contain anything at all, newlines included, and the
 * newline-delimited form quotes those in a way that has to be un-quoted again.
 * NUL separation avoids the question.
 *
 * The record is: body, then for each file a status field and one path, or two
 * paths when the status is a rename or a copy.
 */
export function parseCommitDetail(stdout: string): CommitDetail {
  const fields = stdout.split('\0')
  const body = (fields.shift() ?? '').trim()

  const files: CommitFile[] = []
  while (fields.length > 0) {
    // Trimmed because git separates the message from the file list with a
    // blank line, which arrives attached to the first status field as "\nA".
    const raw = fields.shift()!.trim()
    if (raw === '') continue
    // `R100`, `C075`: the letter is the status, the digits a similarity score.
    const letter = raw[0]!
    const status = STATUS[letter] ?? 'unknown'
    const renamed = letter === 'R' || letter === 'C'
    const first = fields.shift()
    // Truncated output, or the trailing NUL git ends the record with: either
    // way there is no path here, and a file named "" helps nobody.
    if (!first) break
    if (renamed) {
      const second = fields.shift()
      if (!second) break
      files.push({ path: second, from: first, status })
    } else {
      files.push({ path: first, from: null, status })
    }
  }
  return { body, files }
}

/** The single letter shown beside a file, matching the status column. */
export function statusLetter(status: FileStatus): string {
  return { added: 'A', modified: 'M', deleted: 'D', renamed: 'R', copied: 'C', unknown: '?' }[
    status
  ]
}
