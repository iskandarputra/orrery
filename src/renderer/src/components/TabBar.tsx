import { useStore } from '@/state/store'
import { openContextMenu } from './context-menu/context-menu'
import { Icon } from './Icon'
import { buildTabMenu } from './menus'

export function TabBar(): React.JSX.Element | null {
  const tabOrder = useStore((s) => s.tabOrder)
  const buffers = useStore((s) => s.buffers)
  const activeId = useStore((s) => s.activeId)
  const setActive = useStore((s) => s.setActive)
  const closeTab = useStore((s) => s.closeTab)
  const newUntitled = useStore((s) => s.newUntitled)

  if (tabOrder.length === 0) return null

  return (
    <div className="tab-bar" role="tablist">
      <div className="tab-bar__list">
        {tabOrder.map((id) => {
          const buffer = buffers[id]
          if (!buffer) return null
          const isActive = id === activeId
          return (
            <div
              key={id}
              role="tab"
              aria-selected={isActive}
              title={buffer.filePath ?? buffer.fileName}
              className={`tab${isActive ? ' tab--active' : ''}`}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  void closeTab(id)
                } else if (e.button === 0) {
                  setActive(id)
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                openContextMenu(e, buildTabMenu(id))
              }}
            >
              <Icon
                name="file-text"
                size={13}
                className={`tab__icon${isActive ? ' tab__icon--active' : ''}`}
              />
              <span className="tab__label">{buffer.fileName}</span>
              <button
                className={`tab__close${buffer.isDirty ? ' tab__close--dirty' : ''}`}
                aria-label={`Close ${buffer.fileName}`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => void closeTab(id)}
              >
                {buffer.isDirty ? <span className="tab__dirty-dot" /> : <Icon name="x" size={11} />}
              </button>
            </div>
          )
        })}
      </div>
      <button
        className="tab-bar__new-btn"
        title="New note (Ctrl+N)"
        onClick={() => newUntitled()}
      >
        <Icon name="plus" size={13} />
      </button>
    </div>
  )
}
