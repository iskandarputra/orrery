import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { invoke, on } from '@/services/client'
import { useStore } from '@/state/store'
import { getTheme, resolveTheme } from '@/themes/themes'
import { Icon } from './Icon'

/**
 * The mono stack as a literal string.
 *
 * xterm measures the character cell itself, in a context where a CSS `var()` is
 * just an unparseable font name — so the token has to be resolved here rather
 * than handed over verbatim.
 */
function monoStack(): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--or-mono-font')
    .replace(/\s+/g, ' ')
    .trim()
  return value || 'monospace'
}

/**
 * Wait for the terminal's font before anything is measured.
 *
 * The cell size is computed once, when the terminal opens. A web font that is
 * still loading at that moment means the fallback gets measured and every column
 * sits fractionally wrong until the next resize — so the first family in the
 * stack is loaded first, in the weights the shell will actually use.
 */
async function fontReady(stack: string): Promise<void> {
  const family = stack.split(',')[0]?.trim()
  if (!family) return
  try {
    await Promise.all([
      document.fonts.load(`12px ${family}`),
      document.fonts.load(`bold 12px ${family}`),
      document.fonts.load(`italic 12px ${family}`)
    ])
  } catch {
    // The face is unavailable on this machine; the rest of the stack still draws.
  }
}

/**
 * The integrated terminal.
 *
 * xterm.js draws it and a pseudo-terminal in main runs it; this component is
 * only the wire between them. It deliberately keeps no scrollback of its own —
 * xterm already holds one, and a second copy in React state would re-render the
 * whole buffer on every keystroke.
 */
export function TerminalPanel(): React.JSX.Element | null {
  const open = useStore((s) => s.terminalOpen)
  const close = useStore((s) => s.closeTerminal)
  const rootPath = useStore((s) => s.rootPath)
  const themeId = useStore((s) =>
    s.settings.theme === 'dark' ? s.settings.darkTheme : s.settings.lightTheme
  )

  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const idRef = useRef<string | null>(null)
  const [status, setStatus] = useState<'starting' | 'running' | 'unavailable'>('starting')

  useEffect(() => {
    const host = hostRef.current
    if (!open || !host) return
    let live = true

    const palette = resolveTheme(getTheme(themeId))
    const mono = monoStack()
    const term = new Terminal({
      fontFamily: mono,
      fontSize: 12,
      cursorBlink: true,
      // Follows the app's palette, so the terminal is not the one panel that
      // ignores the theme.
      theme: {
        background: palette['editor-bg'],
        foreground: palette['fg'],
        cursor: palette['accent'],
        selectionBackground: palette['selection-bg']
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    termRef.current = term
    fitRef.current = fit

    void (async () => {
      await fontReady(mono)
      if (!live) return
      term.open(host)
      fit.fit()

      const id = await invoke('terminal:create', {
        // The vault, so `ls` shows the notes rather than wherever the app started.
        cwd: rootPath ?? '',
        cols: term.cols,
        rows: term.rows
      })
      if (!live) {
        if (id) void invoke('terminal:kill', { id })
        return
      }
      if (!id) {
        setStatus('unavailable')
        return
      }
      idRef.current = id
      setStatus('running')
      term.onData((data) => void invoke('terminal:write', { id, data }))
      term.focus()
    })()

    // The panel is resizable and the window is not fixed, so the shell has to
    // be told the new size or its line wrapping goes wrong.
    const observer = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        return // measured while hidden
      }
      const id = idRef.current
      if (id) void invoke('terminal:resize', { id, cols: term.cols, rows: term.rows })
    })
    observer.observe(host)

    return () => {
      live = false
      observer.disconnect()
      const id = idRef.current
      if (id) void invoke('terminal:kill', { id })
      idRef.current = null
      term.dispose()
      termRef.current = null
    }
  }, [open, rootPath, themeId])

  // Output arrives for whichever shell produced it, so it is matched by id
  // rather than assumed to belong to the terminal on screen.
  useEffect(() => {
    const offData = on('terminal:data', ({ id, data }) => {
      if (id === idRef.current) termRef.current?.write(data)
    })
    const offExit = on('terminal:exit', ({ id }) => {
      if (id !== idRef.current) return
      idRef.current = null
      termRef.current?.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n')
    })
    return () => {
      offData()
      offExit()
    }
  }, [])

  if (!open) return null

  return (
    <div className="term-panel">
      <div className="term-panel__bar">
        <span className="term-panel__title">
          <Icon name="code" size={13} /> Terminal
        </span>
        {status === 'unavailable' && (
          <span className="term-panel__note">
            node-pty is not built — reinstall dependencies to enable the terminal
          </span>
        )}
        <button
          className="icon-btn"
          aria-label="Close terminal"
          title="Close terminal (Ctrl+`)"
          onClick={close}
        >
          <Icon name="x" size={15} />
        </button>
      </div>
      <div className="term-panel__host" ref={hostRef} />
    </div>
  )
}
