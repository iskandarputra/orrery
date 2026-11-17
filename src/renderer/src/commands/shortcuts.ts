import { shortcutLabel } from '@core/shortcut-label'
import { shortcutFor } from '@shared/keybindings'
import { useStore } from '@/state/store'

/** Read once: the platform a window runs on does not change under it. */
const MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)

/** What a command's key looks like right now, or '' when it has none. */
export function shortcutText(
  commandId: string,
  overrides: Readonly<Record<string, string>>
): string {
  const accelerator = shortcutFor(commandId, overrides)
  return accelerator ? shortcutLabel(accelerator, MAC) : ''
}

/**
 * A command's key, as the person reading a tooltip should press it: their own
 * binding if they set one, the shipped default otherwise. Every visible hint
 * comes from here, so none can name a key that does something else.
 */
export function useShortcut(commandId: string): string {
  const overrides = useStore((s) => s.settings.keybindings)
  return shortcutText(commandId, overrides)
}

/** `Label (Ctrl+X)`, or just the label for a command with no key. */
export function withShortcut(label: string, shortcut: string): string {
  return shortcut ? `${label} (${shortcut})` : label
}
