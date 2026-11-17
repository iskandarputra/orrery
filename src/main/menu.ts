import {
  app,
  BrowserWindow,
  Menu,
  shell,
  type BaseWindow,
  type MenuItemConstructorOptions
} from 'electron'
import { shortcutFor } from '@shared/keybindings'
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

export interface RecentPaths {
  files: readonly string[]
  folders: readonly string[]
}

/** How many of each to offer before the submenu becomes a list nobody scans. */
const RECENT_SHOWN = 8

export function buildAppMenu(
  bindings: Record<string, string> = {},
  recent: RecentPaths = { files: [], folders: [] }
): void {
  const isMac = process.platform === 'darwin'
  /** User override or the shipped default, from the one table of defaults. */
  const acc = (commandId: string): string | undefined => shortcutFor(commandId, bindings)

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: '&File',
      submenu: [
        {
          label: 'New File',
          accelerator: acc('file.new'),
          click: dispatch('file.new')
        },
        {
          label: 'Quick Open…',
          accelerator: acc('app.quickOpen'),
          click: dispatch('app.quickOpen')
        },
        {
          label: 'Command Palette…',
          accelerator: acc('app.commandPalette'),
          click: dispatch('app.commandPalette')
        },
        { type: 'separator' },
        {
          label: 'Open File…',
          accelerator: acc('file.open'),
          click: dispatch('file.open')
        },
        {
          label: 'Open Folder…',
          accelerator: acc('workspace.openFolder'),
          click: dispatch('workspace.openFolder')
        },
        {
          label: 'Open Recent',
          submenu: recentSubmenu(recent, acc('file.openRecent'))
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: acc('file.save'),
          click: dispatch('file.save')
        },
        {
          label: 'Save As…',
          accelerator: acc('file.saveAs'),
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
          accelerator: acc('app.openSettings'),
          click: dispatch('app.openSettings')
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: acc('tab.close'),
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
          label: 'Bold',
          accelerator: acc('format.bold'),
          click: dispatch('format.bold')
        },
        {
          label: 'Italic',
          accelerator: acc('format.italic'),
          click: dispatch('format.italic')
        },
        {
          label: 'Highlight Selection',
          accelerator: acc('format.highlight'),
          click: dispatch('format.highlight')
        },
        { label: 'Unwrap Hard-Wrapped Paragraphs', click: dispatch('format.unwrapParagraphs') },
        {
          label: 'Extract Selection to Note',
          accelerator: acc('note.extractSelection'),
          click: dispatch('note.extractSelection')
        },
        { type: 'separator' },
        {
          label: 'Find',
          accelerator: acc('find.open'),
          click: dispatch('find.open')
        },
        {
          label: 'Replace',
          accelerator: acc('find.replace'),
          click: dispatch('find.replace')
        }
      ]
    },
    {
      label: '&View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          accelerator: acc('view.toggleSidebar'),
          click: dispatch('view.toggleSidebar')
        },
        {
          label: 'Toggle Terminal',
          // The shortcut every editor uses for this, so muscle memory works.
          accelerator: acc('view.toggleTerminal'),
          click: dispatch('view.toggleTerminal')
        },
        {
          label: 'View Mode',
          submenu: [
            {
              label: 'Edit (source)',
              accelerator: acc('view.modeEdit'),
              click: dispatch('view.modeEdit')
            },
            {
              label: 'Hybrid (live preview)',
              accelerator: acc('view.modeHybrid'),
              click: dispatch('view.modeHybrid')
            },
            {
              label: 'Reading (view only)',
              accelerator: acc('view.modeReading'),
              click: dispatch('view.modeReading')
            },
            { type: 'separator' },
            {
              label: 'Cycle View Mode',
              accelerator: acc('view.cycleViewMode'),
              click: dispatch('view.cycleViewMode')
            },
            { type: 'separator' },
            {
              // The three above are about a note. This one is about an HTML
              // file, which has a source and a rendered page of its own — the
              // shortcut editors use for exactly this.
              label: 'Toggle HTML Preview',
              accelerator: acc('view.toggleHtmlPreview'),
              click: dispatch('view.toggleHtmlPreview')
            }
          ]
        },
        { label: 'Typewriter Mode', click: dispatch('view.toggleTypewriter') },
        { label: 'Focus Mode', click: dispatch('view.toggleFocusMode') },
        { label: 'Reflow Paragraphs', click: dispatch('view.toggleReflow') },
        // The status bar carries this too, but only over a code file, which is
        // the only place it does anything. Here as well so it can be found by
        // somebody reading the menus rather than the bar. Whether there is a
        // minimap at all stays in Settings; this is how big it is.
        { label: 'Collapse Minimap', click: dispatch('view.toggleMinimap') },
        { type: 'separator' },
        {
          label: 'Toggle Backlinks',
          accelerator: acc('view.toggleBacklinks'),
          click: dispatch('view.toggleBacklinks')
        },
        {
          label: 'Toggle Outline',
          accelerator: acc('view.toggleOutline'),
          click: dispatch('view.toggleOutline')
        },
        {
          label: 'Search in Workspace',
          accelerator: acc('view.toggleSearch'),
          click: dispatch('view.toggleSearch')
        },
        {
          label: 'AI Chat',
          accelerator: acc('ai.openChat'),
          click: dispatch('ai.openChat')
        },
        {
          label: 'Graph View',
          accelerator: acc('view.toggleGraph'),
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
          accelerator: acc('view.toggleSplit'),
          click: dispatch('view.toggleSplit')
        },
        {
          label: 'Split Right',
          accelerator: acc('view.splitRight'),
          click: dispatch('view.splitRight')
        },
        {
          label: 'Close Pane',
          click: dispatch('view.closePane')
        },
        {
          label: 'Widen Pane',
          accelerator: acc('view.widenPane'),
          click: dispatch('view.widenPane')
        },
        {
          label: 'Narrow Pane',
          accelerator: acc('view.narrowPane'),
          click: dispatch('view.narrowPane')
        },
        {
          label: 'Even Out Pane Widths',
          click: dispatch('view.equalPanes')
        },
        {
          label: 'Focus Next Pane',
          accelerator: acc('view.focusNextPane'),
          click: dispatch('view.focusNextPane')
        },
        { type: 'separator' },
        {
          label: 'Workspaces…',
          accelerator: acc('view.workspaces'),
          click: dispatch('view.workspaces')
        },
        {
          label: 'Delete Workspace…',
          click: dispatch('view.deleteWorkspace')
        },
        { type: 'separator' },
        // Not the built-in roles: those forget the level on restart, and their
        // accelerator matches one spelling of "plus" out of the three a
        // keyboard offers. `before-input-event` in windows.ts catches the rest.
        {
          label: 'Zoom In',
          accelerator: acc('view.zoomIn'),
          click: dispatch('view.zoomIn')
        },
        {
          label: 'Zoom Out',
          accelerator: acc('view.zoomOut'),
          click: dispatch('view.zoomOut')
        },
        {
          label: 'Reset Zoom',
          accelerator: acc('view.zoomReset'),
          click: dispatch('view.zoomReset')
        },
        { type: 'separator' },
        // The document's own size, with the interface left alone. The
        // accelerators are listed for discoverability; the keys themselves are
        // caught in windows.ts, which is the only place that can tell
        // `Ctrl Shift =` from the `Ctrl +` it is also a spelling of.
        {
          label: 'Zoom In (page only)',
          accelerator: acc('view.pageZoomIn'),
          click: dispatch('view.pageZoomIn')
        },
        {
          label: 'Zoom Out (page only)',
          accelerator: acc('view.pageZoomOut'),
          click: dispatch('view.pageZoomOut')
        },
        {
          label: 'Reset Page Zoom',
          accelerator: acc('view.pageZoomReset'),
          click: dispatch('view.pageZoomReset')
        },
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

