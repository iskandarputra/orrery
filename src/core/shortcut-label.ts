/**
 * An Electron accelerator as a person reads it.
 *
 * `CmdOrCtrl+Shift+P` is the form the menu wants, and nobody types "CmdOrCtrl".
 * On macOS the modifiers are the symbols the menu bar itself shows, with no
 * separator, which is how every Mac app writes them. Elsewhere they are words
 * joined by `+`, which is how Windows and Linux menus write them.
 */
export function shortcutLabel(accelerator: string, mac: boolean): string {
  const parts = accelerator.split('+')
  // `CmdOrCtrl+Plus` and `CmdOrCtrl+Shift+-` survive the split; a literal `+`
  // key would not, and Electron spells that one `Plus` for the same reason.
  const keys = parts.map((part) => {
    const lower = part.toLowerCase()
    if (lower === 'cmdorctrl' || lower === 'commandorcontrol') return mac ? '⌘' : 'Ctrl'
    if (lower === 'cmd' || lower === 'command' || lower === 'meta' || lower === 'super')
      return mac ? '⌘' : 'Super'
    if (lower === 'ctrl' || lower === 'control') return mac ? '⌃' : 'Ctrl'
    if (lower === 'alt' || lower === 'option') return mac ? '⌥' : 'Alt'
    if (lower === 'shift') return mac ? '⇧' : 'Shift'
    if (lower === 'plus') return '+'
    if (lower === 'right') return mac ? '→' : 'Right'
    if (lower === 'left') return mac ? '←' : 'Left'
    if (lower === 'up') return mac ? '↑' : 'Up'
    if (lower === 'down') return mac ? '↓' : 'Down'
    return part.length === 1 ? part.toUpperCase() : part
  })
  return keys.join(mac ? '' : '+')
}
