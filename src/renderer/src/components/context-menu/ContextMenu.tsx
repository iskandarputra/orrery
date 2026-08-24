import { useEffect, useLayoutEffect, useRef } from 'react'
import { Icon } from '../Icon'
import { closeContextMenu, useContextMenu } from './context-menu'

export function ContextMenu(): React.JSX.Element | null {
  const { open, x, y, items } = useContextMenu()
  const ref = useRef<HTMLDivElement>(null)

  // Clamp into the viewport imperatively — the menu is a transient popup, so
  // positioning the DOM node directly avoids a render round-trip.
  useLayoutEffect(() => {
    const el = ref.current
    if (!open || !el) return
    const rect = el.getBoundingClientRect()
    el.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`
    el.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`
  }, [open, x, y, items])

  useEffect(() => {
    if (!open) return
    const dismiss = (): void => closeContextMenu()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeContextMenu()
    }
    window.addEventListener('mousedown', dismiss)
    window.addEventListener('blur', dismiss)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('mousedown', dismiss)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', dismiss)
    }
  }, [open])

  if (!open) return null

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: x, top: y }}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        'separator' in item ? (
          <div key={i} className="ctx-menu__sep" />
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={item.disabled}
            className={`ctx-menu__item${item.danger ? ' ctx-menu__item--danger' : ''}`}
            onClick={() => {
              closeContextMenu()
              item.onSelect()
            }}
          >
            <span className="ctx-menu__icon">
              {item.icon && <Icon name={item.icon} size={14} />}
            </span>
            {item.label}
          </button>
        )
      )}
    </div>
  )
}
