/**
 * What a link means, once its candidates are known.
 *
 * The vault draws two kinds of edge and they find candidates in genuinely
 * different ways: a wikilink matches a title, an import walks a relative path
 * and guesses an extension. What they must not do differently is decide what 0,
 * 1 or N candidates mean. Five places used to answer that and three disagreed:
 * `resolveNote` took the first stem match in the directory walk, `buildGraph`
 * kept the last, and the backlinks panel matched all of them. A vault holding
 * two `store.md` opened one file on a click and drew the edge to the other.
 *
 * The ordering below is total on purpose. Ranking by folder alone leaves ties,
 * and a tie resolved by input order is the bug again wearing a rule.
 */

import { dirname } from './paths'

export type Resolution =
  /** `ambiguous` records that a choice was made, so a panel can say so. */
  | { status: 'resolved'; to: string; ambiguous: boolean }
  | { status: 'ambiguous'; candidates: string[] }
  /** `at` is what was looked for: a wikilink target, or an attempted path. */
  | { status: 'missing'; at: string }
  | { status: 'external' }

/**
 * What to do with more than one candidate.
 *
 * `nearest` is for wikilinks, which are written inside a file, in a folder, and
 * every wiki convention reads that folder as part of the link. `refuse` is for
 * a bare import specifier, which carries no path evidence at all: choosing
 * between two `pane.rs` would be wrong half the time, and a wrong edge in a map
 * is worse than a missing one.
 */
export type TieBreak = 'nearest' | 'refuse'

const segments = (path: string): string[] => path.split('/').filter(Boolean)

/** Leading folders two files share, counting neither file's own name. */
function sharedFolders(a: string, b: string): number {
  const left = segments(a)
  const right = segments(b)
  let shared = 0
  while (shared < left.length - 1 && shared < right.length - 1 && left[shared] === right[shared]) {
    shared++
  }
  return shared
}

/**
 * Candidates, nearest first.
 *
 * Same folder, then the nearest shared folder, then the shallowest path, then
 * the path itself. The last two exist to make the order total: without them two
 * candidates equally far away would keep whatever order they arrived in.
 */
export function rankCandidates(fromPath: string, candidates: readonly string[]): string[] {
  const home = dirname(fromPath)
  return [...candidates].sort((a, b) => {
    const sameFolder = Number(dirname(b) === home) - Number(dirname(a) === home)
    if (sameFolder !== 0) return sameFolder
    const shared = sharedFolders(fromPath, b) - sharedFolders(fromPath, a)
    if (shared !== 0) return shared
    const depth = segments(a).length - segments(b).length
    if (depth !== 0) return depth
    return a < b ? -1 : a > b ? 1 : 0
  })
}

/**
 * The one decision both edge types share.
 *
 * `whenEmpty` is supplied by the caller rather than inferred, because "nothing
 * matched" means different things on the two sides: a wikilink to nothing is a
 * note somebody intends to write, `import 'react'` is a real dependency that is
 * not in this folder, and `import './editorr'` is broken. Only the caller knows
 * which of those it is holding.
 */
export function resolve(
  fromPath: string,
  candidates: readonly string[],
  options: { tieBreak: TieBreak; whenEmpty: Resolution }
): Resolution {
  if (candidates.length === 0) return options.whenEmpty
  // The overwhelmingly common case, checked before ranking rather than after:
  // one candidate needs no comparator, and `rankCandidates` would still spread
  // and sort a one-element array to find that out. Tens of thousands of these
  // run per graph build, one per link, and almost none of them are ambiguous.
  if (candidates.length === 1) return { status: 'resolved', to: candidates[0]!, ambiguous: false }
  const ranked = rankCandidates(fromPath, candidates)
  if (options.tieBreak === 'refuse') return { status: 'ambiguous', candidates: ranked }
  return { status: 'resolved', to: ranked[0]!, ambiguous: true }
}
