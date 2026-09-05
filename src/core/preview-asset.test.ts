import { describe, expect, it } from 'vitest'
import {
  isUnderRoot,
  pageAssetUrl,
  pageReferenceUrl,
  parsePageAssetUrl,
  previewRoot,
  resolveUnderRoot
} from './preview-asset'

/**
 * Where the line is, for a page nobody vouched for.
 *
 * This is the whole of what an untrusted document may ask the disk for, so the
 * tests that matter most are the refusals. Every one of them is a thing a page
 * can simply write in its own markup.
 */

const VAULT = '/home/you/vault'
const NOTE = '/home/you/vault/notes/page.html'

describe('what counts as inside a root', () => {
  it('is decided by segment, not by string prefix', () => {
    // The one that catches a prefix test out: `/home/you/vault-backup` starts
    // with `/home/you/vault` and is a different directory entirely.
    expect(isUnderRoot(VAULT, '/home/you/vault/notes/a.png')).toBe(true)
    expect(isUnderRoot(VAULT, '/home/you/vault-backup/secrets.txt')).toBe(false)
  })

  it('does not count the root itself', () => {
    expect(isUnderRoot(VAULT, VAULT)).toBe(false)
    expect(isUnderRoot(VAULT, `${VAULT}/`)).toBe(false)
  })

  it('tolerates a trailing separator on the root', () => {
    expect(isUnderRoot(`${VAULT}/`, '/home/you/vault/a.png')).toBe(true)
  })
})

describe('resolving a request under a root', () => {
  it('joins a relative path onto the root', () => {
    expect(resolveUnderRoot(VAULT, 'notes/logo.png')).toBe('/home/you/vault/notes/logo.png')
  })

  it('settles a `..` that stays inside', () => {
    expect(resolveUnderRoot(VAULT, 'notes/../img/logo.png')).toBe('/home/you/vault/img/logo.png')
  })

  it('refuses one that climbs out', () => {
    expect(resolveUnderRoot(VAULT, '../.ssh/id_rsa')).toBeNull()
    expect(resolveUnderRoot(VAULT, 'notes/../../.ssh/id_rsa')).toBeNull()
    expect(resolveUnderRoot(VAULT, 'a/../../../../../../etc/passwd')).toBeNull()
  })

  it('refuses an absolute path outright', () => {
    expect(resolveUnderRoot(VAULT, '/etc/passwd')).toBeNull()
    expect(resolveUnderRoot(VAULT, '\\Windows\\win.ini')).toBeNull()
    expect(resolveUnderRoot(VAULT, 'C:/Windows/win.ini')).toBeNull()
  })

  it('refuses the root directory itself, and a NUL', () => {
    expect(resolveUnderRoot(VAULT, '')).toBeNull()
    expect(resolveUnderRoot(VAULT, '.')).toBeNull()
    expect(resolveUnderRoot(VAULT, 'notes/..')).toBeNull()
    expect(resolveUnderRoot(VAULT, 'a\0b.png')).toBeNull()
  })

  it('keeps a windows root written the way it arrived', () => {
    expect(resolveUnderRoot('C:\\Users\\you\\vault', 'notes/logo.png')).toBe(
      'C:\\Users\\you\\vault\\notes\\logo.png'
    )
    expect(resolveUnderRoot('C:\\Users\\you\\vault', '..\\..\\secrets.txt')).toBeNull()
  })
})

describe('the root a page is given', () => {
  it('is the vault, when the page is in it', () => {
    // So a documentation export dropped into a vault still finds the
    // `../css/theme.css` it was written against.
    expect(previewRoot(NOTE, VAULT)).toBe(VAULT)
  })

  it('is the page’s own folder, when it is not', () => {
    expect(previewRoot('/home/you/Downloads/report.html', VAULT)).toBe('/home/you/Downloads')
  })

  it('is nothing at all for a buffer with nowhere on disk to be', () => {
    expect(previewRoot(null, VAULT)).toBeNull()
  })

  it('is the page’s folder when no vault is open', () => {
    expect(previewRoot(NOTE, null)).toBe('/home/you/vault/notes')
  })
})

describe('the url a reference becomes', () => {
  const url = (reference: string, root: string | null = VAULT): string | null =>
    pageReferenceUrl('buf-1', NOTE, root, reference)

  it('points at the path relative to the root, never at the disk', () => {
    // The absolute path is not in the address at all: the frame is told which
    // page it is and where inside that page's root to look, and main is the
    // only side that knows what those add up to.
    expect(url('logo.png')).toBe('orrery-page://asset/buf-1/notes/logo.png')
  })

  it('follows a reference up into a sibling folder inside the root', () => {
    expect(url('../css/theme.css')).toBe('orrery-page://asset/buf-1/css/theme.css')
  })

  it('refuses one that climbs past the root', () => {
    expect(url('../../../.ssh/id_rsa')).toBeNull()
  })

  it('refuses an absolute path the page wrote itself', () => {
    // The whole of the old problem, in one line of somebody else's markup.
    expect(url('/etc/passwd')).toBeNull()
    expect(url('/home/you/.aws/credentials')).toBeNull()
  })

  it('refuses everything when the page has no root', () => {
    expect(url('logo.png', null)).toBeNull()
  })

  it('escapes what a filename can contain', () => {
    expect(url('my pic (1).png')).toBe('orrery-page://asset/buf-1/notes/my%20pic%20(1).png')
    expect(url('a#b.png')).toBe('orrery-page://asset/buf-1/notes/a%23b.png')
  })

  it('is tighter when the page is outside the vault', () => {
    const outside = '/home/you/Downloads/report.html'
    const root = previewRoot(outside, VAULT)
    expect(pageReferenceUrl('b', outside, root, 'report_files/x.png')).toBe(
      'orrery-page://asset/b/report_files/x.png'
    )
    expect(pageReferenceUrl('b', outside, root, '../vault/notes/private.md')).toBeNull()
  })
})

describe('reading the url back', () => {
  it('gives back what was put in, escaping and all', () => {
    expect(parsePageAssetUrl(pageAssetUrl('buf-1', 'notes/my pic (1).png'))).toEqual({
      id: 'buf-1',
      relative: 'notes/my pic (1).png'
    })
  })

  it('refuses anything that is not one of ours', () => {
    expect(parsePageAssetUrl('orrery-asset://local/etc/passwd')).toBeNull()
    expect(parsePageAssetUrl('https://example.com/x.png')).toBeNull()
    expect(parsePageAssetUrl('not a url')).toBeNull()
  })

  it('refuses one naming a page but no file', () => {
    expect(parsePageAssetUrl('orrery-page://asset/buf-1')).toBeNull()
    expect(parsePageAssetUrl('orrery-page://asset/buf-1/')).toBeNull()
  })

  it('cannot be walked out of the page that owns it', () => {
    // A `..` in the address is collapsed by URL parsing before this ever sees
    // it, so the walk cannot reach past the page id — it eats the id instead,
    // and what comes back names some other page that does not exist. The
    // request is then answered by nothing at all, which is the outcome that
    // matters: no arrangement of `..` reads a file outside `buf-1`'s root
    // while still being a request for `buf-1`.
    const parsed = parsePageAssetUrl('orrery-page://asset/buf-1/../../etc/passwd')
    expect(parsed?.id).not.toBe('buf-1')

    // And the path that survives is still confined by the root, wherever it
    // lands. Both layers, on purpose.
    expect(resolveUnderRoot(VAULT, parsed?.relative ?? '')).toMatch(/^\/home\/you\/vault\//)
  })
})
