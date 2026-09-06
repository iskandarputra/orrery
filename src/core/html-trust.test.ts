import { describe, it, expect } from 'vitest'
import {
  fingerprint,
  remember,
  trustedFor,
  withdraw,
  NOTHING_GRANTED,
  type HtmlTrustMap
} from './html-trust'

/**
 * What the reader is allowed to remember about a page.
 *
 * Every case below that says "and gets nothing" would pass against a function
 * that always returns nothing, which is most of a security check's test suite
 * and the reason none of them are trusted on their own. The one that decides
 * whether this module works is the one asserting a match is honoured.
 */

const grant = { scripts: true, remote: false }

describe('fingerprint', () => {
  it('is SHA-256 of the source, not an agreement with itself', async () => {
    // Against a published vector, so a digest that is merely self-consistent
    // fails here. Any of the cheap hashes this could have been would.
    expect(await fingerprint('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })

  it('changes when one character of the page changes', async () => {
    const before = await fingerprint('<p>hello</p>')
    const after = await fingerprint('<p>hellp</p>')
    expect(after).not.toBe(before)
    expect(await fingerprint('<p>hello</p>')).toBe(before)
  })
})

describe('trustedFor', () => {
  const trust: HtmlTrustMap = {
    '/vault/report.html': { fingerprint: 'aaa', scripts: true, remote: true, at: 1 }
  }

  it('honours a page that is still the page it was', () => {
    expect(trustedFor(trust, '/vault/report.html', 'aaa')).toEqual({ scripts: true, remote: true })
  })

  it('grants nothing for the same name holding different bytes', () => {
    // The case the digest exists for: a sync client, a second download or a
    // `git pull` replaces the file, and the name alone would carry the consent
    // over to a document nobody has seen.
    expect(trustedFor(trust, '/vault/report.html', 'bbb')).toEqual(NOTHING_GRANTED)
  })

  it('grants nothing for a page never seen, or a buffer with no file', () => {
    expect(trustedFor(trust, '/vault/other.html', 'aaa')).toEqual(NOTHING_GRANTED)
    expect(trustedFor(trust, null, 'aaa')).toEqual(NOTHING_GRANTED)
  })

  it('does not hand out one page’s consent in part', () => {
    const partial: HtmlTrustMap = {
      '/vault/a.html': { fingerprint: 'aaa', scripts: true, remote: false, at: 1 }
    }
    expect(trustedFor(partial, '/vault/a.html', 'aaa')).toEqual({ scripts: true, remote: false })
  })
})

describe('remember', () => {
  it('records what a page was allowed, against the bytes it had', () => {
    const next = remember({}, '/vault/a.html', 'aaa', grant, 5)
    expect(next['/vault/a.html']).toEqual({
      fingerprint: 'aaa',
      scripts: true,
      remote: false,
      at: 5
    })
  })

  it('returns the very same map when nothing would change', () => {
    // Identity, not equality. The reader records on every rebuild, so this is
    // what keeps a keystroke in the pane next door from writing to settings.
    const first = remember({}, '/vault/a.html', 'aaa', grant, 5)
    expect(remember(first, '/vault/a.html', 'aaa', grant, 9)).toBe(first)
  })

  it('follows the file when its author edits it', () => {
    const first = remember({}, '/vault/a.html', 'aaa', grant, 5)
    const second = remember(first, '/vault/a.html', 'bbb', grant, 9)
    expect(second).not.toBe(first)
    expect(second['/vault/a.html']?.fingerprint).toBe('bbb')
    expect(trustedFor(second, '/vault/a.html', 'bbb')).toEqual(grant)
  })

  it('drops the row when the last consent is withdrawn', () => {
    // An absent entry and an entry permitting nothing mean the same thing, and
    // only one of them keeps the path on disk.
    const first = remember({}, '/vault/a.html', 'aaa', { scripts: true, remote: true }, 5)
    const none = remember(first, '/vault/a.html', 'aaa', { scripts: false, remote: false }, 9)
    expect('/vault/a.html' in none).toBe(false)
  })

  it('evicts the least recent page rather than growing without limit', () => {
    let trust: HtmlTrustMap = {}
    for (let i = 0; i < 4; i++) {
      trust = remember(trust, `/vault/${i}.html`, 'aaa', grant, i, 3)
    }
    expect(Object.keys(trust).sort()).toEqual(['/vault/1.html', '/vault/2.html', '/vault/3.html'])
    // And the page that fell out asks again, which is the point of a limit
    // rather than a silent overwrite.
    expect(trustedFor(trust, '/vault/0.html', 'aaa')).toEqual(NOTHING_GRANTED)
  })
})

describe('withdraw', () => {
  it('forgets the page', () => {
    const first = remember({}, '/vault/a.html', 'aaa', grant, 5)
    expect(trustedFor(withdraw(first, '/vault/a.html'), '/vault/a.html', 'aaa')).toEqual(
      NOTHING_GRANTED
    )
  })

  it('returns the same map for a page it was never told about', () => {
    const first = remember({}, '/vault/a.html', 'aaa', grant, 5)
    expect(withdraw(first, '/vault/b.html')).toBe(first)
  })
})