/**
 * The Open Recent submenu.
 *
 * Files and folders in one list, each opened directly rather than through a
 * command, because a menu item that has to carry a path is the one thing the
 * command channel cannot express: it sends an id and nothing else. Main knows
 * the path, so main sends the event that opens it.
 *
 * The palette entry sits at the top, since it is the one that can be searched
 * and the one a keyboard reaches without the mouse.
 */
function recentSubmenu(recent: RecentPaths, accelerator?: string): MenuItemConstructorOptions[] {
  const openPath = (channel: 'app:openPath' | 'app:openFolder', path: string) => (): void => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.webContents.send(channel, { path })
  }

  const files = recent.files.slice(0, RECENT_SHOWN)
  const folders = recent.folders.slice(0, RECENT_SHOWN)

  const items: MenuItemConstructorOptions[] = [
    {
      label: 'Open Recent…',
      ...(accelerator ? { accelerator } : {}),
      click: dispatch('file.openRecent')
    }
  ]

  if (files.length > 0) {
    items.push({ type: 'separator' }, { label: 'Files', enabled: false })
    for (const path of files) {
      items.push({ label: shorten(path), toolTip: path, click: openPath('app:openPath', path) })
    }
  }
  if (folders.length > 0) {
    items.push({ type: 'separator' }, { label: 'Folders', enabled: false })
    for (const path of folders) {
      items.push({ label: shorten(path), toolTip: path, click: openPath('app:openFolder', path) })
    }
  }
  if (files.length === 0 && folders.length === 0) {
    items.push({ type: 'separator' }, { label: 'Nothing yet', enabled: false })
  }
  return items
}

/** A path a menu can show: the last two segments, with the home directory folded. */
function shorten(path: string): string {
  const home = app.getPath('home')
  const tidy = path.startsWith(home) ? `~${path.slice(home.length)}` : path
  const parts = tidy.split(/[/\\]/).filter(Boolean)
  return parts.length <= 2 ? tidy : `…/${parts.slice(-2).join('/')}`
}
