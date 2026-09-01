import { useEditorStats } from '@/state/editor-stats'
import { useStore } from '@/state/store'
import { Icon } from './Icon'

export function DocStatsModal(): React.JSX.Element | null {
  const open = useStore((s) => s.docStatsOpen)
  const setOpen = useStore((s) => s.setDocStatsOpen)
  const activeId = useStore((s) => s.activeId)
  const buffer = useStore((s) => (s.activeId ? s.buffers[s.activeId] : null))
  const stats = useEditorStats()

  if (!open || !activeId || !buffer) return null

  const readingTimeMin = Math.max(1, Math.ceil(stats.words / 200))
  const speakingTimeMin = Math.max(1, Math.ceil(stats.words / 130))

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div className="doc-stats-modal" role="dialog" aria-label="Document Statistics">
        <div className="doc-stats-modal__header">
          <div className="doc-stats-modal__title-group">
            <Icon name="file-text" size={16} />
            <h3 className="doc-stats-modal__title">{buffer.fileName}</h3>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}>
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="doc-stats-modal__grid">
          <div className="doc-stat-card">
            <span className="doc-stat-card__val">{stats.words.toLocaleString()}</span>
            <span className="doc-stat-card__lbl">Words</span>
          </div>
          <div className="doc-stat-card">
            <span className="doc-stat-card__val">{stats.characters.toLocaleString()}</span>
            <span className="doc-stat-card__lbl">Characters</span>
          </div>
          <div className="doc-stat-card">
            <span className="doc-stat-card__val">{stats.line}</span>
            <span className="doc-stat-card__lbl">Current Line</span>
          </div>
          <div className="doc-stat-card">
            <span className="doc-stat-card__val">{stats.column}</span>
            <span className="doc-stat-card__lbl">Current Column</span>
          </div>
          <div className="doc-stat-card">
            <span className="doc-stat-card__val">~{readingTimeMin} min</span>
            <span className="doc-stat-card__lbl">Reading Time</span>
          </div>
          <div className="doc-stat-card">
            <span className="doc-stat-card__val">~{speakingTimeMin} min</span>
            <span className="doc-stat-card__lbl">Speaking Time</span>
          </div>
        </div>

        {buffer.filePath && (
          <div className="doc-stats-modal__path">
            <span className="doc-stats-modal__path-label">File location:</span>
            <code className="doc-stats-modal__path-val">{buffer.filePath}</code>
          </div>
        )}
      </div>
    </div>
  )
}
