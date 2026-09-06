import { describe, expect, it } from 'vitest'
import {
  READER_FILE,
  READER_HOST,
  READER_SCRIPT,
  READY,
  UPDATE,
  readerScriptUrl
} from './preview-reader'

/**
 * The only code that runs inside a document nobody vouched for.
 *
 * **What it does is deliberately not tested here.** The obvious unit test —
 * run the script in a jsdom iframe and post messages at it — passes whatever
 * the script says, because jsdom delivers a message with `event.source` set to
 * `null`. The script identifies the app by that source, so under jsdom it
 * rejects *everything*, and a suite of "it ignores X" cases all go green
 * without ever exercising a rejection. The one case that would have caught it
 * is "it accepts a real update", which failed and is what gave the game away.
 *
 * So the behaviour is proved in `e2e/html-reader.spec.ts`, in a browser where
 * `event.source` is a window: that a rebuild keeps the reader's place is the
 * update path working end to end. What is left here is what a string can
 * honestly answer for — where the script is served from, and what it does not
 * contain.
 */

describe('where it is served from', () => {
  it('builds the url out of the host and file it declares', () => {
    expect(readerScriptUrl('orrery-preview')).toBe(`orrery-preview://${READER_HOST}${READER_FILE}`)
    expect(readerScriptUrl('orrery-preview')).toBe('orrery-preview://reader/reader.js')
  })

  it('is a host of its own, not a path among the pages', () => {
    // `orrery-preview://page/<id>` is where documents live. The reader must not
    // be reachable by asking for a page, and naming this whole URL in
    // `script-src` is what stops a page becoming a script source.
    expect(READER_HOST).not.toBe('page')
    const url = new URL(readerScriptUrl('orrery-preview'))
    expect(url.host).toBe(READER_HOST)
    expect(url.pathname).toBe(READER_FILE)
  })
})

describe('the script itself', () => {
  it('agrees with the message names the app uses', () => {
    // It is a string and cannot import the constants beside it, so this is the
    // only thing stopping the two drifting apart.
    expect(READER_SCRIPT).toContain(JSON.stringify(READY))
    expect(READER_SCRIPT).toContain(JSON.stringify(UPDATE))
  })

  it('checks who sent a message before acting on it', () => {
    expect(READER_SCRIPT).toContain('event.source !== parentWindow')
  })

  it('reaches for nothing it has no business reaching for', () => {
    // Everything this runs beside is somebody else's document. The list is
    // short because the script is: anything here appearing in it is either a
    // way out of the sandbox or a way to damage the page it is helping.
    for (const forbidden of [
      'cookie',
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'fetch(',
      'XMLHttpRequest',
      'WebSocket',
      'innerHTML',
      'eval('
    ]) {
      expect(READER_SCRIPT, forbidden).not.toContain(forbidden)
    }
  })

  it('sends the app one message, carrying nothing but its name', () => {
    // A reader that reported anything about the document would be a channel
    // out of a sandbox for no gain: the app already has the source it sent in.
    const posts = READER_SCRIPT.match(/postMessage\([^)]*\)/g) ?? []
    expect(posts).toHaveLength(1)
    expect(posts[0]).toContain(JSON.stringify(READY))
    expect(posts[0]).not.toContain('document')
  })
})
