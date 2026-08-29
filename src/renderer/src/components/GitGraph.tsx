import { useEffect, useState } from 'react'
import { graphWidth, layoutGraph, type Commit, type GraphCommit } from '@core/git-graph'
import {
  EMPTY_COMMIT_DETAIL,
  statusLetter,
  type CommitDetail,
  type CommitFile
} from '@core/commit-detail'
import { invoke, parseIpcError } from '@/services/client'
import { useStore } from '@/state/store'
import { openContextMenu, type MenuItem } from './context-menu/context-menu'
import { Icon } from './Icon'

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

/**
 * What one commit did, under the row it belongs to.
 *
 * The graph alone shows a subject line, which is enough to find a commit and
 * never enough to decide anything about it. Clicking one asks git what it
 * touched, and clicking a file from there opens that commit's diff.
 */
function CommitDetailView({ hash }: { hash: string }): React.JSX.Element {
  const rootPath = useStore((s) => s.rootPath)
  const openDiff = useStore((s) => s.openDiff)
  const [detail, setDetail] = useState<CommitDetail | null>(null)

  useEffect(() => {
    if (!rootPath) return
    let live = true
    void invoke('git:commitDetail', { rootPath, hash })
      .then((result) => live && setDetail(result))
      .catch(() => live && setDetail(EMPTY_COMMIT_DETAIL))
    return () => {
      live = false
    }
  }, [rootPath, hash])

  if (!detail) return <p className="gitgraph__note">Reading the commit…</p>

  return (
    <div className="commit-detail">
      {detail.body && <pre className="commit-detail__body">{detail.body}</pre>}
      {detail.files.length === 0 ? (
        <p className="gitgraph__note">This commit changed no files.</p>
      ) : (
        <ul className="commit-detail__files">
          {detail.files.map((file: CommitFile) => (
            <li key={file.path}>
              <button
                className="commit-detail__file"
                title={file.from ? `${file.from} → ${file.path}` : file.path}
                onClick={() => openDiff(file.path, false, hash)}
              >
                <span className={`commit-detail__status commit-detail__status--${file.status}`}>
                  {statusLetter(file.status)}
                </span>
                <span className="commit-detail__path">{file.path}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function GitGraph(): React.JSX.Element {
  const rootPath = useStore((s) => s.rootPath)
  const showToast = useStore((s) => s.showToast)
  const [commits, setCommits] = useState<Commit[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  /**
   * The commit a new branch is being named for.
   *
   * An inline row rather than `window.prompt`, which Electron does not
   * implement at all: it throws "prompt() is not supported", so the menu item
   * would have done nothing but log an error.
   */
  const [branchingFrom, setBranchingFrom] = useState<string | null>(null)

  /**
   * Run a git command that changes the repository, then reload.
   *
   * The error is shown rather than swallowed: unlike reading status, these are
   * things the user asked for, and git refusing to check out over uncommitted
   * work is the most useful thing it can say.
   */
  const perform = (label: string, work: Promise<void>): void => {
    void work
      .then(() => {
        showToast(label, 'success')
        setReloadToken((n) => n + 1)
      })
      .catch((err) => showToast(parseIpcError(err).message, 'error'))
  }

  const menuFor = (commit: Commit): MenuItem[] => {
    const short = commit.hash.slice(0, 7)
    if (!rootPath) return []
    return [
      {
        label: 'Copy commit hash',
        icon: 'copy',
        onSelect: () => void navigator.clipboard.writeText(commit.hash)
      },
      {
        label: `Copy short hash (${short})`,
        icon: 'copy',
        onSelect: () => void navigator.clipboard.writeText(short)
      },
      {
        label: 'Copy message',
        icon: 'copy',
        onSelect: () => void navigator.clipboard.writeText(commit.subject)
      },
      { separator: true },
      {
        label: `Check out ${short}`,
        icon: 'git-branch',
        onSelect: () =>
          perform(`Checked out ${short}`, invoke('git:checkout', { rootPath, ref: commit.hash }))
      },
      {
        label: 'Create branch here…',
        icon: 'git-branch',
        onSelect: () => {
          setSelected(commit.hash)
          setBranchingFrom(commit.hash)
        }
      },
      { separator: true },
      {
        label: 'Revert this commit',
        icon: 'undo',
        onSelect: () =>
          perform(`Reverted ${short}`, invoke('git:revert', { rootPath, hash: commit.hash }))
      },
      {
        label: 'Cherry-pick onto this branch',
        icon: 'git-branch',
        onSelect: () =>
          perform(
            `Cherry-picked ${short}`,
            invoke('git:cherryPick', { rootPath, hash: commit.hash })
          )
      }
    ]
  }

  useEffect(() => {
    if (!rootPath) return
    let live = true
    void invoke('git:log', { rootPath, limit: LIMIT })
      .then((result) => live && setCommits(result))
      .catch(() => live && setCommits([]))
    return () => {
      live = false
    }
  }, [rootPath, reloadToken])

  if (commits === null) return <p className="gitgraph__note">Reading history…</p>
  if (commits.length === 0) return <p className="gitgraph__note">No commits yet.</p>

  const rows = layoutGraph(commits)
  const width = graphWidth(rows)

  return (
    <div className="gitgraph">
      {rows.map((commit) => (
        <div key={commit.hash}>
          <button
            className={`gitgraph__row${selected === commit.hash ? ' gitgraph__row--selected' : ''}`}
            title={`${commit.hash}\n${commit.subject}`}
            aria-expanded={selected === commit.hash}
            onClick={() => setSelected((current) => (current === commit.hash ? null : commit.hash))}
            onContextMenu={(e) => {
              e.preventDefault()
              setSelected(commit.hash)
              openContextMenu(e, menuFor(commit))
            }}
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
            <Icon
              name={selected === commit.hash ? 'chevron-down' : 'chevron-right'}
              size={12}
              className="gitgraph__caret"
            />
          </button>
          {branchingFrom === commit.hash && (
            <form
              className="gitgraph__branch"
              onSubmit={(e) => {
                e.preventDefault()
                const name = new FormData(e.currentTarget).get('name')
                const trimmed = String(name ?? '').trim()
                setBranchingFrom(null)
                if (!trimmed || !rootPath) return
                perform(
                  `Branch ${trimmed} created`,
                  invoke('git:createBranch', { rootPath, name: trimmed, at: commit.hash })
                )
              }}
            >
              <input
                name="name"
                className="gitgraph__branch-input"
                placeholder={`New branch at ${commit.hash.slice(0, 7)}`}
                aria-label="New branch name"
                autoFocus
                onKeyDown={(e) => e.key === 'Escape' && setBranchingFrom(null)}
              />
              <button className="gitgraph__branch-go" type="submit">
                Create
              </button>
            </form>
          )}
          {selected === commit.hash && <CommitDetailView hash={commit.hash} />}
        </div>
      ))}
    </div>
  )
}
