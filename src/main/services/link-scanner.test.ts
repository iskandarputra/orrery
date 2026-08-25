import { mkdtempSync, writeFileSync, rmSync, unlinkSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LinkScanner } from './link-scanner'

let vault: string
let scanner: LinkScanner

beforeEach(() => {
  vault = mkdtempSync(path.join(tmpdir(), 'zymd-scan-'))
  writeFileSync(path.join(vault, 'A.md'), '# A\n\nLinks [[B]].\n')
  writeFileSync(path.join(vault, 'B.md'), '# B\n\nBack to [[A]].\n')
  scanner = new LinkScanner()
})

afterEach(() => rmSync(vault, { recursive: true, force: true }))

describe('graph caching', () => {
  it('analyses the vault on the first call', async () => {
    const analysis = await scanner.graph(vault)
    expect(analysis.stats.notes).toBe(2)
    expect(analysis.stats.links).toBe(2)
  })

  it('returns the very same analysis when nothing changed', async () => {
    const first = await scanner.graph(vault)
    const second = await scanner.graph(vault)
    // Identity, not just equality: the cached object was handed back.
    expect(second).toBe(first)
  })

  it('re-analyses after a note is edited', async () => {
    const first = await scanner.graph(vault)
    writeFileSync(path.join(vault, 'B.md'), '# B\n\nNo links any more.\n')
    const second = await scanner.graph(vault)
    expect(second).not.toBe(first)
    expect(second.stats.links).toBe(1)
  })

  it('re-analyses after a note is added or removed', async () => {
    await scanner.graph(vault)
    writeFileSync(path.join(vault, 'C.md'), '# C\n')
    const withC = await scanner.graph(vault)
    expect(withC.stats.notes).toBe(3)

    unlinkSync(path.join(vault, 'C.md'))
    const withoutC = await scanner.graph(vault)
    expect(withoutC.stats.notes).toBe(2)
  })

  it('notices an edit that keeps the same timestamp but changes the size', async () => {
    const target = path.join(vault, 'B.md')
    const first = await scanner.graph(vault)
    const stamp = new Date(2020, 0, 1)
    writeFileSync(target, '# B\n\nBack to [[A]] and [[A]] again, longer now.\n')
    utimesSync(target, stamp, stamp)
    // Force the first file's mtime to match too, so only size differs overall.
    const second = await scanner.graph(vault)
    expect(second).not.toBe(first)
  })

  it('keeps separate caches per vault', async () => {
    const other = mkdtempSync(path.join(tmpdir(), 'zymd-scan2-'))
    writeFileSync(path.join(other, 'Only.md'), '# Only\n')
    try {
      const a = await scanner.graph(vault)
      const b = await scanner.graph(other)
      expect(a.stats.notes).toBe(2)
      expect(b.stats.notes).toBe(1)
      expect(await scanner.graph(vault)).toBe(a)
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })
})
