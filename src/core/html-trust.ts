/**
 * Which HTML pages have been allowed to do more than be displayed.
 *
 * The reader renders a document nobody vouched for, so it holds two things back
 * until asked: the page's own code, and anything it wants from the internet.
 * Both were per buffer and forgotten the moment the tab closed, which made the
 * offer honest and made it tiring. A page you keep coming back to asked again
 * every time, and a question asked that often stops being read.
 *
 * So consent is remembered. The awkward part is what to remember it against. A
 * browser scopes a permission to an origin, which is stable: the thing you
 * agreed with is still the thing on the other end tomorrow. A file path is not
 * stable in that way. `report.html` is a name, and the bytes behind it can be
 * replaced by a sync client, a `git pull` or a second download, with nothing on
 * screen to say the page you trusted has been swapped for another one.
 *
 * So an entry names both: the path, and a digest of the file as it was when the
 * consent was given. Different bytes at the same path are a different document
 * and the offer comes back. That is the whole of what this module decides, and
 * it is pure string work so the decision can be argued with in a test rather
 * than in a browser.
 *
 * Two things it deliberately does not do. It does not expire: time passing is
 * not evidence about a file. And it does not grow without limit, because a
 * settings file that only ever gets longer is a slow leak: past `TRUST_LIMIT`
 * the least recently changed entry goes, and that page asks again.
 */

/** What a page has been allowed to do. */
export interface HtmlGrant {
  /** Run the scripts the document itself carries. Never remote code. */
  readonly scripts: boolean
  /** Fetch the pictures, stylesheets and webfonts it links to. */
  readonly remote: boolean
}

export interface HtmlTrustEntry extends HtmlGrant {
  /** The file as it was when this was granted. See `fingerprint`. */
  readonly fingerprint: string
  /** When the entry last changed, which is what eviction goes by. */
  readonly at: number
}

/** By absolute path. Written to settings, so it has to survive a round trip. */
export type HtmlTrustMap = Readonly<Record<string, HtmlTrustEntry>>

export const NOTHING_GRANTED: HtmlGrant = { scripts: false, remote: false }

/** How many pages are remembered before the least recent one is dropped. */
export const TRUST_LIMIT = 200

/**
 * A digest of the document the consent was about.
 *
 * SHA-256 through WebCrypto, which both a renderer and a bare Node process
 * have, so this one function serves the reader and its tests without either of
 * them reaching for `node:crypto`. Asynchronous as a result, which is why every
 * other function here takes the digest rather than the source: the decisions
 * stay synchronous and pure, and only the hashing has to be awaited.
 *
 * A cheap non-cryptographic hash would be enough to notice an honest change and
 * useless against a deliberate one. Somebody who can write into the folder you
 * are reading from can pad a file until a 32-bit hash agrees; making them find
 * a SHA-256 second preimage instead is the difference between a check and the
 * appearance of one.
 */
export async function fingerprint(source: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * What this exact document at this exact path may do.
 *
 * A path with no entry, or an entry about different bytes, grants nothing. It
 * never returns a partial match: the point of the digest is that a page you did
 * not vouch for gets no part of what you gave another one.
 */
export function trustedFor(trust: HtmlTrustMap, path: string | null, digest: string): HtmlGrant {
  if (!path) return NOTHING_GRANTED
  const entry = trust[path]
  if (!entry || entry.fingerprint !== digest) return NOTHING_GRANTED
  return { scripts: entry.scripts, remote: entry.remote }
}

/**
 * Record what a page has been allowed to do, as it is now.
 *
 * Returns the map it was given when nothing would change, so a caller can skip
 * the write by identity. The reader leans on that: it records consent on every
 * rebuild rather than only where the button is pressed, which keeps the digest
 * following a file its author is editing, and without this it would write to
 * settings on every keystroke next door.
 *
 * Granting nothing removes the entry rather than storing a row of `false`. An
 * absent entry and an entry that permits nothing mean the same thing, and only
 * one of them keeps the path on disk.
 */
export function remember(
  trust: HtmlTrustMap,
  path: string,
  digest: string,
  grant: HtmlGrant,
  now: number,
  limit = TRUST_LIMIT
): HtmlTrustMap {
  if (!grant.scripts && !grant.remote) return withdraw(trust, path)

  const current = trust[path]
  if (
    current &&
    current.fingerprint === digest &&
    current.scripts === grant.scripts &&
    current.remote === grant.remote
  ) {
    return trust
  }

  const next: Record<string, HtmlTrustEntry> = {
    ...trust,
    [path]: { fingerprint: digest, scripts: grant.scripts, remote: grant.remote, at: now }
  }

  // Oldest first, and only ever one over: the map is written one entry at a
  // time, so it cannot arrive here more than one past the limit unless the
  // limit itself changed under it.
  const paths = Object.keys(next)
  if (paths.length > limit) {
    const byAge = paths.sort((a, b) => next[a]!.at - next[b]!.at)
    for (const stale of byAge.slice(0, paths.length - limit)) delete next[stale]
  }
  return next
}

/** Forget a page entirely, which is what the reader's own Stop does. */
export function withdraw(trust: HtmlTrustMap, path: string): HtmlTrustMap {
  if (!(path in trust)) return trust
  const next = { ...trust }
  delete next[path]
  return next
}
