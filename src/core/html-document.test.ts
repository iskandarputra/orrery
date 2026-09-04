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

  it('grants no scripts at all by default', () => {
    // Not a narrower script-src — none at all, so `default-src 'none'` answers
    // for it and anything added to the web platform later is refused too.
    expect(policyOf()).not.toMatch(/script-src/)
  })

  it('lets a file reach its own folder for styles, pictures and fonts', () => {
    const policy = policyOf()
    expect(policy).toContain('img-src data: orrery-asset:')
    expect(policy).toContain("style-src 'unsafe-inline' orrery-asset:")
    expect(policy).toContain('font-src data: orrery-asset:')
  })

  it('keeps the network out until it is asked for', () => {
    expect(policyOf()).not.toContain('https:')
  })

  it('opens everything a page needs to look like itself', () => {
    // Pictures, and the stylesheet and webfont that decide what the words look
    // like. A document that arrives in the wrong typeface because its font was
    // refused has not really been shown.
    const policy = policyOf({ allowRemote: true })
    expect(policy).toContain('img-src data: orrery-asset: https:')
    expect(policy).toContain('media-src data: orrery-asset: https:')
    expect(policy).toContain("style-src 'unsafe-inline' orrery-asset: https:")
    expect(policy).toContain('font-src data: orrery-asset: https:')
  })

  it('still does not open it to code', () => {
    // The one thing remote content never covers, at any setting.
    expect(policyOf({ allowRemote: true })).not.toMatch(/script-src/)
  })

  it('runs the page’s own scripts only when asked', () => {
    expect(policyOf({ allowScripts: true })).toContain("script-src 'unsafe-inline' orrery-asset:")
  })

  it('never runs code fetched from the internet, whatever else is allowed', () => {
    // Fetching a picture from the internet tells somebody you opened their
    // file. Fetching *code* hands them the inside of the page you are reading.
    // The second is not offered, and asking for both must not conjure it.
    const policy = policyOf({ allowScripts: true, allowRemote: true })
    expect(policy).toContain("script-src 'unsafe-inline' orrery-asset:;")
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
