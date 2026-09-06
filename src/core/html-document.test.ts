import { describe, expect, it } from 'vitest'
import { buildPreview, isHtmlFile } from './html-document'

const options = { allowRemote: false, allowScripts: false }

/** The policy the page is served under, which is the whole of this module. */
const policyOf = (opts: Partial<typeof options> = {}): string =>
  buildPreview('<p>hi</p>', { ...options, ...opts }).policy

describe('which files the reader claims', () => {
  it('takes the html extensions and leaves everything else', () => {
    for (const name of ['page.html', 'PAGE.HTM', 'a/b/index.xhtml']) {
      expect(isHtmlFile(name), name).toBe(true)
    }
    for (const name of ['note.md', 'script.js', 'data.json', 'style.css', 'htmlish']) {
      expect(isHtmlFile(name), name).toBe(false)
    }
  })

  it('does not claim a file that merely has html in its name', () => {
    expect(isHtmlFile('html')).toBe(false)
    expect(isHtmlFile('notes.html.bak')).toBe(false)
  })
})

describe('the policy the document is read under', () => {
  it('refuses everything it does not name', () => {
    expect(policyOf()).toContain("default-src 'none'")
  })

  it('grants the page no script of its own, and the app exactly one', () => {
    // It used to grant none at all. The reader's own script has to run — it is
    // what keeps your place when the page is rebuilt — so the policy now names
    // one file, by its whole URL rather than by its scheme: `orrery-preview:`
    // alone would admit any other document in the preview store as a script.
    const policy = policyOf()
    expect(policy).toContain('script-src orrery-preview://reader/reader.js;')
    // The page's own code is refused by this and nothing else, now that the
    // frame carries `allow-scripts` unconditionally. Both halves matter.
    expect(policy).not.toContain("'unsafe-inline'; ")
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/)
    expect(policy).not.toMatch(/script-src[^;]*orrery-page:/)
  })

  it('lets a file reach its own folder for styles, pictures and fonts', () => {
    // `orrery-page:` and never `orrery-asset:` — the app's own scheme serves
    // any path on the disk, and this document writes its own addresses. See
    // `core/preview-asset`.
    const policy = policyOf()
    expect(policy).toContain('img-src data: orrery-page:')
    expect(policy).toContain("style-src 'unsafe-inline' orrery-page:")
    expect(policy).toContain('font-src data: orrery-page:')
  })

  it('keeps the network out until it is asked for', () => {
    expect(policyOf()).not.toContain('https:')
  })

  it('never names the preview scheme as a whole, only the one file in it', () => {
    // `script-src orrery-preview:` would let a page load another buffer's
    // document as a script. The path is the point.
    for (const opts of [{}, { allowScripts: true }, { allowRemote: true }]) {
      expect(policyOf(opts)).not.toMatch(/script-src[^;]*orrery-preview:(?!\/\/reader)/)
    }
  })

  it('lets nothing repoint what a reference means, at any setting', () => {
    // `stripPageBase` takes the page's own base elements out of the document.
    // This is the same guarantee for a page that has been allowed to run and
    // could otherwise write one at runtime.
    for (const opts of [{}, { allowRemote: true }, { allowScripts: true }]) {
      expect(policyOf(opts)).toContain("base-uri 'none'")
    }
  })

  it('lets a page submit nothing, anywhere', () => {
    expect(policyOf({ allowScripts: true })).toContain("form-action 'none'")
  })

  it('opens everything a page needs to look like itself', () => {
    // Pictures, and the stylesheet and webfont that decide what the words look
    // like. A document that arrives in the wrong typeface because its font was
    // refused has not really been shown.
    const policy = policyOf({ allowRemote: true })
    expect(policy).toContain('img-src data: orrery-page: https:')
    expect(policy).toContain('media-src data: orrery-page: https:')
    expect(policy).toContain("style-src 'unsafe-inline' orrery-page: https:")
    expect(policy).toContain('font-src data: orrery-page: https:')
  })

  it('still does not open it to code', () => {
    // The one thing remote content never covers, at any setting: the page's
    // own scripts stay refused, and no remote source is ever a script source.
    const policy = policyOf({ allowRemote: true })
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/)
    expect(policy).not.toMatch(/script-src[^;]*https:/)
  })

  it('runs the page’s own scripts only when asked', () => {
    const policy = policyOf({ allowScripts: true })
    expect(policy).toMatch(/script-src 'unsafe-inline' orrery-page:/)
    // And the reader stays, so the offer does not cost the page its script.
    expect(policy).toContain('orrery-preview://reader/reader.js')
  })

  it('never runs code fetched from the internet, whatever else is allowed', () => {
    // Fetching a picture from the internet tells somebody you opened their
    // file. Fetching *code* hands them the inside of the page you are reading.
    // The second is not offered, and asking for both must not conjure it.
    const policy = policyOf({ allowScripts: true, allowRemote: true })
    expect(policy).toMatch(/script-src 'unsafe-inline' orrery-page:/)
    expect(policy).not.toMatch(/script-src[^;]*https:/)
  })

  it('never lets a form post anywhere', () => {
    for (const opts of [{}, { allowScripts: true, allowRemote: true }]) {
      expect(policyOf(opts)).toContain("form-action 'none'")
    }
  })
})

describe('what is served', () => {
  it('is the document, untouched', () => {
    // Every change to the page was made before this. The policy is a header
    // now, so nothing has to be written into the markup at all.
    const source = '<!doctype html><html><head></head><body><p>Exactly this.</p></body></html>'
    expect(buildPreview(source, options).html).toBe(source)
  })

  it('notices scripts so the reader can say whether they ran', () => {
    expect(buildPreview('<script src="a.js"></script>', options).hasScripts).toBe(true)
    expect(buildPreview('<p>none here</p>', options).hasScripts).toBe(false)
  })

  it('counts what the document would have fetched', () => {
    const source = `
      <link rel="stylesheet" href="https://cdn.example/site.css">
      <img src="https://images.example/a.png">
      <img src="//images.example/b.png">
      <video poster="http://x.example/p.jpg"></video>
      <style>body { background: url(https://bg.example/c.png) }</style>
    `
    expect(buildPreview(source, options).remoteCount).toBe(5)
  })

  it('counts nothing for a document that stays in its own folder', () => {
    const source = '<link rel="stylesheet" href="site.css"><img src="./logo.png">'
    expect(buildPreview(source, options).remoteCount).toBe(0)
  })

  it('does not count a link somebody could click as something fetched', () => {
    expect(buildPreview('<a href="https://example.com">out</a>', options).remoteCount).toBe(0)
  })

  it('does not count remote code, which the offer never covers', () => {
    // "Load 2 remote items" that loads one of them is a worse answer than
    // saying one. Remote script is not on offer at any setting.
    const source = '<script src="https://cdn.example/x.js"></script><img src="https://i/x.png">'
    expect(buildPreview(source, options).remoteCount).toBe(1)
  })
})
