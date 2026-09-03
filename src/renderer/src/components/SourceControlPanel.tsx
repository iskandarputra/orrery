import { useCallback, useEffect, useState } from 'react'
import {
  EMPTY_STATUS,
  stagedChanges,
  unstagedChanges,
  type GitChange,
  type GitStatus
} from '@core/git-status'
import { basename } from '@core/paths'
import { invoke } from '@/services/client'
import { useStore } from '@/state/store'
import { EmptyState } from './PanelBits'
import { ChangeTree } from './ChangeTree'
import { GitGraph } from './GitGraph'
import { Icon } from './Icon'

/** One letter per state, as git and every git UI spell them. */
const LETTER: Record<NonNullable<GitChange['staged']>, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  untracked: 'U',
  conflicted: '!'
}

function Row({
  change,
  side,
  nested,
  onPrimary,
  onDiscard
}: {
  change: GitChange
  side: 'staged' | 'unstaged'
  /** Under a folder row, which has already said where the file lives. */
  nested: boolean
  onPrimary: (change: GitChange) => void
  onDiscard?: (change: GitChange) => void
}): React.JSX.Element {
  const state = side === 'staged' ? change.staged : change.unstaged
  const openDiff = useStore((s) => s.openDiff)

  return (
    <div className="scm-row" title={change.from ? `${change.from} → ${change.path}` : change.path}>
      {/* Clicking the name shows the diff, as it does in VS Code — opening the
          file is what the file tree is for, and the question here is what changed. */}
      <button className="scm-row__name" onClick={() => openDiff(change.path, side === 'staged')}>
        <span className="scm-row__file">{basename(change.path)}</span>
        <span className="scm-row__dir">
          {!nested && change.path.includes('/') ? change.path : ''}
        </span>
      </button>
      <div className="scm-row__actions">
        {onDiscard && (
          <button
            className="icon-btn scm-row__act"
            aria-label={`Discard changes in ${change.path}`}
            title="Discard changes"
            onClick={() => onDiscard(change)}
          >
            <Icon name="undo" size={13} />
          </button>
        )}
        <button
          className="icon-btn scm-row__act"
          aria-label={`${side === 'staged' ? 'Unstage' : 'Stage'} ${change.path}`}
          title={side === 'staged' ? 'Unstage' : 'Stage'}
          onClick={() => onPrimary(change)}
        >
          <Icon name={side === 'staged' ? 'minus' : 'plus'} size={13} />
        </button>
      </div>
      <span className={`scm-row__state scm-row__state--${state}`}>
        {state ? LETTER[state] : ''}
      </span>
    </div>
  )
}

/**
 * Source control for the vault.
 *
 * Deliberately a working-tree view rather than a git client: what changed,
 * what is staged, and a commit box. Anything that reaches the network — push,
 * pull, fetch — is absent, so nothing here can fail in a way that needs
 * credentials or leaves the repository mid-operation.
 */
