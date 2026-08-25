import { contentHash } from './embed-index'

export interface FileStamp {
  path: string
  mtimeMs: number
  size: number
}

/**
 * A cheap identity for the vault's current state, from `stat` alone: no file
 * is read to compute it. If it matches the fingerprint a cached analysis was
 * built from, that analysis is still valid — which turns opening the graph
 * from "read every note" into a directory walk.
 *
 * Sorted by path so the walk order can't change the answer, and size is folded
 * in alongside mtime to catch edits that preserve the timestamp.
 */
export function fingerprintVault(files: readonly FileStamp[]): string {
  const parts = [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => `${file.path}:${file.mtimeMs}:${file.size}`)
  return contentHash(`${parts.length}\n${parts.join('\n')}`)
}
