/**
 * Changed lines, turned into marks on a strip that stands for a whole file.
 *
 * Two surfaces draw these. The minimap lays them over its canvas, which draws a
 * sliding window of lines and needs its own arithmetic for that. The scrollbar
 * ruler lays them over the scroll track, which is the whole document scaled to
 * one height and needs the arithmetic here.
 *
 * Both start from the same run merging, so it lives here rather than in either
 * of them: the two were about to disagree on what counts as one hunk.
 */

/** A block of consecutive lines sharing a colour. */
export interface ChangeRun {
  from: number
  to: number
  colour: string
}

/** A run placed on the strip, in CSS pixels from its top. */
export interface Band {
  top: number
  height: number
  colour: string
}

/**
 * Consecutive lines of one colour are one band, so a hunk reads as a block.
 *
 * Lines arrive as a bag keyed by number because that is what both callers have:
 * the diff maps a row to a tint, git maps a line to a kind. Neither knows which
 * of its lines are adjacent, and drawing them one at a time gives a dotted
 * column where the file has a single edit.
 */
export function mergeRuns(changes: Record<number, string>): ChangeRun[] {
  const lines = Object.keys(changes)
    .map(Number)
    .filter((line) => Number.isInteger(line) && line > 0)
    .sort((a, b) => a - b)

  const runs: ChangeRun[] = []
  for (const line of lines) {
    const colour = changes[line]!
    const last = runs[runs.length - 1]
    if (last && last.to === line - 1 && last.colour === colour) last.to = line
    else runs.push({ from: line, to: line, colour })
  }
  return runs
}

/**
 * Runs placed down a track that represents the file from top to bottom.
 *
 * `minBand` is the whole reason this is not one multiplication. A single
 * changed line in a file of three thousand is a third of a pixel, which paints
 * as nothing at all, so a band is grown to a floor and then pushed back inside
 * the track. Growing without pushing is what puts a mark on the last line of a
 * file half off the bottom of the strip, where it cannot be seen either.
 *
 * Lines past the end of the document are dropped rather than clamped. A diff
 * computed a moment ago can name a line that has since been deleted, and a mark
 * pinned to the bottom of the track would claim a change at the end of a file
 * that has none.
 */
export function rulerBands(
  runs: ChangeRun[],
  docLines: number,
  trackHeight: number,
  minBand: number
): Band[] {
  if (docLines <= 0 || trackHeight <= 0) return []

  const bands: Band[] = []
  for (const run of runs) {
    if (run.from > docLines) continue
    const to = Math.min(run.to, docLines)
    const perLine = trackHeight / docLines
    const height = Math.min(trackHeight, Math.max(minBand, (to - run.from + 1) * perLine))
    const top = Math.min((run.from - 1) * perLine, trackHeight - height)
    bands.push({ top: Math.max(0, top), height, colour: run.colour })
  }
  return bands
}
