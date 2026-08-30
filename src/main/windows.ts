import path from 'node:path'
import { BrowserWindow, shell } from 'electron'
import type { Settings } from '@shared/settings'
import { send } from './ipc/registry'

export interface WindowManagerDeps {
  getSettings: () => Settings
  /** Position and size only; the remembered background is written elsewhere. */
  saveWindowBounds: (bounds: Omit<Settings['window'], 'background'>) => void
  saveZoomLevel: (level: number) => void
}

/** Chromium's own limits, and as far as the text stays worth reading. */
const ZOOM_MIN = -5
const ZOOM_MAX = 5

/**
 * Factory + manager for app windows. Security posture is decided here and
 * nowhere else: isolated context, no node integration, sandboxed renderer,
 * external navigation denied.
 */
export class WindowManager {
  private mainWindow: BrowserWindow | null = null
  /** Set once the renderer has finished its unsaved-changes flow. */
  private closeConfirmed = false

  constructor(private deps: WindowManagerDeps) {}

  get window(): BrowserWindow | null {
    return this.mainWindow
  }

  /** One step in or out, and remembered. */
  zoomBy(steps: number): void {
    this.setZoom(this.deps.getSettings().zoomLevel + steps)
  }

  setZoom(level: number): void {
    const next = clampZoom(level)
    this.mainWindow?.webContents.setZoomLevel(next)
    this.deps.saveZoomLevel(next)
  }

  createMainWindow(): BrowserWindow {
    const { window: bounds } = this.deps.getSettings()
    // An e2e run pops a window per spec file and takes the keyboard with it,
    // which is disruptive to whoever is working on the machine. Under test the
    // window is shown *inactive* and parked off to the side: never focused, so
    // it cannot swallow a keystroke meant for something else.
    //
    // It is shown rather than hidden because CodeMirror measures on animation
    // frames, and a window that is never shown stops receiving them — every
    // layout assertion in the suite then reads zero.
    const headless = process.env.ORRERY_HEADLESS === '1'

    const win = new BrowserWindow({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      minWidth: 640,
      minHeight: 420,
      show: false,
      autoHideMenuBar: false,
      // The colour the app was wearing when it was last closed, so the frame
      // that appears before the first render already looks like the app.
      backgroundColor: bounds.background || '#1e1e1e',
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
        backgroundThrottling: !headless
      }
    })

    /**
     * Shown as soon as there is a window to show.
     *
     * Waiting for the renderer to report its first paint was tried and made
     * things worse: a window that is not visible has its animation frames
     * throttled, so holding it back delayed the very render it was waiting for
     * — `domComplete` went from 90ms to 371ms. The frame appears immediately
     * instead, wearing the colour the app was last in, so what is on screen
     * before the first render looks like the app rather than a dark rectangle
     * about to turn white.
     */
    win.once('ready-to-show', () => {
      if (headless) {
        win.setPosition(-20000, -20000)
        win.showInactive()
      } else {
        win.show()
      }
    })

    // Deny all window creation and in-app navigation; open http(s) externally.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (event) => event.preventDefault())

    // The renderer draws its own themed context menu, but only main sees the
    // spellchecker's verdict — so the event is forwarded with its params and
    // the menu is built there.
    win.webContents.on('context-menu', (_event, params) => {
      win.webContents.send('editor:contextMenu', {
        x: params.x,
        y: params.y,
        selectionText: params.selectionText,
        isEditable: params.isEditable,
        misspelledWord: params.misspelledWord,
        dictionarySuggestions: params.dictionarySuggestions
      })
    })

    // Unsaved-changes flow: first close is intercepted; renderer decides.
    win.on('close', (event) => {
      if (!this.closeConfirmed) {
        event.preventDefault()
        send(win, 'window:closeRequested', undefined)
      }
    })

    const persistBounds = (): void => {
      if (win.isDestroyed() || win.isMinimized() || win.isMaximized()) return
      const { width, height, x, y } = win.getBounds()
      this.deps.saveWindowBounds({ width, height, x, y })
    }
    win.on('resized', persistBounds)
    win.on('moved', persistBounds)

    win.on('closed', () => {
      this.mainWindow = null
    })

    // Zoom, the way a browser does it: the whole interface, in steps of 1.2x.
    // Applied after the load rather than at creation, because a webContents
    // resets its zoom when it navigates.
    win.webContents.on('did-finish-load', () => {
      win.webContents.setZoomLevel(clampZoom(this.deps.getSettings().zoomLevel))
    })

    // `Ctrl +` on most keyboards is `Ctrl Shift =`, and the menu accelerator
    // only matches one spelling of it. The others are caught here, so every
    // key someone might press for this does the same thing.
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return
      if (input.key === '=' || input.key === '+') this.zoomBy(1)
      else if (input.key === '-' || input.key === '_') this.zoomBy(-1)
      else if (input.key === '0') this.setZoom(0)
    })

    if (process.env['ELECTRON_RENDERER_URL']) {
      void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      void win.loadFile(path.join(__dirname, '../renderer/index.html'))
    }

    this.mainWindow = win
    this.closeConfirmed = false
    return win
  }

  /** Called by the renderer once dirty documents are handled. */
  confirmClose(): void {
    this.closeConfirmed = true
    this.mainWindow?.close()
  }
}

function clampZoom(level: number): number {
  if (!Number.isFinite(level)) return 0
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level))
}
