/**
 * The shipped shortcut for each command, in Electron accelerator form.
 *
 * The one place a default key is written. It used to be written three times:
 * as a literal at each menu item in `main/menu.ts`, again in a 24-row list in
 * the Keybindings pane, and again as text in tooltips and the Welcome cards.
 * The copies had drifted. The ribbon said "Bold (Ctrl+B)" while Ctrl+B
 * toggled the sidebar, and the header's "Ctrl+P" button opened the palette
 * that Ctrl+Shift+P opens. Main builds the menu from this table and the
 * renderer builds every hint from it, so a hint cannot name a key that does
 * something else.
 *
 * Ctrl+B and Ctrl+I are bold and italic, as in every writing tool. Toggle
 * Sidebar had Ctrl+B, after VS Code, and moved to Ctrl+Shift+E, the key VS Code
 * uses to show its file explorer.
 */
export const DEFAULT_SHORTCUTS: Readonly<Record<string, string>> = {
  'file.new': 'CmdOrCtrl+N',
  'app.quickOpen': 'CmdOrCtrl+P',
  'app.commandPalette': 'CmdOrCtrl+Shift+P',
  'file.open': 'CmdOrCtrl+O',
  'workspace.openFolder': 'CmdOrCtrl+Shift+O',
  'file.openRecent': 'CmdOrCtrl+Shift+R',
  'file.save': 'CmdOrCtrl+S',
  'file.saveAs': 'CmdOrCtrl+Shift+S',
  'app.openSettings': 'CmdOrCtrl+,',
  'tab.close': 'CmdOrCtrl+W',
  'format.bold': 'CmdOrCtrl+B',
  'format.italic': 'CmdOrCtrl+I',
  'format.highlight': 'CmdOrCtrl+Shift+H',
  'note.extractSelection': 'CmdOrCtrl+Alt+N',
  'find.open': 'CmdOrCtrl+F',
  'find.replace': 'CmdOrCtrl+H',
  'view.toggleSidebar': 'CmdOrCtrl+Shift+E',
  'view.toggleTerminal': 'CmdOrCtrl+`',
  'view.modeEdit': 'CmdOrCtrl+Shift+1',
  'view.modeHybrid': 'CmdOrCtrl+Shift+2',
  'view.modeReading': 'CmdOrCtrl+Shift+3',
  'view.cycleViewMode': 'CmdOrCtrl+/',
  'view.toggleHtmlPreview': 'CmdOrCtrl+Shift+V',
  'view.toggleBacklinks': 'CmdOrCtrl+Shift+B',
  'view.toggleOutline': 'CmdOrCtrl+Shift+U',
  'view.toggleSearch': 'CmdOrCtrl+Shift+F',
  'ai.openChat': 'CmdOrCtrl+Shift+A',
  'view.toggleGraph': 'CmdOrCtrl+Shift+G',
  'view.toggleSplit': 'CmdOrCtrl+\\',
  'view.splitRight': 'CmdOrCtrl+Shift+\\',
  'view.widenPane': 'CmdOrCtrl+Alt+Right',
  'view.narrowPane': 'CmdOrCtrl+Alt+Left',
  'view.focusNextPane': 'CmdOrCtrl+Alt+\\',
  'view.workspaces': 'CmdOrCtrl+Alt+W',
  'view.zoomIn': 'CmdOrCtrl+Plus',
  'view.zoomOut': 'CmdOrCtrl+-',
  'view.zoomReset': 'CmdOrCtrl+0',
  'view.pageZoomIn': 'CmdOrCtrl+Shift+Plus',
  'view.pageZoomOut': 'CmdOrCtrl+Shift+-',
  'view.pageZoomReset': 'CmdOrCtrl+Shift+0'
}

/**
 * The accelerator a command answers to: the user's own if they set one, the
 * shipped default otherwise, and undefined for a command with neither.
 */
export function shortcutFor(
  commandId: string,
  overrides: Readonly<Record<string, string>> = {}
): string | undefined {
  return overrides[commandId] || DEFAULT_SHORTCUTS[commandId]
}
