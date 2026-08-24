import { describe, expect, it } from 'vitest'
import { resolveAssetUrl } from './asset'

describe('resolveAssetUrl', () => {
  it('passes remote and data urls through', () => {
    expect(resolveAssetUrl('/v/n.md', 'https://x.com/i.png')).toBe('https://x.com/i.png')
    expect(resolveAssetUrl('/v/n.md', 'data:image/png;base64,AAA')).toBe(
      'data:image/png;base64,AAA'
    )
  })

  it('resolves a relative path against the note directory', () => {
    expect(resolveAssetUrl('/vault/notes/n.md', 'img/pic.png')).toBe(
      'zymd-asset://local/vault/notes/img/pic.png'
    )
  })

  it('collapses ../ segments', () => {
    expect(resolveAssetUrl('/vault/notes/n.md', '../assets/pic.png')).toBe(
      'zymd-asset://local/vault/assets/pic.png'
    )
  })

  it('handles absolute local paths', () => {
    expect(resolveAssetUrl(null, '/abs/pic.png')).toBe('zymd-asset://local/abs/pic.png')
  })

  it('url-encodes spaces in names', () => {
    expect(resolveAssetUrl('/v/n.md', 'my pic.png')).toBe('zymd-asset://local/v/my%20pic.png')
  })

  it('returns null for a relative path with no document location', () => {
    expect(resolveAssetUrl(null, 'pic.png')).toBeNull()
  })
})
