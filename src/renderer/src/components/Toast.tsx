import { useStore } from '@/state/store'
import { Icon, type IconName } from './Icon'

const TYPE_ICONS: Record<string, IconName> = {
  info: 'info',
  success: 'check',
  warning: 'callout',
  error: 'x'
}

export function Toast(): React.JSX.Element | null {
  const toast = useStore((s) => s.toast)
  const clearToast = useStore((s) => s.clearToast)

  if (!toast) return null

  const iconName = TYPE_ICONS[toast.type] ?? 'info'

  return (
    <div className="toast-container" role="status" aria-live="polite">
      <div className={`toast toast--${toast.type}`}>
        <span className="toast__icon">
          <Icon name={iconName} size={15} />
        </span>
        <span className="toast__message">{toast.message}</span>
        <button className="toast__close" aria-label="Dismiss notification" onClick={clearToast}>
          <Icon name="x" size={13} />
        </button>
      </div>
    </div>
  )
}
