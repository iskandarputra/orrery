import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GitService } from './git'

/**
 * Exercised against a real repository, not fixture strings.
 *
 * The parser has its own unit tests over captured output; these prove the
 * service asks git the right questions and that git's real answers still parse
 * — the half a fixture can never check.
 */
let repo: string
const git = new GitService()

const run = (...args: string[]): void => {
  execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
}
const write = (rel: string, body: string): void => {
  const path = join(repo, rel)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, body, 'utf-8')
}
const pathsOf = (changes: { path: string }[]): string[] => changes.map((c) => c.path).sort()

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'orrery-git-'))
  run('init', '-q', '.')
  run('config', 'user.email', 'test@example.com')
  run('config', 'user.name', 'Test')
  run('config', 'commit.gpgsign', 'false')
  write('base.md', 'original\n')
  run('add', '.')
  run('commit', '-qm', 'base')
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('isRepository', () => {
  it('recognises a work tree', async () => {
    expect(await git.isRepository(repo)).toBe(true)
  })

  it('says no for a plain directory', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'orrery-plain-'))
    expect(await git.isRepository(plain)).toBe(false)
    rmSync(plain, { recursive: true, force: true })
  })
})

describe('status', () => {
  it('is clean right after a commit', async () => {
    const s = await git.status(repo)
    expect(s.changes).toEqual([])
    expect(s.branch).toBeTruthy()
  })

  it('sees an unstaged modification', async () => {
    write('base.md', 'changed\n')
    const s = await git.status(repo)
    expect(s.changes).toEqual([{ path: 'base.md', staged: null, unstaged: 'modified' }])
  })

  it('sees an untracked file, including one with spaces in its name', async () => {
    write('a new note.md', 'hi\n')
    const s = await git.status(repo)
    expect(pathsOf(s.changes)).toEqual(['a new note.md'])
    expect(s.changes[0]!.unstaged).toBe('untracked')
  })

  it('lists files inside a new folder rather than the folder', async () => {
    write('nested/deep.md', 'hi\n')
    expect(pathsOf((await git.status(repo)).changes)).toEqual(['nested/deep.md'])
  })

  it('distinguishes staged from unstaged work on the same file', async () => {
    write('base.md', 'staged change\n')
    run('add', 'base.md')
    write('base.md', 'and more, unstaged\n')
    const change = (await git.status(repo)).changes[0]!
    expect(change).toMatchObject({ path: 'base.md', staged: 'modified', unstaged: 'modified' })
  })

  it('reports a deletion', async () => {
    rmSync(join(repo, 'base.md'))
    expect((await git.status(repo)).changes[0]).toMatchObject({ unstaged: 'deleted' })
  })

  it('returns an empty status outside a repository instead of throwing', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'orrery-plain-'))
    expect(await git.status(plain)).toMatchObject({ branch: null, changes: [] })
    rmSync(plain, { recursive: true, force: true })
  })
})

describe('stage and unstage', () => {
  it('stages a file', async () => {
    write('base.md', 'changed\n')
    await git.stage(repo, ['base.md'])
    expect((await git.status(repo)).changes[0]).toMatchObject({
      staged: 'modified',
      unstaged: null
    })
  })

  it('stages an untracked file as an addition', async () => {
    write('new.md', 'hi\n')
    await git.stage(repo, ['new.md'])
    expect((await git.status(repo)).changes[0]).toMatchObject({ staged: 'added' })
  })

  it('unstages without touching the working tree', async () => {
    write('base.md', 'changed\n')
    await git.stage(repo, ['base.md'])
    await git.unstage(repo, ['base.md'])
    const change = (await git.status(repo)).changes[0]!
    expect(change).toMatchObject({ staged: null, unstaged: 'modified' })
  })

  it('handles a path with spaces', async () => {
    write('a new note.md', 'hi\n')
    await git.stage(repo, ['a new note.md'])
    expect((await git.status(repo)).changes[0]).toMatchObject({ staged: 'added' })
  })

  it('does nothing for an empty list', async () => {
    await git.stage(repo, [])
    expect((await git.status(repo)).changes).toEqual([])
  })
})

