import { useStore } from '@/state/store'
import { openContextMenu } from './context-menu/context-menu'
import { buildTabMenu } from './menus'

export function TabBar(): React.JSX.Element | null {
  const tabOrder = useStore((s) => s.tabOrder)
  const buffers = useStore((s) => s.buffers)
  const activeId = useStore((s) => s.activeId)
  const setActive = useStore((s) => s.setActive)
  const closeTab = useStore((s) => s.closeTab)

  if (tabOrder.length === 0) return null

  return (
    <div className="tab-bar" role="tablist">
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
            <span className="tab__label">{buffer.fileName}</span>
            <button
              className={`tab__close${buffer.isDirty ? ' tab__close--dirty' : ''}`}
              aria-label={`Close ${buffer.fileName}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => void closeTab(id)}
            >
              {buffer.isDirty ? '•' : '×'}
            </button>
          </div>
        )
      })}
    </div>
  )
}
