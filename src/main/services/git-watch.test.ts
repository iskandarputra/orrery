import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GitService } from './git'
import { GitWatchService } from './git-watch'

/**
 * Against a real repository and a real watch: what matters is which of git's
 * own writes are heard, and a fixture cannot say what git writes.
 */
let repo: string
let heard: string[]
let watch: GitWatchService
const git = new GitService()

const run = (cwd: string, ...args: string[]): void => {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

/** Long enough for chokidar to see a write and the settle timer to fire. */
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 700))

async function until(check: () => boolean, ms = 4000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) return
    await new Promise((done) => setTimeout(done, 25))
  }
}

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), 'orrery-gitwatch-'))
  run(repo, 'init', '-q', '.')
  run(repo, 'config', 'user.email', 'test@example.com')
  run(repo, 'config', 'user.name', 'Test')
  run(repo, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(repo, 'a.md'), 'one\n')
  run(repo, 'add', '.')
  run(repo, 'commit', '-qm', 'base')
  heard = []
  watch = new GitWatchService(
    (root) => git.gitDirectories(root),
    (root) => heard.push(root),
    50
  )
})

afterEach(async () => {
  await watch.dispose()
  rmSync(repo, { recursive: true, force: true })
})

describe('GitWatchService', () => {
  it('hears a commit made outside the app, once', async () => {
    await watch.watch(repo)
    await settle()
    writeFileSync(join(repo, 'a.md'), 'two\n')
    run(repo, 'add', 'a.md')
    run(repo, 'commit', '-qm', 'second')
    await until(() => heard.length > 0)
    await settle()
    // A commit writes the index, a ref and HEAD's log: one report, not three.
    expect(heard).toEqual([repo])
  })

  it('hears staging and a checkout', async () => {
    await watch.watch(repo)
    await settle()
    writeFileSync(join(repo, 'b.md'), 'new\n')
    run(repo, 'add', 'b.md')
    await until(() => heard.length > 0)
    expect(heard.length).toBeGreaterThan(0)

    heard.length = 0
    run(repo, 'checkout', '-qb', 'elsewhere')
    await until(() => heard.length > 0)
    expect(heard.length).toBeGreaterThan(0)
  })

  it('stays quiet while the app reads status, which would otherwise feed itself', async () => {
    await watch.watch(repo)
    await settle()
    // Touched, so a plain status has stale stat data to write back.
    const past = new Date(Date.now() - 60_000)
    utimesSync(join(repo, 'a.md'), past, past)
    await git.status(repo)
    await git.diffStats(repo, [])
    await settle()
    expect(heard).toEqual([])
  })

  it('ignores object writes, which say nothing a status or a log shows', async () => {
    await watch.watch(repo)
    await settle()
    writeFileSync(join(repo, 'loose.txt'), 'an object and nothing more\n')
    run(repo, 'hash-object', '-w', 'loose.txt')
    await settle()
    expect(heard).toEqual([])
  })

  it('finds the repository when the vault is a folder inside it', async () => {
    const vault = join(repo, 'notes')
    mkdirSync(vault)
    writeFileSync(join(vault, 'n.md'), 'note\n')
    await watch.watch(vault)
    await settle()
    run(repo, 'add', '.')
    run(repo, 'commit', '-qm', 'from above')
    await until(() => heard.length > 0)
    // Reported under the vault the renderer asked about, which is how it knows
    // the change is for the panel it is showing.
    expect(heard[0]).toBe(vault)
  })

  it('does nothing for a folder that is not a repository', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'orrery-plainwatch-'))
    await watch.watch(plain)
    writeFileSync(join(plain, 'x.md'), 'x\n')
    await settle()
    expect(heard).toEqual([])
    rmSync(plain, { recursive: true, force: true })
  })
})

describe('reads leave the index alone', () => {
  it('neither status, the line counts nor the gutter rewrite .git/index', async () => {
    // Stale stat data on a tracked file: exactly what a plain `git status`
    // refreshes and writes back.
    const past = new Date(Date.now() - 60_000)
    utimesSync(join(repo, 'a.md'), past, past)
    const index = join(repo, '.git', 'index')
    const before = statSync(index).mtimeMs
    await git.status(repo)
    await git.diffStats(repo, [])
    await git.status(repo)
    // And the gutter's read of one file, which runs on every open and save.
    await git.fileChanges(join(repo, 'a.md'))
    expect(statSync(index).mtimeMs).toBe(before)
  })
})
