import { useCallback, useEffect, useState } from 'react'
import { getActiveView } from '@/editor/active-view'
import { invoke } from '@/services/client'
import { useStore } from '@/state/store'
import { Icon } from './Icon'
import { EmptyState } from './PanelBits'

interface Version {
  id: string
  at: number
  bytes: number
}

function when(at: number): string {
  const date = new Date(at)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return sameDay ? `Today ${time}` : `${date.toLocaleDateString()} ${time}`
}

/**
 * Past versions of the open note, taken automatically on save.
 *
 * Restoring writes into the editor rather than over the file, so it lands in
 * the undo history like any other edit — a restore you didn't mean is one
 * Ctrl+Z away, and nothing is lost until you save.
 */
export function HistoryModal(): React.JSX.Element | null {
  const open = useStore((s) => s.historyOpen)
  const close = useStore((s) => s.toggleHistory)
  const activePath = useStore((s) =>
    s.activeId ? (s.buffers[s.activeId]?.filePath ?? null) : null
  )
  const showToast = useStore((s) => s.showToast)

  const [versions, setVersions] = useState<Version[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState('')

  useEffect(() => {
    if (!open || !activePath) return
    let stale = false
    void invoke('history:list', { path: activePath })
      .then((list) => {
        if (stale) return
        setVersions(list)
        setSelected(list[0]?.id ?? null)
      })
      .catch(() => !stale && setVersions([]))
    return () => {
      stale = true
    }
  }, [open, activePath])

  useEffect(() => {
    if (!open || !activePath || !selected) return
    let stale = false
    void invoke('history:read', { path: activePath, id: selected })
      .then((content) => !stale && setPreview(content))
      .catch(() => !stale && setPreview(''))
    return () => {
      stale = true
    }
  }, [open, activePath, selected])

  const restore = useCallback((): void => {
    const view = getActiveView()
    if (!view || !preview) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: preview },
      userEvent: 'restore.version'
    })
    view.focus()
    showToast('Version restored — Ctrl+Z to undo, save to keep', 'success')
    close()
  }, [preview, showToast, close])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        className={`graph history${versions && versions.length === 0 ? ' history--empty' : ''}`}
        role="dialog"
        aria-label="Version history"
      >
        <div className="graph__header">
          <div className="graph__title-group">
            <Icon name="clock" size={16} />
            <span className="graph__title">Version history</span>
            {versions && (
              <span className="graph__status-pill">
                {versions.length} version{versions.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <button className="icon-btn" aria-label="Close history" onClick={close}>
            <Icon name="x" size={15} />
          </button>
        </div>

        {!activePath ? (
          <p className="rpanel-empty">Open a saved note to see its history.</p>
        ) : versions === null ? (
          <p className="rpanel-empty">Reading history…</p>
        ) : versions.length === 0 ? (
          <EmptyState icon="clock">
            No versions yet. They are recorded as you save, a couple of minutes apart.
          </EmptyState>
        ) : (
          <div className="history__body">
            <ul className="history__list">
              {versions.map((version) => (
                <li key={version.id}>
                  <button
                    className={`history__item${selected === version.id ? ' history__item--active' : ''}`}
                    onClick={() => setSelected(version.id)}
                  >
                    <span className="history__when">{when(version.at)}</span>
                    <span className="history__size">{version.bytes.toLocaleString()} bytes</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="history__preview">
              <pre>{preview || 'Empty version'}</pre>
              <button className="btn btn--primary history__restore" onClick={restore}>
                Restore this version
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
