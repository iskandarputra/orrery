import { useEffect, useState } from 'react'
import { graphWidth, laneRuns, layoutGraph, type Commit, type GraphCommit } from '@core/git-graph'
import {
  EMPTY_COMMIT_DETAIL,
  statusLetter,
  type CommitDetail,
  type CommitFile
} from '@core/commit-detail'
import { basename } from '@core/paths'
import { invoke, parseIpcError } from '@/services/client'
import { useStore } from '@/state/store'
import { ChangeTree } from './ChangeTree'
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
 * The hover: enough to identify a row, and no more.
 *
 * The subject a narrow panel had to truncate, and the full hash. The message
 * itself is a right-click away, in something that can be read and selected —
 * a tooltip is neither.
 */
function commitTooltip(commit: Commit): string {
  return `${commit.subject}\n${commit.hash}`
}

/**
 * A commit's message, in full.
 *
 * A popup rather than a tooltip or an inline block: a message can run to
 * paragraphs, and it should be possible to read it slowly, select it and copy
 * a line out of it. Neither of the others allows that.
 */
function CommitMessage({
  commit,
  onClose
}: {
  commit: Commit
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="commit-message"
        role="dialog"
        aria-label={`Message of commit ${commit.hash.slice(0, 7)}`}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <div className="commit-message__head">
          <Icon name="git-branch" size={15} />
          <h3 className="commit-message__subject">{commit.subject}</h3>
          <button className="icon-btn" aria-label="Close" title="Close" onClick={onClose}>
            <Icon name="x" size={15} />
          </button>
        </div>
        {commit.body && <pre className="commit-message__body">{commit.body}</pre>}
        <div className="commit-message__meta">
          <span>{commit.author}</span>
          <span>·</span>
          <span>{commit.date}</span>
        </div>
        <code className="commit-message__hash">{commit.hash}</code>
        <div className="commit-message__actions">
          <button
            className="commit-message__copy"
            onClick={() =>
              void navigator.clipboard.writeText(
                commit.body ? `${commit.subject}\n\n${commit.body}` : commit.subject
              )
            }
          >
            <Icon name="copy" size={13} /> Copy message
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * The commit graph, drawn beside the history.
 *
 * One SVG per row rather than one for the whole list: rows are a fixed height,
 * so each can draw its own dot and the segments passing through it without any
 * row needing to know where the others ended up.
 */
/** Centre of a lane, in the row's own coordinates. */
const laneX = (lane: number): number => lane * LANE_WIDTH + LANE_WIDTH / 2

function Row({
  commit,
  previous,
  width
}: {
  commit: GraphCommit
  /** The row above, whose lanes are the lines arriving into this one. */
  previous: GraphCommit | null
  width: number
}): React.JSX.Element {
  const w = width * LANE_WIDTH
  const cx = laneX(commit.lane)
  const mid = ROW_HEIGHT / 2
  const { arriving, leaving } = laneRuns(previous, commit)

  return (
    <svg className="gitgraph__lanes" width={w} height={ROW_HEIGHT} aria-hidden="true">
      {/* Every line entering this row from above, down to the row's middle.
          These were missing for any lane but the commit's own, which is what
          made a line crossing several rows look like a dashed one. */}
      {arriving.map((lane) => (
        <line
          key={`a${lane}`}
          x1={laneX(lane)}
          y1={0}
          x2={laneX(lane)}
          y2={mid}
          stroke={laneColour(lane)}
          strokeWidth="1.5"
        />
      ))}
      {/* And every line leaving it below, from the middle down. Together the
          two halves meet at the middle of every row a lane crosses. */}
      {leaving.map((lane) => (
        <line
          key={`l${lane}`}
          x1={laneX(lane)}
          y1={mid}
          x2={laneX(lane)}
          y2={ROW_HEIGHT}
          stroke={laneColour(lane)}
          strokeWidth="1.5"
        />
      ))}
      {/* An edge to each parent that continues in a different lane — a merge. */}
      {commit.parentLanes
        .filter((lane) => lane !== commit.lane)
        .map((lane) => (
          <path
            key={`p${lane}`}
            d={`M ${cx} ${mid} C ${cx} ${ROW_HEIGHT}, ${laneX(lane)} ${mid}, ${laneX(lane)} ${ROW_HEIGHT}`}
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
 * Which files one commit touched, under the row it belongs to.
 *
 * Only the files. The message is on the row's hover, where reading it costs
 * nothing and does not push the next twenty commits down the panel; expanding a
 * row is for the part that needs the space and can be clicked.
 */
function CommitDetailView({ hash }: { hash: string }): React.JSX.Element {
  const rootPath = useStore((s) => s.rootPath)
  const openDiff = useStore((s) => s.openDiff)
  const viewMode = useStore((s) => s.settings.git.fileViewMode)
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
      {detail.files.length === 0 ? (
        <p className="gitgraph__note">This commit changed no files.</p>
      ) : (
        <div className="commit-detail__files">
          <ChangeTree
            items={detail.files}
            getPath={(file) => file.path}
            mode={viewMode}
            renderRow={(file: CommitFile) => (
              <button
                className="commit-detail__file"
                title={file.from ? `${file.from} → ${file.path}` : file.path}
                onClick={() => openDiff(file.path, false, hash)}
              >
                <span className={`commit-detail__status commit-detail__status--${file.status}`}>
                  {statusLetter(file.status)}
                </span>
                <span className="commit-detail__path">
                  {viewMode === 'tree' ? basename(file.path) : file.path}
                </span>
              </button>
            )}
          />
        </div>
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
  /** The commit whose message is being read, if any. */
  const [reading, setReading] = useState<Commit | null>(null)

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
        label: 'View message',
        icon: 'file-text',
        onSelect: () => setReading(commit)
      },
      { separator: true },
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
      {reading && <CommitMessage commit={reading} onClose={() => setReading(null)} />}
      {rows.map((commit, index) => (
        <div key={commit.hash}>
          <button
            className={`gitgraph__row${selected === commit.hash ? ' gitgraph__row--selected' : ''}`}
            title={commitTooltip(commit)}
            aria-expanded={selected === commit.hash}
            onClick={() => setSelected((current) => (current === commit.hash ? null : commit.hash))}
            onContextMenu={(e) => {
              e.preventDefault()
              setSelected(commit.hash)
              openContextMenu(e, menuFor(commit))
            }}
          >
            <Row commit={commit} previous={rows[index - 1] ?? null} width={width} />
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
