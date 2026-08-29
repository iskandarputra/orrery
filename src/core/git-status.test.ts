import { describe, expect, it } from 'vitest'
import { parseGitStatus, stagedChanges, unstagedChanges } from './git-status'

/** Build a NUL-separated payload the way `--porcelain=v2 -z` emits one. */
const z = (...entries: string[]): string => entries.join('\0') + '\0'

describe('parseGitStatus: branch header', () => {
  it('reads the branch, upstream and ahead/behind counts', () => {
    const s = parseGitStatus(
      z(
        '# branch.oid abc123',
        '# branch.head main',
        '# branch.upstream origin/main',
        '# branch.ab +3 -2'
      )
    )
    expect(s.branch).toBe('main')
    expect(s.upstream).toBe('origin/main')
    expect(s.ahead).toBe(3)
    expect(s.behind).toBe(2)
  })

  it('reports a detached HEAD as no branch', () => {
    expect(parseGitStatus(z('# branch.head (detached)')).branch).toBeNull()
  })

  it('defaults to zero ahead/behind with no upstream', () => {
    const s = parseGitStatus(z('# branch.head main'))
    expect(s).toMatchObject({ upstream: null, ahead: 0, behind: 0 })
  })

  it('keeps a branch name containing a slash', () => {
    expect(parseGitStatus(z('# branch.head feat/code-files')).branch).toBe('feat/code-files')
  })
})

describe('parseGitStatus: ordinary changes', () => {
  const ordinary = (xy: string, path: string): string =>
    `1 ${xy} N... 100644 100644 100644 aaaa bbbb ${path}`

  it('separates the staged side from the working-tree side', () => {
    const s = parseGitStatus(z(ordinary('M.', 'staged-only.md')))
    expect(s.changes[0]).toEqual({ path: 'staged-only.md', staged: 'modified', unstaged: null })
  })

  it('reads a working-tree-only modification', () => {
    const s = parseGitStatus(z(ordinary('.M', 'dirty.md')))
    expect(s.changes[0]).toEqual({ path: 'dirty.md', staged: null, unstaged: 'modified' })
  })

  it('reads a file changed on both sides', () => {
    const s = parseGitStatus(z(ordinary('MM', 'both.md')))
    expect(s.changes[0]).toMatchObject({ staged: 'modified', unstaged: 'modified' })
  })

  it('maps every status letter it is meant to', () => {
    const s = parseGitStatus(
      z(ordinary('A.', 'a.md'), ordinary('D.', 'd.md'), ordinary('T.', 't.md'))
    )
    expect(s.changes.map((c) => c.staged)).toEqual(['added', 'deleted', 'modified'])
  })

  it('keeps a path containing spaces intact', () => {
    const s = parseGitStatus(z(ordinary('.M', 'notes/a file with spaces.md')))
    expect(s.changes[0]!.path).toBe('notes/a file with spaces.md')
  })
})

describe('parseGitStatus: untracked, ignored and unmerged', () => {
  it('reports untracked files as unstaged', () => {
    const s = parseGitStatus(z('? new.md', '? has space.md'))
    expect(s.changes).toEqual([
      { path: 'new.md', staged: null, unstaged: 'untracked' },
      { path: 'has space.md', staged: null, unstaged: 'untracked' }
    ])
  })

  it('never surfaces ignored files', () => {
    expect(parseGitStatus(z('! node_modules/x.md')).changes).toEqual([])
  })

  it('reports an unmerged file as conflicted', () => {
    const s = parseGitStatus(z('u UU N... 100644 100644 100644 100644 aaa bbb ccc conflicted.md'))
    expect(s.changes[0]).toEqual({ path: 'conflicted.md', staged: null, unstaged: 'conflicted' })
  })
})

describe('parseGitStatus: renames', () => {
  it('takes the original path from the following entry', () => {
    const s = parseGitStatus(
      z('2 R. N... 100644 100644 100644 aaaa bbbb R100 new-name.md', 'old-name.md')
    )
    expect(s.changes[0]).toEqual({
      path: 'new-name.md',
      staged: 'renamed',
      unstaged: null,
      from: 'old-name.md'
    })
  })

  it('does not mistake the original path for another change', () => {
    const s = parseGitStatus(
      z('2 R. N... 100644 100644 100644 aaaa bbbb R100 new.md', 'old.md', '? after.md')
    )
    expect(s.changes).toHaveLength(2)
    expect(s.changes[1]!.path).toBe('after.md')
  })
})

describe('parseGitStatus: robustness', () => {
  it('returns an empty status for empty output', () => {
    expect(parseGitStatus('')).toMatchObject({ branch: null, changes: [] })
  })

  it('ignores a trailing separator rather than inventing a change', () => {
    expect(parseGitStatus('? a.md\0').changes).toHaveLength(1)
  })
})

describe('grouping', () => {
  const sample = parseGitStatus(
    z(
      '1 M. N... 100644 100644 100644 a b staged.md',
      '1 .M N... 100644 100644 100644 a b dirty.md',
      '1 MM N... 100644 100644 100644 a b both.md',
      '? new.md'
    )
  )

  it('lists everything with a staged side', () => {
    expect(stagedChanges(sample).map((c) => c.path)).toEqual(['staged.md', 'both.md'])
  })

  it('lists everything with unstaged work, untracked included', () => {
    expect(unstagedChanges(sample).map((c) => c.path)).toEqual(['dirty.md', 'both.md', 'new.md'])
  })

  it('shows a partially staged file in both groups', () => {
    const paths = (fn: typeof stagedChanges): string[] => fn(sample).map((c) => c.path)
    expect(paths(stagedChanges)).toContain('both.md')
    expect(paths(unstagedChanges)).toContain('both.md')
  })
})
