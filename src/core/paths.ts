/**
 * Browser-safe path helpers (renderer cannot use node:path).
 * Handles both `/` and `\` separators.
 */

export function basename(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return idx === -1 ? trimmed : trimmed.slice(idx + 1)
}

export function dirname(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (idx === -1) return '.'
  if (idx === 0) return trimmed.slice(0, 1)
  return trimmed.slice(0, idx)
}

export function extname(p: string): string {
  const base = basename(p)
  const idx = base.lastIndexOf('.')
  return idx <= 0 ? '' : base.slice(idx)
}

/** Strip the extension from a file name for display. */
export function stem(p: string): string {
  const base = basename(p)
  const ext = extname(p)
  return ext ? base.slice(0, -ext.length) : base
}

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mdwn', '.mdtxt'])

export function isMarkdownFile(p: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extname(p).toLowerCase())
}
