import { useEffect, useState } from 'react'
import { graphWidth, layoutGraph, type Commit, type GraphCommit } from '@core/git-graph'
import { invoke } from '@/services/client'
import { useStore } from '@/state/store'

/** How much history to draw. Enough to see where you are, not an archive. */
const LIMIT = 120

const LANE_WIDTH = 12
const ROW_HEIGHT = 34
const DOT_RADIUS = 3.5

/**
 * Lane colours, cycled. Deliberately independent of the theme accent: a lane's
 * colour carries identity — which line of development this is — and reusing the
 * accent would tie two unrelated meanings to one hue.
 */
const LANE_COLOURS = ['#7c93ff', '#3fb950', '#d29922', '#f85149', '#bd93f9', '#39c5cf']

const laneColour = (lane: number): string => LANE_COLOURS[lane % LANE_COLOURS.length]!

/**
 * The commit graph, drawn beside the history.
 *
 * One SVG per row rather than one for the whole list: rows are a fixed height,
 * so each can draw its own dot and the segments passing through it without any
 * row needing to know where the others ended up.
 */
function Row({ commit, width }: { commit: GraphCommit; width: number }): React.JSX.Element {
  const w = width * LANE_WIDTH
  const cx = commit.lane * LANE_WIDTH + LANE_WIDTH / 2
  const mid = ROW_HEIGHT / 2

  return (
    <svg className="gitgraph__lanes" width={w} height={ROW_HEIGHT} aria-hidden="true">
      {/* Lines continuing downward through this row, one per still-active lane. */}
      {commit.lanes.map((waiting, lane) =>
        waiting ? (
          <line
            key={`t${lane}`}
            x1={lane * LANE_WIDTH + LANE_WIDTH / 2}
            y1={mid}
            x2={lane * LANE_WIDTH + LANE_WIDTH / 2}
            y2={ROW_HEIGHT}
            stroke={laneColour(lane)}
            strokeWidth="1.5"
          />
        ) : null
      )}
      {/* The line arriving from the row above. */}
      <line x1={cx} y1={0} x2={cx} y2={mid} stroke={laneColour(commit.lane)} strokeWidth="1.5" />
      {/* An edge to each parent that continues in a different lane — a merge. */}
      {commit.parentLanes
        .filter((lane) => lane !== commit.lane)
        .map((lane) => (
          <path
            key={`p${lane}`}
            d={`M ${cx} ${mid} C ${cx} ${ROW_HEIGHT}, ${lane * LANE_WIDTH + LANE_WIDTH / 2} ${mid}, ${
              lane * LANE_WIDTH + LANE_WIDTH / 2
            } ${ROW_HEIGHT}`}
            fill="none"
            stroke={laneColour(lane)}
            strokeWidth="1.5"
          />
        ))}
      <circle
        cx={cx}
        cy={mid}
        r={DOT_RADIUS}
        fill={laneColour(commit.lane)}
        stroke="var(--or-panel-bg)"
        strokeWidth="1.5"
      />
    </svg>
  )
}

export function GitGraph(): React.JSX.Element {
  const rootPath = useStore((s) => s.rootPath)
  const [commits, setCommits] = useState<Commit[] | null>(null)

  useEffect(() => {
    if (!rootPath) return
    let live = true
    void invoke('git:log', { rootPath, limit: LIMIT })
      .then((result) => live && setCommits(result))
      .catch(() => live && setCommits([]))
    return () => {
      live = false
    }
  }, [rootPath])

  if (commits === null) return <p className="gitgraph__note">Reading history…</p>
  if (commits.length === 0) return <p className="gitgraph__note">No commits yet.</p>

  const rows = layoutGraph(commits)
  const width = graphWidth(rows)

  return (
    <div className="gitgraph">
      {rows.map((commit) => (
        <div
          className="gitgraph__row"
          key={commit.hash}
          title={`${commit.hash}\n${commit.subject}`}
        >
          <Row commit={commit} width={width} />
          <div className="gitgraph__meta">
            <div className="gitgraph__subject">
              {commit.refs.map((ref) => (
                <span className="gitgraph__ref" key={ref}>
                  {ref.replace('HEAD -> ', '')}
                </span>
              ))}
              {commit.subject}
            </div>
            <div className="gitgraph__by">
              {commit.author} · {commit.date} · {commit.hash.slice(0, 7)}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
