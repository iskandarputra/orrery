import { dirname } from './paths'

/** True for absolute URLs we should pass through untouched. */
function isAbsoluteUrl(src: string): boolean {
  return /^(https?:|data:|file:|orrery-asset:)/i.test(src)
}

/** Decode a path segment, tolerating a stray `%` that isn't an escape. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/** Normalize a POSIX-ish path, collapsing `.` and `..` segments. */
function normalize(path: string): string {
  const win = path.includes('\\')
  const sep = win ? '\\' : '/'
  const parts = path.split(/[\\/]+/)
  const out: string[] = []
  for (const part of parts) {
    if (part === '.' || part === '') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  const prefix = path.startsWith('/') ? '/' : win && /^[A-Za-z]:/.test(path) ? '' : ''
  return prefix + out.join(sep)
}

/**
 * Resolve a markdown image src to a loadable URL. Remote/data URLs pass
 * through; local paths resolve against the note's directory and are served
 * over the sandboxed `orrery-asset://` protocol. Returns null when it can't
 * resolve (e.g. relative path with no known document location).
 */
export function resolveAssetUrl(docPath: string | null, src: string): string | null {
  const trimmed = src.trim()
  if (!trimmed) return null
  if (isAbsoluteUrl(trimmed)) return trimmed

  let abs: string
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    abs = normalize(trimmed)
  } else {
    if (!docPath) return null
    abs = normalize(`${dirname(docPath)}/${trimmed}`)
  }
  // orrery-asset://local/<url-encoded-absolute-path>. Markdown destinations are
  // themselves URL-encoded, so each segment is decoded before re-encoding —
  // otherwise `my%20pic.png` becomes `my%2520pic.png` and resolves to nothing.
  const encoded = abs
    .split(/[\\/]/)
    .map((segment) => encodeURIComponent(decodeSegment(segment)))
    .join('/')
  return `orrery-asset://local/${encoded.replace(/^\//, '')}`
}
