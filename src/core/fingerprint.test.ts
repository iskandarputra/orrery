import { describe, expect, it } from 'vitest'
import { fingerprintVault, type FileStamp } from './fingerprint'

const stamp = (path: string, mtimeMs: number, size: number): FileStamp => ({ path, mtimeMs, size })

describe('fingerprintVault', () => {
  it('is stable for the same vault', () => {
    const files = [stamp('/v/a.md', 10, 100), stamp('/v/b.md', 20, 200)]
    expect(fingerprintVault(files)).toBe(fingerprintVault(files))
  })

  it('ignores the order files were walked in', () => {
    const a = [stamp('/v/a.md', 10, 100), stamp('/v/b.md', 20, 200)]
    const b = [stamp('/v/b.md', 20, 200), stamp('/v/a.md', 10, 100)]
    expect(fingerprintVault(a)).toBe(fingerprintVault(b))
  })

  it('changes when a note is edited, added or removed', () => {
    const base = [stamp('/v/a.md', 10, 100), stamp('/v/b.md', 20, 200)]
    const edited = [stamp('/v/a.md', 11, 100), stamp('/v/b.md', 20, 200)]
    const resized = [stamp('/v/a.md', 10, 101), stamp('/v/b.md', 20, 200)]
    const added = [...base, stamp('/v/c.md', 30, 300)]
    const removed = [base[0]!]

    const fingerprint = fingerprintVault(base)
    for (const other of [edited, resized, added, removed]) {
      expect(fingerprintVault(other)).not.toBe(fingerprint)
    }
  })

  it('changes when a note is renamed, even keeping its stats', () => {
    expect(fingerprintVault([stamp('/v/a.md', 10, 100)])).not.toBe(
      fingerprintVault([stamp('/v/renamed.md', 10, 100)])
    )
  })

  it('has a fingerprint for an empty vault', () => {
    expect(fingerprintVault([])).toBeTruthy()
    expect(fingerprintVault([])).toBe(fingerprintVault([]))
  })
})
