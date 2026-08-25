import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { defaultSettings } from '@shared/settings'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EmbeddingService } from './embeddings'

/** Counts model calls so "only what changed" is measured, not assumed. */
class CountingEmbeddings extends EmbeddingService {
  calls = 0
  protected override async embed(text: string): Promise<number[]> {
    this.calls++
    // A crude but deterministic stand-in: length and word count as coordinates.
    return [text.length / 100, (text.split(/\s+/).length || 1) / 10]
  }
}

let vault: string
let userData: string
let service: CountingEmbeddings

beforeEach(() => {
  vault = mkdtempSync(path.join(tmpdir(), 'zymd-embed-vault-'))
  userData = mkdtempSync(path.join(tmpdir(), 'zymd-embed-data-'))
  writeFileSync(path.join(vault, 'A.md'), '# A\n\nAlpha note about rust.\n')
  writeFileSync(path.join(vault, 'B.md'), '# B\n\nBeta note about cooking.\n')
  service = new CountingEmbeddings(() => defaultSettings, userData)
})

afterEach(() => {
  rmSync(vault, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})

describe('incremental reindex', () => {
  it('embeds every note the first time', async () => {
    const result = await service.reindex(vault)
    expect(result.files).toBe(2)
    expect(result.embedded).toBe(2)
    expect(result.reused).toBe(0)
    expect(service.calls).toBeGreaterThan(0)
  })

  it('embeds nothing when nothing changed', async () => {
    await service.reindex(vault)
    const callsAfterFirst = service.calls

    const second = await service.reindex(vault)
    expect(second.embedded).toBe(0)
    expect(second.reused).toBe(2)
    expect(service.calls).toBe(callsAfterFirst) // not one extra model call
  })

  it('re-embeds only the note that changed', async () => {
    await service.reindex(vault)
    const before = service.calls

    writeFileSync(path.join(vault, 'B.md'), '# B\n\nBeta note, now about baking bread.\n')
    const result = await service.reindex(vault)

    expect(result.embedded).toBe(1)
    expect(result.reused).toBe(1)
    expect(service.calls).toBeGreaterThan(before)
  })

  it('drops notes that were deleted', async () => {
    await service.reindex(vault)
    unlinkSync(path.join(vault, 'B.md'))

    const result = await service.reindex(vault)
    expect(result.files).toBe(1)
    expect(result.embedded).toBe(0)
    expect(result.reused).toBe(1)
  })

  it('rebuilds from scratch when the vault was never indexed', async () => {
    const result = await service.suggestLinks(vault, path.join(vault, 'A.md'), 5)
    expect(result).toEqual([]) // no index yet — no suggestions, no crash
  })
})

describe('link suggestions', () => {
  it('suggests a similar note that is not linked, and never one that is', async () => {
    // C is written to look like A to the stand-in embedder (same shape of text).
    writeFileSync(path.join(vault, 'C.md'), '# C\n\nAlpha notes about rusty.\n')
    // A links to B, so B must never be suggested for A.
    writeFileSync(path.join(vault, 'A.md'), '# A\n\nAlpha note about rust. See [[B]].\n')
    await service.reindex(vault)

    const suggestions = await service.suggestLinks(vault, path.join(vault, 'A.md'), 5)
    expect(suggestions.map((s) => s.label)).not.toContain('B')
    expect(suggestions.map((s) => s.label)).toContain('C')
  })
})

/** Vectors chosen per marker word, so similarity is exact and controllable. */
class MarkerEmbeddings extends EmbeddingService {
  protected override async embed(text: string): Promise<number[]> {
    if (text.includes('ALPHA')) return [1, 0] // the query, and A's text
    if (text.includes('NEAR')) return [0.95, 0.312] // close on text, linked to nothing
    if (text.includes('LINKED')) return [0.93, 0.367] // slightly further, linked from A
    return [0, 1]
  }
}

describe('graph-aware retrieval', () => {
  it('prefers a note linked from the best hit over a marginally closer stranger', async () => {
    writeFileSync(path.join(vault, 'A.md'), '# A\n\nALPHA topic. See [[Linked]].\n')
    writeFileSync(path.join(vault, 'Linked.md'), '# Linked\n\nLINKED continuation of the topic.\n')
    writeFileSync(path.join(vault, 'Stranger.md'), '# Stranger\n\nNEAR the topic, unconnected.\n')
    rmSync(path.join(vault, 'B.md'), { force: true })

    const marker = new MarkerEmbeddings(() => defaultSettings, userData)
    await marker.reindex(vault)
    const hits = await marker.search(vault, 'ALPHA', 2)

    const names = hits.map((h) => path.basename(h.path))
    expect(names[0]).toBe('A.md')
    // On cosine alone Stranger (0.95) beats Linked (0.93); the link tips it.
    expect(names).toContain('Linked.md')
    expect(names).not.toContain('Stranger.md')
  })

  it('still lets a clearly better match win over a linked note', async () => {
    writeFileSync(path.join(vault, 'A.md'), '# A\n\nALPHA topic. See [[Weak]].\n')
    writeFileSync(path.join(vault, 'Weak.md'), '# Weak\n\nnothing relevant here at all.\n')
    writeFileSync(path.join(vault, 'Stranger.md'), '# Stranger\n\nNEAR the topic, unconnected.\n')
    rmSync(path.join(vault, 'Linked.md'), { force: true })
    rmSync(path.join(vault, 'B.md'), { force: true })

    const marker = new MarkerEmbeddings(() => defaultSettings, userData)
    await marker.reindex(vault)
    const hits = await marker.search(vault, 'ALPHA', 2)

    expect(hits.map((h) => path.basename(h.path))).toEqual(['A.md', 'Stranger.md'])
  })
})
