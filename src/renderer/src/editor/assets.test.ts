import { describe, expect, it } from 'vitest'
import { assetFileName, assetMarkdown } from './assets'

describe('assetFileName', () => {
  it('keeps a dropped file name, made safe', () => {
    expect(assetFileName('My Diagram.png', 1_700_000_000_000)).toBe('My Diagram.png')
    expect(assetFileName('a/b\\c:d.png', 1_700_000_000_000)).toBe('a-b-c-d.png')
  })

  it('names a pasted image after the moment it was pasted', () => {
    // Clipboard images arrive as "image.png" or with no name at all.
    const name = assetFileName('image.png', new Date(2026, 7, 26, 14, 5, 9).getTime())
    expect(name).toBe('Pasted image 2026-08-26 14-05-09.png')
  })

  it('falls back to png when the type is unknown', () => {
    expect(assetFileName('', 0)).toMatch(/\.png$/)
  })

  it('keeps the real extension of a pasted jpeg', () => {
    const name = assetFileName('image.jpeg', new Date(2026, 0, 2, 3, 4, 5).getTime())
    expect(name).toBe('Pasted image 2026-01-02 03-04-05.jpeg')
  })
})

describe('assetMarkdown', () => {
  it('links the asset relative to the vault, not absolutely', () => {
    expect(assetMarkdown('/vault/assets/pic.png', '/vault')).toBe('![](assets/pic.png)')
  })

  it('encodes spaces so the link survives a markdown renderer', () => {
    expect(assetMarkdown('/vault/assets/my pic.png', '/vault')).toBe('![](assets/my%20pic.png)')
  })

  it('falls back to the full path outside the vault', () => {
    expect(assetMarkdown('/elsewhere/pic.png', '/vault')).toBe('![](/elsewhere/pic.png)')
  })
})
