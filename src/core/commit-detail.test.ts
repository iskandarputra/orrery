import { describe, expect, it } from 'vitest'
import { parseCommitDetail, statusLetter } from './commit-detail'

/**
 * `git show --name-status -z --format=%b` output, NUL separated.
 *
 * Shaped like the real thing, which was captured from git rather than assumed:
 * the body ends with a newline, and the blank line separating it from the file
 * list arrives attached to the first status field, as "\nA". An earlier version
 * of these fixtures left that out, so the tests passed against a format git does
 * not produce.
 */
const z = (body: string, ...files: string[]): string =>
  [body, ...files.map((f, i) => (i === 0 ? `\n${f}` : f)), ''].join('\0')

describe('parseCommitDetail', () => {
  it('reads the body and a modified file', () => {
    const detail = parseCommitDetail(z('why this changed\n\n', 'M', 'src/a.ts'))
    expect(detail.body).toBe('why this changed')
    expect(detail.files).toEqual([{ path: 'src/a.ts', from: null, status: 'modified' }])
  })

  it('reads every status letter', () => {
    const detail = parseCommitDetail(
      z('', 'A', 'new.ts', 'D', 'gone.ts', 'M', 'same.ts', 'T', 'link.ts')
    )
    expect(detail.files.map((f) => f.status)).toEqual([
      'added',
      'deleted',
      'modified',
      'modified' // a type change reads as a modification
    ])
  })

  it('reads a rename, which carries two paths', () => {
    // The score is attached to the letter: `R100`, not a separate field.
    const detail = parseCommitDetail(z('', 'R100', 'old//name.ts', 'new/name.ts'))
    expect(detail.files).toEqual([{ path: 'new/name.ts', from: 'old//name.ts', status: 'renamed' }])
  })

  it('reads a copy the same way', () => {
    const detail = parseCommitDetail(z('', 'C075', 'a.ts', 'b.ts'))
    expect(detail.files[0]).toMatchObject({ path: 'b.ts', from: 'a.ts', status: 'copied' })
  })

  it('keeps a path containing a newline, which is why -z is used', () => {
    const detail = parseCommitDetail(z('', 'M', 'weird\nname.md'))
    expect(detail.files[0]!.path).toBe('weird\nname.md')
  })

  it('handles a commit with no body', () => {
    expect(parseCommitDetail(z('', 'M', 'a.ts')).body).toBe('')
  })

  it('handles a commit that touched nothing', () => {
    expect(parseCommitDetail(z('just a message\n'))).toEqual({
      body: 'just a message',
      files: []
    })
  })

  it('stops cleanly on truncated output rather than inventing a file', () => {
    // A status with no path following it: the record is incomplete, so it is
    // dropped instead of becoming a file named undefined.
    // Raw, rather than through the helper: this is malformed output, and the
    // helper only builds well-formed records.
    expect(parseCommitDetail('\0\nM').files).toEqual([])
    expect(parseCommitDetail('\0\nR100\0only-one-path').files).toEqual([])
  })

  it('returns nothing useful for empty output', () => {
    expect(parseCommitDetail('')).toEqual({ body: '', files: [] })
  })
})

describe('statusLetter', () => {
  it('maps each status to its column letter', () => {
    expect(statusLetter('added')).toBe('A')
    expect(statusLetter('renamed')).toBe('R')
    expect(statusLetter('unknown')).toBe('?')
  })
})