describe('commit', () => {
  it('commits what is staged and leaves the tree clean', async () => {
    write('base.md', 'changed\n')
    await git.stage(repo, ['base.md'])
    expect(await git.commit(repo, 'a message')).not.toBeNull()
    expect((await git.status(repo)).changes).toEqual([])
  })

  it('refuses when nothing is staged, rather than throwing', async () => {
    expect(await git.commit(repo, 'empty')).toBeNull()
  })

  it('does not let a message reach a shell', async () => {
    // If this were interpolated into a shell, the subshell would run and the
    // recorded message would differ from what was asked for.
    write('base.md', 'changed\n')
    await git.stage(repo, ['base.md'])
    const nasty = 'fix: $(touch /tmp/orrery-pwned) && echo "quoted"'
    await git.commit(repo, nasty)
    const recorded = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: repo })
      .toString()
      .trim()
    expect(recorded).toBe(nasty)
  })

  it('leaves staged work alone when the commit fails', async () => {
    write('base.md', 'changed\n')
    await git.stage(repo, ['base.md'])
    // An empty message is refused by git.
    expect(await git.commit(repo, '')).toBeNull()
    expect((await git.status(repo)).changes[0]).toMatchObject({ staged: 'modified' })
  })
})

describe('fileDiff', () => {
  it('returns the changed lines of an unstaged edit', async () => {
    write('base.md', 'original\nadded line\n')
    const d = await git.fileDiff(repo, 'base.md', false)
    expect(d.added).toBe(1)
    expect(d.hunks[0]!.lines.some((l) => l.kind === 'added' && l.text === 'added line')).toBe(true)
  })

  it('looks at the index when asked for the staged side', async () => {
    write('base.md', 'staged version\n')
    await git.stage(repo, ['base.md'])
    write('base.md', 'and then more\n')

    const staged = await git.fileDiff(repo, 'base.md', true)
    const unstaged = await git.fileDiff(repo, 'base.md', false)
    expect(staged.hunks[0]!.lines.some((l) => l.text === 'staged version')).toBe(true)
    expect(unstaged.hunks[0]!.lines.some((l) => l.text === 'and then more')).toBe(true)
  })

  it('shows an untracked file as all additions', async () => {
    // Nothing in git to compare against, so it is diffed against /dev/null.
    write('brand new.md', 'line one\nline two\n')
    const d = await git.fileDiff(repo, 'brand new.md', false)
    expect(d.added).toBe(2)
    expect(d.removed).toBe(0)
  })

  it('reports nothing for an unchanged file', async () => {
    expect(await git.fileDiff(repo, 'base.md', false)).toMatchObject({ hunks: [], added: 0 })
  })

  it('reports a deletion', async () => {
    rmSync(join(repo, 'base.md'))
    const d = await git.fileDiff(repo, 'base.md', false)
    expect(d.removed).toBeGreaterThan(0)
  })

  it('does not throw outside a repository', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'orrery-plain-'))
    expect(await git.fileDiff(plain, 'x.md', false)).toMatchObject({ hunks: [] })
    rmSync(plain, { recursive: true, force: true })
  })
})

describe('discard', () => {
  it('restores a tracked file', async () => {
    write('base.md', 'changed\n')
    await git.discard(repo, ['base.md'], [])
    expect((await git.status(repo)).changes).toEqual([])
  })

  it('deletes an untracked file, which has no version to restore', async () => {
    write('junk.md', 'hi\n')
    await git.discard(repo, [], ['junk.md'])
    expect((await git.status(repo)).changes).toEqual([])
  })

  it('leaves staged work staged', async () => {
    write('base.md', 'staged\n')
    await git.stage(repo, ['base.md'])
    await git.discard(repo, ['base.md'], [])
    expect((await git.status(repo)).changes[0]).toMatchObject({ staged: 'modified' })
  })
})
