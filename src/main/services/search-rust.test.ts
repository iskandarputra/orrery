import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LinkScanner } from './link-scanner'
import { SidecarClient } from './sidecar'
import type { BacklinkHit } from '@shared/types'

const BINARY = resolve('native/target/release/orrery-sidecar')

/**
 * Differential test: the TypeScript implementation is the oracle.
 *
 * Rather than assert hand-written expectations for the Rust port — which would
 * only prove the expectations match the port — every scenario runs through both
 * implementations and compares them. Anything the TypeScript does that the Rust
 * does not, or vice versa, shows up here.
 *
 * Skipped when the binary is absent, so the suite stays green on a machine with
 * no Rust toolchain. That is the property that lets the sidecar be optional.
 */
describe.skipIf(!existsSync(BINARY))('search: Rust sidecar vs TypeScript', () => {
  let vault: string
  let sidecar: SidecarClient
  let rustScanner: LinkScanner
  let tsScanner: LinkScanner

  const write = (rel: string, body: string): void => {
    const path = join(vault, rel)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, body, 'utf-8')
  }

  /** Order differs by design (the Rust sorts), so compare as sets. */
  const norm = (hits: BacklinkHit[]): BacklinkHit[] =>
    [...hits].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)

  const bothAgree = async (
    query: string,
    useRegex = false,
    caseSensitive = false
  ): Promise<BacklinkHit[]> => {
    const rust = await rustScanner.search(vault, query, useRegex, caseSensitive)
    const ts = await tsScanner.search(vault, query, useRegex, caseSensitive)
    expect(norm(rust), `query ${JSON.stringify(query)}`).toEqual(norm(ts))
    return norm(ts)
  }

  beforeAll(() => {
    vault = mkdtempSync(join(tmpdir(), 'orrery-diff-'))
    sidecar = new SidecarClient(BINARY)
    rustScanner = new LinkScanner(sidecar)
    tsScanner = new LinkScanner(null)

    write('plain.md', 'first line\nsecond needle here\nthird')
    write('Case.md', 'A Needle With Caps')
    write('regexy.md', 'abc\na.c\na$c')
    write('nested/deep/inner.md', 'needle in a nested note')
    write('other.markdown', 'needle in a .markdown file')
    write('third.mdown', 'needle in a .mdown file')
    write('fourth.mkd', 'needle in a .mkd file')
    write('notes.txt', 'needle in a file that is not markdown')
    write('.hidden.md', 'needle in a dotfile')
    write('node_modules/dep.md', 'needle in an ignored directory')
    write('unicode.md', 'café needle — em dash and é')
    write('padded.md', '        needle with surrounding space        ')
    write('long.md', `${'z'.repeat(400)} needle`)
    write('empty.md', '')
    write('multi.md', 'needle\nno\nneedle\nno\nneedle')
    write('weird name $with (chars).md', 'needle in an awkward filename')
  })

  afterAll(() => {
    sidecar.shutdown()
    rmSync(vault, { recursive: true, force: true })
  })

  it('agrees on a plain literal query', async () => {
    const hits = await bothAgree('needle')
    expect(hits.length).toBeGreaterThan(5)
  })

  it('agrees on case sensitivity', async () => {
    await bothAgree('Needle', false, true)
    await bothAgree('Needle', false, false)
  })

  it('agrees that a non-regex query is literal', async () => {
    // "a.c" must not match "abc" when regex is off.
    const hits = await bothAgree('a.c')
    expect(hits.some((h) => h.snippet === 'a.c')).toBe(true)
    expect(hits.some((h) => h.snippet === 'abc')).toBe(false)
  })

  it('agrees on a real regex', async () => {
    await bothAgree('^a.c$', true)
    await bothAgree('need(le|les)', true)
  })

  it('agrees that an invalid regex yields nothing', async () => {
    expect(await bothAgree('(unclosed', true)).toEqual([])
  })

  it('agrees on which extensions count', async () => {
    const hits = await bothAgree('needle')
    expect(hits.some((h) => h.path.endsWith('.txt'))).toBe(false)
    for (const ext of ['.md', '.markdown', '.mdown', '.mkd']) {
      expect(
        hits.some((h) => h.path.endsWith(ext)),
        ext
      ).toBe(true)
    }
  })

  it('agrees on skipping dotfiles and ignored directories', async () => {
    const hits = await bothAgree('needle')
    expect(hits.some((h) => h.path.includes('.hidden'))).toBe(false)
    expect(hits.some((h) => h.path.includes('node_modules'))).toBe(false)
  })

  it('agrees on nested directories', async () => {
    expect((await bothAgree('nested')).length).toBe(1)
  })

  it('agrees on snippets: trimmed and capped', async () => {
    const padded = (await bothAgree('surrounding')).at(0)
    expect(padded?.snippet).toBe('needle with surrounding space')
    const long = (await bothAgree('zzz')).at(0)
    expect(long?.snippet.length).toBe(200)
  })

  it('agrees on non-ASCII content', async () => {
    expect((await bothAgree('café')).length).toBe(1)
  })

  it('agrees on 1-based line numbers across multiple matches', async () => {
    const hits = await bothAgree('needle')
    const multi = hits.filter((h) => h.path.endsWith('multi.md'))
    expect(multi.map((h) => h.line)).toEqual([1, 3, 5])
  })

  it('agrees on an awkward filename', async () => {
    expect((await bothAgree('awkward')).length).toBe(1)
  })

  it('agrees when nothing matches', async () => {
    expect(await bothAgree('zzz-definitely-absent-zzz')).toEqual([])
  })

  it('agrees on a vault that does not exist', async () => {
    const missing = join(tmpdir(), 'orrery-does-not-exist-at-all')
    const rust = await rustScanner.search(missing, 'needle', false, false)
    const ts = await tsScanner.search(missing, 'needle', false, false)
    expect(rust).toEqual([])
    expect(ts).toEqual([])
  })

  it('falls back to TypeScript when the binary is missing', async () => {
    // The property the whole design rests on: no binary, no behaviour change.
    const absent = new LinkScanner(new SidecarClient(join(tmpdir(), 'orrery-no-such-binary')))
    expect(norm(await absent.search(vault, 'needle', false, false))).toEqual(
      norm(await tsScanner.search(vault, 'needle', false, false))
    )
  })
})
