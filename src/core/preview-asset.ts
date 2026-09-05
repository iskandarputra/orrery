import { dirname } from './paths'

/**
 * What a page being read is allowed to load off the disk.
 *
 * The HTML reader shows a document nobody vouched for, and a page needs its own
 * pictures, stylesheet and webfont to look like itself — so it has to reach the
 * disk somehow. It used to reach it the way the app's own surfaces do, over
 * `orrery-asset:`, which serves any absolute path there is. That is the right
 * answer for a surface the user drove to: you can only look at a PDF you chose
 * to open. It is the wrong answer for a document that writes its own addresses,
 * because `<img src="orrery-asset://local/home/you/.ssh/id_rsa">` is a thing an
 * untrusted page can simply say.
 *
 * Nothing was readable *out* of that — the frame is an opaque origin with no
 * `connect-src` and the asset responses carry no CORS headers, so a page could
 * never see a byte of what it named. But with scripts allowed it could tell
 * whether a load succeeded, and with remote content allowed it could say so to
 * somebody. A list of which files you have is worth having.
 *
 * So the frame gets a scheme of its own instead, and this is the whole of what
 * it may ask for. The app's own `orrery-asset:` is untouched and stays exactly
 * as broad as it was: the two callers have different needs and no longer share
 * an answer.
 *
 * Pure string work, deliberately. Where the boundary is drawn is the security
 * property, and it should be arguable without a filesystem or a browser.
 */

export const PAGE_SCHEME = 'orrery-page'

/** Splits on either separator, so one set of rules covers both platforms. */
const SEPARATOR = /[\\/]/

/** Absolute in the POSIX sense, in the Windows sense, or UNC. */
function isAbsolutePath(p: string): boolean {
  return /^([\\/]|[a-zA-Z]:)/.test(p)
}

/** The separator this root is written with, so a result matches its input. */
function separatorOf(root: string): string {
  return root.includes('\\') ? '\\' : '/'
}

/** Root without a trailing separator, split into the segments it is made of. */
function rootSegments(root: string): string[] {
  return root.replace(/[\\/]+$/, '').split(SEPARATOR)
}

/**
 * A path under `root`, or null if it is not one.
 *
 * `relative` may not be absolute and may not climb out with `..`, and the root
 * directory itself is not an answer — a page asks for files, not for folders.
 * The check is by segment rather than by string prefix on purpose: a prefix
 * test says `/vault-backup/secrets` is inside `/vault`.
 */
export function resolveUnderRoot(root: string, relative: string): string | null {
  if (!root || !relative || relative.includes('\0')) return null
  if (isAbsolutePath(relative)) return null

  const segments = rootSegments(root)
  const depth = segments.length

  for (const part of relative.split(SEPARATOR)) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (segments.length <= depth) return null
      segments.pop()
      continue
    }
    segments.push(part)
  }

  if (segments.length === depth) return null
  return segments.join(separatorOf(root))
}

/** Whether an absolute path sits inside a root, by segment, not by prefix. */
export function isUnderRoot(root: string, absolute: string): boolean {
  if (!root || !absolute) return false
  const base = rootSegments(root)
  const parts = absolute.replace(/[\\/]+$/, '').split(SEPARATOR)
  if (parts.length <= base.length) return false
  return base.every((segment, i) => segment === parts[i])
}

/**
 * The folder a page may read from.
 *
 * The vault when the page is in it, so that a documentation export dropped into
 * a vault still finds the `../css/theme.css` it was written against — those
 * files are the user's own, and a note beside them could already load any of
 * them. Otherwise the page's own folder, which is as much as a file opened from
 * a downloads directory has any business seeing.
 *
 * Null for a buffer with nowhere on disk to be: it has no folder, so it gets no
 * files, and every relative reference in it stays exactly as it was written.
 */
export function previewRoot(docPath: string | null, vaultRoot: string | null): string | null {
  if (!docPath) return null
  if (vaultRoot && isUnderRoot(vaultRoot, docPath)) return vaultRoot
  return dirname(docPath) || null
}

/** Each segment escaped, so a space or a `#` in a filename survives the trip. */
function encodePath(path: string): string {
  return path.split(SEPARATOR).filter(Boolean).map(encodeURIComponent).join('/')
}

/** `orrery-page://asset/<preview id>/<path relative to the root>`. */
export function pageAssetUrl(previewId: string, relative: string): string {
  return `${PAGE_SCHEME}://asset/${encodeURIComponent(previewId)}/${encodePath(relative)}`
}

/** What a request is asking for, or null if it is not one of ours. */
export function parsePageAssetUrl(url: string): { id: string; relative: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${PAGE_SCHEME}:`) return null

  let segments: string[]
  try {
    segments = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    return null
  }
  const [id, ...rest] = segments
  if (!id || rest.length === 0) return null
  return { id, relative: rest.join('/') }
}

/**
 * The address to give one reference in a page, or null to leave it alone.
 *
 * Null covers both "there is nothing to resolve" and "that is outside the
 * root". They are the same outcome on purpose: a reference this refuses keeps
 * the text the page gave it, which resolves against `orrery-preview:` and
 * fetches nothing. A page cannot tell a refusal from a file that is not there,
 * which is the point.
 */
export function pageReferenceUrl(
  previewId: string,
  docPath: string | null,
  root: string | null,
  reference: string
): string | null {
  if (!root || !docPath || !reference || reference.includes('\0')) return null

  // Resolved against the document first, because that is what the reference
  // means; then expressed against the root, which is what decides whether it
  // is allowed. A page saying `../img/x.png` is ordinary, and whether it is
  // reaching for a sibling folder or for the disk depends only on where the
  // root is.
  const absolute = isAbsolutePath(reference) ? reference : `${dirname(docPath)}/${reference}`
  const relative = relativeToRoot(root, absolute)
  return relative === null ? null : pageAssetUrl(previewId, relative)
}

/** An absolute path as a root-relative one, or null when it is not inside. */
function relativeToRoot(root: string, absolute: string): string | null {
  const base = rootSegments(root)
  const parts = absolute.split(SEPARATOR)

  // Walked segment by segment so `.` and `..` inside the path are settled
  // before the comparison, not after it.
  const settled: string[] = []
  for (const part of parts) {
    if (part === '.') continue
    if (part === '..') {
      if (settled.length === 0) return null
      settled.pop()
      continue
    }
    settled.push(part)
  }
  if (settled.length <= base.length) return null
  if (!base.every((segment, i) => segment === settled[i])) return null
  return settled.slice(base.length).join('/')
}