export function SourceControlPanel(): React.JSX.Element {
  const rootPath = useStore((s) => s.rootPath)
  const showToast = useStore((s) => s.showToast)
  const git = useStore((s) => s.settings.git)
  const viewMode = git.fileViewMode
  const updateSettings = useStore((s) => s.updateSettings)
  const [status, setStatus] = useState<GitStatus>(EMPTY_STATUS)
  const [isRepo, setIsRepo] = useState<boolean | null>(null)
  const [message, setMessage] = useState('')
  /** Which section is open. Both can be, but the panel is narrow. */
  const [showGraph, setShowGraph] = useState(false)
  const [busy, setBusy] = useState(false)

  /** Bumped to re-read status; the reading itself belongs in the effect. */
  const [reloadToken, setReloadToken] = useState(0)
  const refresh = useCallback((): void => setReloadToken((n) => n + 1), [])

  useEffect(() => {
    if (!rootPath) return
    let live = true
    void (async () => {
      const repo = await invoke('git:isRepository', { rootPath })
      if (!live) return
      setIsRepo(repo)
      const next = repo ? await invoke('git:status', { rootPath }) : EMPTY_STATUS
      // Status is two round trips, and the vault can change between them.
      // Without this guard a slow answer lands on a folder nobody is looking at.
      if (live) setStatus(next)
    })()
    return () => {
      live = false
    }
  }, [rootPath, reloadToken])

  const act = async (run: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      await run()
      refresh()
    } finally {
      setBusy(false)
    }
  }

  if (!rootPath) return <EmptyState icon="git-branch">Open a folder to see its changes.</EmptyState>
  if (isRepo === null) return <EmptyState icon="git-branch">Checking for a repository…</EmptyState>
  if (!isRepo) {
    return (
      <EmptyState icon="git-branch">
        This vault is not a git repository. Run <code>git init</code> in it to track changes.
      </EmptyState>
    )
  }

  const tree = viewMode === 'tree'
  const staged = stagedChanges(status)
  const unstaged = unstagedChanges(status)
  const clean = staged.length === 0 && unstaged.length === 0

  const stage = (paths: string[]): Promise<void> =>
    act(() => invoke('git:stage', { rootPath, paths }))
  const unstage = (paths: string[]): Promise<void> =>
    act(() => invoke('git:unstage', { rootPath, paths }))

  const discard = (change: GitChange): Promise<void> | undefined => {
    // Unrecoverable: git keeps no copy of a discarded change, so this asks
    // first and names the file it is about to throw away.
    const verb = change.unstaged === 'untracked' ? 'Delete' : 'Discard changes in'
    if (!window.confirm(`${verb} "${change.path}"? This cannot be undone.`)) return
    return act(() =>
      invoke('git:discard', {
        rootPath,
        paths: change.unstaged === 'untracked' ? [] : [change.path],
        untracked: change.unstaged === 'untracked' ? [change.path] : []
      })
    )
  }

  const commit = async (): Promise<void> => {
    if (!message.trim() || staged.length === 0) return
    await act(async () => {
      const result = await invoke('git:commit', { rootPath, message })
      if (result === null) {
        showToast('git refused the commit — check your git identity is configured', 'error')
      } else {
        setMessage('')
        showToast(`Committed ${staged.length} file${staged.length === 1 ? '' : 's'}`, 'success')
      }
    })
  }

  return (
    <div className="scm">
      {/* This view's own header, built like the file tree's so the two views
          match: the branch is the title, and the actions that belong to source
          control sit where the tree's actions sit. */}
      <div className="sidebar__header">
        <div className="sidebar__header-top">
          <div className="sidebar__workspace-info">
            <span className="sidebar__eyebrow">Source Control</span>
            <div className="sidebar__title-row">
              <span className="scm__branch" title="Current branch">
                <Icon name="git-branch" size={13} />
                {status.branch ?? 'detached'}
              </span>
              {(status.ahead > 0 || status.behind > 0) && (
                <span className="scm__ab" title={`${status.ahead} ahead, ${status.behind} behind`}>
                  {status.ahead > 0 && `↑${status.ahead}`}
                  {status.behind > 0 && `↓${status.behind}`}
                </span>
              )}
            </div>
          </div>
          <div className="sidebar__actions">
            <button
              className="icon-btn"
              aria-label={tree ? 'View as list' : 'View as tree'}
              aria-pressed={tree}
              title={tree ? 'View as list' : 'View as tree'}
              onClick={() =>
                updateSettings({ git: { ...git, fileViewMode: tree ? 'list' : 'tree' } })
              }
            >
              <Icon name={tree ? 'list-tree' : 'list'} size={13} />
            </button>
            <button
              className="icon-btn"
              aria-label="Refresh status"
              title="Refresh"
              onClick={refresh}
            >
              <Icon name="refresh" size={13} />
            </button>
          </div>
        </div>
      </div>

      <div className="scm__commit">
        <textarea
          className="scm__message"
          placeholder={staged.length ? 'Commit message' : 'Stage something to commit'}
          value={message}
          rows={2}
          disabled={staged.length === 0}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void commit()
          }}
        />
        <button
          className="scm__commit-btn"
          disabled={busy || staged.length === 0 || !message.trim()}
          onClick={() => void commit()}
          title="Commit staged changes (Ctrl+Enter)"
        >
          Commit {staged.length > 0 && `(${staged.length})`}
        </button>
      </div>

      <button
        className={`scm__section${showGraph ? '' : ' scm__section--open'}`}
        aria-expanded={!showGraph}
        onClick={() => setShowGraph(false)}
      >
        <Icon name={showGraph ? 'chevron-right' : 'chevron-down'} size={12} />
        Changes
      </button>

      {!showGraph &&
        (clean ? (
          <EmptyState icon="check">No changes — the working tree is clean.</EmptyState>
        ) : (
          <>
            {staged.length > 0 && (
              <>
                <div className="scm__group">
                  <span className="scm__group-label">Staged</span>
                  <span className="rpanel-count__badge">{staged.length}</span>
                  <button
                    className="scm__group-act"
                    onClick={() => void unstage(staged.map((c) => c.path))}
                  >
                    Unstage all
                  </button>
                </div>
                <ChangeTree
                  items={staged}
                  getPath={(c) => c.path}
                  mode={viewMode}
                  renderRow={(c) => (
                    <Row
                      change={c}
                      side="staged"
                      nested={tree}
                      onPrimary={(x) => void unstage([x.path])}
                    />
                  )}
                />
              </>
            )}
            {unstaged.length > 0 && (
              <>
                <div className="scm__group">
                  <span className="scm__group-label">Unstaged</span>
                  <span className="rpanel-count__badge">{unstaged.length}</span>
                  <button
                    className="scm__group-act"
                    onClick={() => void stage(unstaged.map((c) => c.path))}
                  >
                    Stage all
                  </button>
                </div>
                <ChangeTree
                  items={unstaged}
                  getPath={(c) => c.path}
                  mode={viewMode}
                  renderRow={(c) => (
                    <Row
                      change={c}
                      side="unstaged"
                      nested={tree}
                      onPrimary={(x) => void stage([x.path])}
                      onDiscard={(x) => void discard(x)}
                    />
                  )}
                />
              </>
            )}
          </>
        ))}

      <button
        className={`scm__section${showGraph ? ' scm__section--open' : ''}`}
        aria-expanded={showGraph}
        onClick={() => setShowGraph(true)}
      >
        <Icon name={showGraph ? 'chevron-down' : 'chevron-right'} size={12} />
        Graph
      </button>
      {showGraph && <GitGraph />}
    </div>
  )
}
