import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileSystemService } from './file-system'

/**
 * Against a real directory, not a mocked one.
 *
 * Every interesting thing here is an interaction with the filesystem — an
 * atomic rename, a stale mtime, a name already taken — and a mock of `fs` would
 * only assert that the code calls the functions it was written to call.
 */

let dir: string
const fsvc = new FileSystemService()

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orrery-fs-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const file = (name: string): string => join(dir, name)

describe('writeFile', () => {
  it('writes, and reports the mtime the next write should present', async () => {
    const result = await fsvc.writeFile(file('a.md'), 'hello', null)
    expect(readFileSync(file('a.md'), 'utf-8')).toBe('hello')
    const read = await fsvc.readFile(file('a.md'))
    expect(read.mtimeMs).toBeCloseTo(result.mtimeMs, 0)
  })

  it('refuses a write whose base has changed underneath it', async () => {
    // The whole point of the guard: two editors on one file, the slower one
    // must not silently discard the faster one's work.
    await fsvc.writeFile(file('a.md'), 'first', null)
    const stale = (await fsvc.readFile(file('a.md'))).mtimeMs
    writeFileSync(file('a.md'), 'changed by someone else')

    await expect(fsvc.writeFile(file('a.md'), 'mine', stale - 5000)).rejects.toMatchObject({
      code: 'CONFLICT'
    })
    expect(readFileSync(file('a.md'), 'utf-8')).toBe('changed by someone else')
  })

  it('allows a write that presents the current mtime', async () => {
    await fsvc.writeFile(file('a.md'), 'first', null)
    const current = (await fsvc.readFile(file('a.md'))).mtimeMs
    await expect(fsvc.writeFile(file('a.md'), 'second', current)).resolves.toBeTruthy()
    expect(readFileSync(file('a.md'), 'utf-8')).toBe('second')
  })

  it('creates a file the guard was given an mtime for but which is not there', async () => {
    // Nothing to conflict with: a file deleted under a dirty buffer should save
    // rather than trap the work in a window that cannot be closed.
    await expect(fsvc.writeFile(file('gone.md'), 'body', 12345)).resolves.toBeTruthy()
    expect(readFileSync(file('gone.md'), 'utf-8')).toBe('body')
  })

  it('leaves no temporary file behind', async () => {
    // It writes to a temp name and renames, which is what makes the write
    // atomic — but a leftover dotfile would show up in the vault.
    await fsvc.writeFile(file('a.md'), 'x', null)
    expect(readdirSync(dir)).toEqual(['a.md'])
  })
})

describe('ensureFile', () => {
  it('creates when absent and reports it', async () => {
    expect(await fsvc.ensureFile(file('new.md'), 'seed')).toEqual({
      path: file('new.md'),
      created: true
    })
    expect(readFileSync(file('new.md'), 'utf-8')).toBe('seed')
  })

  it('never overwrites an existing file', async () => {
    writeFileSync(file('new.md'), 'mine')
    expect(await fsvc.ensureFile(file('new.md'), 'seed')).toEqual({
      path: file('new.md'),
      created: false
    })
    expect(readFileSync(file('new.md'), 'utf-8')).toBe('mine')
  })

  it('creates missing parent directories', async () => {
    const nested = join(dir, 'a', 'b', 'c.md')
    expect((await fsvc.ensureFile(nested, 'x')).created).toBe(true)
    expect(readFileSync(nested, 'utf-8')).toBe('x')
  })
})

describe('writeAsset', () => {
  const png = Buffer.from('hello').toString('base64')

  it('files an asset under its own name', async () => {
    const { path } = await fsvc.writeAsset(dir, 'pic.png', png)
    expect(readFileSync(path, 'utf-8')).toBe('hello')
  })

  it('numbers a name already in use rather than overwriting it', async () => {
    // Losing an image someone pasted earlier is not a recoverable mistake.
    const first = await fsvc.writeAsset(dir, 'pic.png', png)
    const second = await fsvc.writeAsset(dir, 'pic.png', Buffer.from('other').toString('base64'))
    expect(second.path).not.toBe(first.path)
    expect(readFileSync(first.path, 'utf-8')).toBe('hello')
    expect(readFileSync(second.path, 'utf-8')).toBe('other')
  })
})

describe('readTree', () => {
  it('lists directories before files, each alphabetical', async () => {
    writeFileSync(file('b.md'), '')
    writeFileSync(file('a.md'), '')
    const tree = await fsvc.readTree(dir)
    const names = (tree.children ?? []).map((c) => c.name)
    expect(names).toEqual(['a.md', 'b.md'])
  })

  it('stops at the top level, and says so by leaving children out', async () => {
    // Reading the whole tree up front is what made opening a large folder take
    // eight seconds and seventy megabytes. An unread directory has no
    // `children` at all, which is how the tree tells it from an empty one.
    const sub = join(dir, 'sub')
    await fsvc.createDirectory(dir, 'sub')
    writeFileSync(join(sub, 'deep.md'), '')
    const tree = await fsvc.readTree(dir)
    const folder = (tree.children ?? []).find((c) => c.name === 'sub')
    expect(folder?.kind).toBe('directory')
    expect(folder?.children).toBeUndefined()
  })

  it('reads that subdirectory when it is asked for', async () => {
    await fsvc.createDirectory(dir, 'sub')
    writeFileSync(join(dir, 'sub', 'deep.md'), '')
    expect((await fsvc.readDir(join(dir, 'sub'))).map((c) => c.name)).toEqual(['deep.md'])
  })

  it('refuses a directory that is not there rather than returning nothing', async () => {
    // "Empty" and "gone" have to be different answers, or a vanished folder
    // quietly looks like one somebody emptied.
    await expect(fsvc.readDir(join(dir, 'nope'))).rejects.toThrow()
  })
})

describe('listFiles', () => {
  it('finds every file, however deep, and no directories', async () => {
    await fsvc.createDirectory(dir, 'a')
    await fsvc.createDirectory(join(dir, 'a'), 'b')
    writeFileSync(join(dir, 'top.md'), '')
    writeFileSync(join(dir, 'a', 'mid.md'), '')
    writeFileSync(join(dir, 'a', 'b', 'deep.md'), '')

    const { paths, truncated } = await fsvc.listFiles(dir, 100)
    expect(paths.map((p) => p.replace(dir, '')).sort()).toEqual([
      '/a/b/deep.md',
      '/a/mid.md',
      '/top.md'
    ])
    expect(truncated).toBe(false)
  })

  it('stops at the limit and admits it', async () => {
    // A vault larger than the index is a vault where some files cannot be
    // found by name, and the caller has to be able to say so.
    for (let i = 0; i < 5; i++) writeFileSync(join(dir, `n${i}.md`), '')
    const { paths, truncated } = await fsvc.listFiles(dir, 3)
    expect(paths).toHaveLength(3)
    expect(truncated).toBe(true)
  })

  it('skips the directories nobody wants indexed', async () => {
    await fsvc.createDirectory(dir, 'node_modules')
    writeFileSync(join(dir, 'node_modules', 'dep.md'), '')
    writeFileSync(join(dir, 'real.md'), '')
    const { paths } = await fsvc.listFiles(dir, 100)
    expect(paths.map((p) => p.replace(dir, ''))).toEqual(['/real.md'])
  })
})

describe('rename', () => {
  it('renames within the same directory', async () => {
    writeFileSync(file('old.md'), 'body')
    const next = await fsvc.rename(file('old.md'), 'new.md')
    expect(next).toBe(file('new.md'))
    expect(readFileSync(next, 'utf-8')).toBe('body')
  })
})
