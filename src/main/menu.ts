import {
  app,
  BrowserWindow,
  Menu,
  shell,
  type BaseWindow,
  type MenuItemConstructorOptions
} from 'electron'
import { send } from './ipc/registry'

/**
 * Menu items carry no behavior: they forward a command id to the focused
 * window's renderer, where the command registry is the single behavior table
 * shared by menus, keyboard shortcuts and (later) the command palette.
 * Accelerators here are display-only hints; CM6/renderer keymaps handle keys.
 */
function dispatch(commandId: string) {
  return (_item: unknown, win: BaseWindow | undefined): void => {
    if (win instanceof BrowserWindow) send(win, 'menu:command', { commandId })
  }
}

export function buildAppMenu(bindings: Record<string, string> = {}): void {
  const isMac = process.platform === 'darwin'
  /** User override or the shipped default accelerator. */
  const acc = (commandId: string, dflt?: string): string | undefined => bindings[commandId] || dflt

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: '&File',
      submenu: [
        {
          label: 'New File',
          accelerator: acc('file.new', 'CmdOrCtrl+N'),
          click: dispatch('file.new')
        },
        {
          label: 'Quick Open…',
          accelerator: acc('app.quickOpen', 'CmdOrCtrl+P'),
          click: dispatch('app.quickOpen')
        },
        {
          label: 'Command Palette…',
          accelerator: acc('app.commandPalette', 'CmdOrCtrl+Shift+P'),
          click: dispatch('app.commandPalette')
        },
        { type: 'separator' },
        {
          label: 'Open File…',
          accelerator: acc('file.open', 'CmdOrCtrl+O'),
          click: dispatch('file.open')
        },
        {
          label: 'Open Folder…',
          accelerator: acc('workspace.openFolder', 'CmdOrCtrl+Shift+O'),
          click: dispatch('workspace.openFolder')
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: acc('file.save', 'CmdOrCtrl+S'),
          click: dispatch('file.save')
        },
        {
          label: 'Save As…',
          accelerator: acc('file.saveAs', 'CmdOrCtrl+Shift+S'),
          click: dispatch('file.saveAs')
        },
        { type: 'separator' },
        {
          label: 'Export',
          submenu: [
            { label: 'As HTML…', click: dispatch('file.exportHtml') },
            { label: 'As PDF…', click: dispatch('file.exportPdf') }
          ]
        },
        // No accelerator: Ctrl+P is quick-open here, and shadowing it to print
        // would be a worse trade than reaching for the menu.
        { label: 'Print…', click: dispatch('file.print') },
        { type: 'separator' },
        {
          label: 'Preferences…',
          accelerator: acc('app.openSettings', 'CmdOrCtrl+,'),
          click: dispatch('app.openSettings')
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: acc('tab.close', 'CmdOrCtrl+W'),
          click: dispatch('tab.close')
        },
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }])
      ]
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Highlight Selection',
          accelerator: acc('format.highlight', 'CmdOrCtrl+Shift+H'),
          click: dispatch('format.highlight')
        },
        { label: 'Unwrap Hard-Wrapped Paragraphs', click: dispatch('format.unwrapParagraphs') },
        {
          label: 'Extract Selection to Note',
          accelerator: acc('note.extractSelection', 'CmdOrCtrl+Alt+N'),
          click: dispatch('note.extractSelection')
        },
        { type: 'separator' },
        {
          label: 'Find',
          accelerator: acc('find.open', 'CmdOrCtrl+F'),
          click: dispatch('find.open')
        },
        {
          label: 'Replace',
          accelerator: acc('find.replace', 'CmdOrCtrl+H'),
          click: dispatch('find.replace')
        }
      ]
    },
    {
      label: '&View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          accelerator: acc('view.toggleSidebar', 'CmdOrCtrl+B'),
          click: dispatch('view.toggleSidebar')
        },
        {
          label: 'Toggle Terminal',
          // The shortcut every editor uses for this, so muscle memory works.
          accelerator: acc('view.toggleTerminal', 'CmdOrCtrl+`'),
          click: dispatch('view.toggleTerminal')
        },
        {
          label: 'View Mode',
          submenu: [
            {
              label: 'Edit (source)',
              accelerator: acc('view.modeEdit', 'CmdOrCtrl+Shift+1'),
              click: dispatch('view.modeEdit')
            },
            {
              label: 'Hybrid (live preview)',
              accelerator: acc('view.modeHybrid', 'CmdOrCtrl+Shift+2'),
              click: dispatch('view.modeHybrid')
            },
            {
              label: 'Reading (view only)',
              accelerator: acc('view.modeReading', 'CmdOrCtrl+Shift+3'),
              click: dispatch('view.modeReading')
            },
            { type: 'separator' },
            {
              label: 'Cycle View Mode',
              accelerator: acc('view.cycleViewMode', 'CmdOrCtrl+/'),
              click: dispatch('view.cycleViewMode')
            }
          ]
        },
        { label: 'Typewriter Mode', click: dispatch('view.toggleTypewriter') },
        { label: 'Focus Mode', click: dispatch('view.toggleFocusMode') },
        { label: 'Reflow Paragraphs', click: dispatch('view.toggleReflow') },
        { type: 'separator' },
        {
          label: 'Toggle Backlinks',
          accelerator: acc('view.toggleBacklinks', 'CmdOrCtrl+Shift+B'),
          click: dispatch('view.toggleBacklinks')
        },
        {
          label: 'Toggle Outline',
          accelerator: acc('view.toggleOutline', 'CmdOrCtrl+Shift+U'),
          click: dispatch('view.toggleOutline')
        },
        {
          label: 'Search in Workspace',
          accelerator: acc('view.toggleSearch', 'CmdOrCtrl+Shift+F'),
          click: dispatch('view.toggleSearch')
        },
        {
          label: 'AI Chat',
          accelerator: acc('ai.openChat', 'CmdOrCtrl+Shift+A'),
          click: dispatch('ai.openChat')
        },
        {
          label: 'Graph View',
          accelerator: acc('view.toggleGraph', 'CmdOrCtrl+Shift+G'),
          click: dispatch('view.toggleGraph')
        },
        { type: 'separator' },
        {
          label: 'Appearance',
          submenu: [
            { label: 'Light', click: dispatch('view.themeLight') },
            { label: 'Dark', click: dispatch('view.themeDark') },
            { label: 'Follow System', click: dispatch('view.themeSystem') }
          ]
        },
        { type: 'separator' },
        {
          label: 'Split Editor',
          accelerator: acc('view.toggleSplit', 'CmdOrCtrl+\\'),
          click: dispatch('view.toggleSplit')
        },
        {
          label: 'Focus Other Pane',
          accelerator: acc('view.focusOtherPane', 'CmdOrCtrl+Alt+\\'),
          click: dispatch('view.focusOtherPane')
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }])
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Orrery on GitHub',
          click: () => void shell.openExternal('https://github.com/iskandarputra/zymd')
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
