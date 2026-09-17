import { describe, expect, it } from 'vitest'
import { isRepositoryState, isWatchedGitPath } from './git-watch'

describe('isRepositoryState', () => {
  it('hears what a commit, a stage and a checkout write', () => {
    expect(isRepositoryState('HEAD')).toBe(true)
    expect(isRepositoryState('index')).toBe(true)
    expect(isRepositoryState('refs/heads/main')).toBe(true)
    expect(isRepositoryState('refs/heads/feature/nested')).toBe(true)
    expect(isRepositoryState('packed-refs')).toBe(true)
  })

  it('hears a remote branch moving, which moves ahead and behind', () => {
    expect(isRepositoryState('refs/remotes/origin/main')).toBe(true)
  })

  it('hears an operation starting or ending', () => {
    expect(isRepositoryState('MERGE_HEAD')).toBe(true)
    expect(isRepositoryState('CHERRY_PICK_HEAD')).toBe(true)
    expect(isRepositoryState('REVERT_HEAD')).toBe(true)
  })

  it('ignores lock files, which every index refresh creates and removes', () => {
    expect(isRepositoryState('index.lock')).toBe(false)
    expect(isRepositoryState('HEAD.lock')).toBe(false)
    expect(isRepositoryState('refs/heads/main.lock')).toBe(false)
  })

  it('ignores the parts of .git that no status or log shows', () => {
    expect(isRepositoryState('objects/ab/cdef0123')).toBe(false)
    expect(isRepositoryState('objects/pack/pack-1.pack')).toBe(false)
    expect(isRepositoryState('logs/HEAD')).toBe(false)
    expect(isRepositoryState('logs/refs/heads/main')).toBe(false)
    expect(isRepositoryState('COMMIT_EDITMSG')).toBe(false)
    expect(isRepositoryState('FETCH_HEAD')).toBe(false)
    expect(isRepositoryState('config')).toBe(false)
    expect(isRepositoryState('hooks/pre-commit')).toBe(false)
  })

  it('does not mistake a file named like a state file for one', () => {
    // Top level only: HEAD inside logs/ is a log, not the checkout.
    expect(isRepositoryState('logs/HEAD')).toBe(false)
    expect(isRepositoryState('worktrees/other/index')).toBe(false)
  })

  it('reads either separator', () => {
    expect(isRepositoryState('refs\\heads\\main')).toBe(true)
    expect(isRepositoryState('objects\\ab\\cd')).toBe(false)
  })
})

describe('isWatchedGitPath', () => {
  it('walks into the git directory and refs, and to the state files', () => {
    expect(isWatchedGitPath('')).toBe(true)
    expect(isWatchedGitPath('refs')).toBe(true)
    expect(isWatchedGitPath('refs/heads')).toBe(true)
    expect(isWatchedGitPath('refs/remotes/origin')).toBe(true)
    expect(isWatchedGitPath('HEAD')).toBe(true)
    expect(isWatchedGitPath('index')).toBe(true)
  })

  it('never walks objects or logs', () => {
    expect(isWatchedGitPath('objects')).toBe(false)
    expect(isWatchedGitPath('objects/pack')).toBe(false)
    expect(isWatchedGitPath('logs')).toBe(false)
    expect(isWatchedGitPath('hooks')).toBe(false)
  })

  it('leaves out lock files and anything outside the directory', () => {
    expect(isWatchedGitPath('index.lock')).toBe(false)
    expect(isWatchedGitPath('refs/heads/main.lock')).toBe(false)
    expect(isWatchedGitPath('..')).toBe(false)
    expect(isWatchedGitPath('../work/file.md')).toBe(false)
  })
})
