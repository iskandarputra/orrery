/**
 * Commit history, and the lane layout that draws it as a graph.
 *
 * Two separable jobs: reading `git log`'s output, and deciding which column
 * each commit sits in. Both are pure, because the lane assignment is the part
 * that is easy to get subtly wrong — a lane reused one row too early puts an
 * edge through an unrelated commit — and it is only checkable by construction.
 */

/** Fields are separated by U+001F and commits by NUL, as the log command asks. */
const FIELD = '\u001f'

export interface Commit {
  hash: string
  parents: string[]
  author: string
  /** Relative, as git formats it: "3 days ago". */
  date: string
  /** Branch and tag names pointing here, already split. */
  refs: string[]
  subject: string
  /**
   * The message below the subject, trimmed. Usually empty.
   *
   * Carried on every commit so that hovering a row can show the whole message
   * without asking git a second time. The alternative is a request per hover,
   * which is a request per row the pointer crosses on the way.
   */
  body: string
}

export interface GraphCommit extends Commit {
  /** Column this commit's dot sits in. */
  lane: number
  /**
   * The commit each lane is waiting for, immediately *after* this row. A
   * non-null slot means a line continues downward into the next row.
   */
  lanes: (string | null)[]
  /** Lanes this commit's parents continue in, for drawing its outgoing edges. */
  parentLanes: number[]
}

export function parseGitLog(stdout: string): Commit[] {
  return stdout
    .split('\0')
    .filter((entry) => entry.trim().length > 0)
    .flatMap((entry) => {
      const [hash, parents, author, date, refs, subject, body] = entry.split(FIELD)
      if (!hash) return []
      return [
        {
          hash,
          parents: (parents ?? '').split(' ').filter(Boolean),
          author: author ?? '',
          date: date ?? '',
          refs: (refs ?? '')
            .split(',')
            .map((r) => r.trim())
            .filter(Boolean),
          subject: subject ?? '',
          body: (body ?? '').trim()
        }
      ]
    })
}

/** First lane holding `hash`, or -1. */
function laneOf(lanes: (string | null)[], hash: string): number {
  return lanes.indexOf(hash)
}

/** Lowest free lane, widening the row only when every lane is busy. */
function freeLane(lanes: (string | null)[]): number {
  const index = lanes.indexOf(null)
  if (index !== -1) return index
  lanes.push(null)
  return lanes.length - 1
}

/**
 * Assign each commit a lane.
 *
 * Walks the log in order, keeping one slot per line of development. A commit
 * takes the lane that was waiting for it — or a new one if nothing was, which
 * is what a branch tip looks like — and then hands that lane to its first
 * parent, so history reads straight down. A merge's remaining parents take
 * lanes of their own.
 *
 * A parent already waiting in another lane is never duplicated: two branches
 * meeting must converge on one line rather than draw two.
 */
export function layoutGraph(commits: Commit[]): GraphCommit[] {
  const lanes: (string | null)[] = []
  const out: GraphCommit[] = []

  for (const commit of commits) {
    let lane = laneOf(lanes, commit.hash)
    if (lane === -1) lane = freeLane(lanes)

    // Clear every lane waiting for this commit; more than one can be, when
    // several children pointed at it.
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === commit.hash) lanes[i] = null
    }

    const parentLanes: number[] = []
    commit.parents.forEach((parent, index) => {
      const existing = laneOf(lanes, parent)
      if (existing !== -1) {
        parentLanes.push(existing)
        return
      }
      const target = index === 0 ? lane : freeLane(lanes)
      lanes[target] = parent
      parentLanes.push(target)
    })

    // Trailing empty lanes draw nothing; dropping them keeps the graph as
    // narrow as the history actually is.
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()

    out.push({ ...commit, lane, lanes: [...lanes], parentLanes })
  }

  return out
}

/**
 * The lines one row has to draw: which lanes enter it from above, and which
 * leave it below.
 *
 * The graph is drawn as one SVG per row — a row is a fixed height and can draw
 * itself without knowing where the others ended up — and the cost of that is
 * this: a line crossing a row belongs to that row, so the row must be told
 * about it. `lanes` only ever said what continues *downward*, so a lane
 * passing through was drawn from the middle of the row to its bottom and the
 * top half was left empty. Half a line, then half a gap, for every row a lane
 * crossed.
 *
 * `previous` is the row above, or null for the newest commit. Its lanes are
 * exactly the lines arriving here, which also settles the other half of the
 * question: a branch tip has nothing waiting for it above, so nothing is drawn
 * running off the top edge towards a row that does not exist.
 */
export function laneRuns(
  previous: GraphCommit | null,
  commit: GraphCommit
): { arriving: number[]; leaving: number[] } {
  const active = (lanes: (string | null)[]): number[] =>
    lanes.flatMap((waiting, lane) => (waiting ? [lane] : []))

  const arriving = active(previous?.lanes ?? [])

  /**
   * Lanes this commit opens for a merge, which the curve draws instead.
   *
   * Only the ones that are new: a lane already running through this row is
   * converging rather than opening, and it keeps the straight line it has
   * every right to — the curve there is just this commit joining it.
   */
  const opened = commit.parentLanes.filter(
    (lane) => lane !== commit.lane && !arriving.includes(lane)
  )

  return {
    arriving,
    leaving: active(commit.lanes).filter((lane) => !opened.includes(lane))
  }
}

/** How many columns the whole graph needs. */
export function graphWidth(commits: GraphCommit[]): number {
  return commits.reduce(
    (max, c) => Math.max(max, c.lane + 1, c.lanes.length, ...c.parentLanes.map((l) => l + 1)),
    1
  )
}
