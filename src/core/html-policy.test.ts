import { describe, expect, it } from 'vitest'
import {
  allowedAttributes,
  allowedTags,
  isAllowedAttribute,
  isAllowedTag,
  isSafeUrl
} from './html-policy'

describe('tags', () => {
  it('allows what a README is made of', () => {
    for (const tag of ['h1', 'p', 'div', 'img', 'a', 'br', 'details', 'summary', 'kbd', 'sub']) {
      expect(isAllowedTag(tag), tag).toBe(true)
    }
  })

  it('allows nothing that runs, loads or frames anything', () => {
    for (const tag of ['script', 'iframe', 'object', 'embed', 'link', 'style', 'meta', 'form']) {
      expect(isAllowedTag(tag), tag).toBe(false)
    }
  })

  it('does not care how the tag was capitalised', () => {
    expect(isAllowedTag('IMG')).toBe(true)
    expect(isAllowedTag('ScRiPt')).toBe(false)
  })

  it('has no tag on the list that can carry script', () => {
    // The guard on the list itself: adding one of these later should fail here
    // rather than in somebody's vault.
    expect(allowedTags()).not.toContain('script')
    expect(allowedTags()).not.toContain('iframe')
    expect(allowedTags()).not.toContain('svg')
  })
})

describe('attributes', () => {
  it('keeps the ones that carry meaning', () => {
    expect(isAllowedAttribute('p', 'align')).toBe(true)
    expect(isAllowedAttribute('img', 'src')).toBe(true)
    expect(isAllowedAttribute('img', 'alt')).toBe(true)
    expect(isAllowedAttribute('a', 'href')).toBe(true)
    expect(isAllowedAttribute('td', 'colspan')).toBe(true)
  })

  it('drops every handler, whatever it is called', () => {
    for (const attribute of ['onclick', 'onerror', 'onload', 'onmouseover']) {
      expect(isAllowedAttribute('img', attribute), attribute).toBe(false)
      expect(isAllowedAttribute('div', attribute), attribute).toBe(false)
    }
  })

  it('drops style, which could paint over the application', () => {
    expect(isAllowedAttribute('div', 'style')).toBe(false)
  })

  it('does not let one tag borrow another tag’s attributes', () => {
    expect(isAllowedAttribute('p', 'href')).toBe(false)
    expect(isAllowedAttribute('span', 'src')).toBe(false)
  })

  it('has nothing to offer a tag that is not allowed at all', () => {
    expect(allowedAttributes('script')).toEqual([])
  })
})

describe('isSafeUrl', () => {
  it('allows the schemes a note legitimately points at', () => {
    expect(isSafeUrl('https://img.shields.io/badge/a-b-blue.svg')).toBe(true)
    expect(isSafeUrl('http://example.com')).toBe(true)
    expect(isSafeUrl('mailto:ada@example.com')).toBe(true)
    expect(isSafeUrl('orrery-asset:///vault/pic.png')).toBe(true)
  })

  it('allows a relative path, which is the common case for an image', () => {
    expect(isSafeUrl('assets/diagram.png')).toBe(true)
    expect(isSafeUrl('./pic.png')).toBe(true)
    expect(isSafeUrl('#section')).toBe(true)
  })

  it('refuses javascript, whatever it is dressed as', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeUrl('JavaScript:alert(1)')).toBe(false)
    // Control characters are how a naive check gets past: browsers strip them
    // before deciding what the scheme is.
    expect(isSafeUrl('java\nscript:alert(1)')).toBe(false)
    expect(isSafeUrl('java\tscript:alert(1)')).toBe(false)
    expect(isSafeUrl(' javascript:alert(1)')).toBe(false)
  })

  it('refuses other ways of carrying a document in a URL', () => {
    expect(isSafeUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false)
    expect(isSafeUrl('vbscript:msgbox(1)')).toBe(false)
    expect(isSafeUrl('file:///etc/passwd')).toBe(false)
  })

  it('allows a base64 image, and only an image', () => {
    expect(isSafeUrl('data:image/png;base64,iVBORw0KGgo=', true)).toBe(true)
    expect(isSafeUrl('data:image/svg+xml;base64,PHN2Zz4=', true)).toBe(true)
    // Not for an href, where it is a document rather than a picture.
    expect(isSafeUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(false)
    expect(isSafeUrl('data:text/html;base64,PGh0bWw+', true)).toBe(false)
  })

  it('refuses nothing at all', () => {
    expect(isSafeUrl('')).toBe(false)
    expect(isSafeUrl('   ')).toBe(false)
  })
})
