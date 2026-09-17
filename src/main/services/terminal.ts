import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { shellIsBusy } from '@core/shell-busy'

/**
 * Pseudo-terminals for the integrated terminal.
 *
 * A real PTY, not `spawn` with pipes: without one there is no line editing, no
 * job control, no colours and no `vim` — a shell that cannot be interacted with
 * is not a terminal, it is a command runner.
 *
 * `node-pty` is a native module that has to compile, which makes it the single
 * dependency most likely to fail on a machine that is not this one. It is
 * therefore optional and loaded lazily: when it is missing the terminal reports
 * itself unavailable and the rest of the app is untouched.
 */

interface Pty {
  /** The foreground process: the shell at its prompt, or what it is running. */
  readonly process?: string
  onData(listener: (data: string) => void): void
  onExit(listener: (event: { exitCode: number }) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

interface PtyModule {
  spawn(
    file: string,
    args: string[],
    options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv }
  ): Pty
}

/** Guard rails: a runaway writer must not be able to exhaust memory. */
const MAX_WRITE = 1024 * 1024
const MAX_COLS = 1000
const MAX_ROWS = 500

export interface TerminalEvents {
  onData(id: string, data: string): void
  onExit(id: string, exitCode: number): void
}

export class TerminalService {
  private readonly sessions = new Map<string, Pty>()
  /** The shell each session was started with, to tell it from what it runs. */
  private readonly shells = new Map<string, string>()
  private module: PtyModule | null = null
  private loadFailed = false

  constructor(private readonly events: TerminalEvents) {}

  /**
   * Load node-pty on first use.
   *
   * A failure is remembered rather than retried: the module is either built or
   * it is not, and retrying the require on every keystroke would turn one
   * missing dependency into a stream of identical errors.
   */
  private load(): PtyModule | null {
    if (this.module || this.loadFailed) return this.module
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.module = require('node-pty') as PtyModule
    } catch (err) {
      this.loadFailed = true
      console.error('node-pty unavailable; the terminal is disabled:', err)
    }
    return this.module
  }

  get available(): boolean {
    return this.load() !== null
  }

  /**
   * Start a shell.
   *
   * The user's own `$SHELL`, so their prompt, aliases and configuration are the
   * ones they know. `TERM` is set because a shell with no terminal type
   * disables colour and line editing.
   */
  create(cwd: string, cols: number, rows: number): string | null {
    const pty = this.load()
    if (!pty) return null

    const id = randomUUID()
    const shell =
      process.env['SHELL'] ?? (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash')
    try {
      const session = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: clamp(cols, 1, MAX_COLS),
        rows: clamp(rows, 1, MAX_ROWS),
        cwd: cwd || homedir(),
        env: { ...process.env, TERM: 'xterm-256color' }
      })
      session.onData((data) => this.events.onData(id, data))
      session.onExit(({ exitCode }) => {
        this.sessions.delete(id)
        this.shells.delete(id)
        this.events.onExit(id, exitCode)
      })
      this.sessions.set(id, session)
      this.shells.set(id, shell)
      return id
    } catch (err) {
      console.error('Failed to start a terminal:', err)
      return null
    }
  }

  write(id: string, data: string): void {
    if (data.length > MAX_WRITE) return
    try {
      this.sessions.get(id)?.write(data)
    } catch {
      // The shell exited between the keystroke and its delivery.
    }
  }

  resize(id: string, cols: number, rows: number): void {
    try {
      this.sessions.get(id)?.resize(clamp(cols, 1, MAX_COLS), clamp(rows, 1, MAX_ROWS))
    } catch {
      // As above.
    }
  }

  /** See `core/shell-busy`. A session that has gone is not running anything. */
  busy(id: string): boolean | null {
    const session = this.sessions.get(id)
    if (!session) return false
    try {
      return shellIsBusy(session.process, this.shells.get(id) ?? '', process.platform)
    } catch {
      return null
    }
  }

  kill(id: string): void {
    try {
      this.sessions.get(id)?.kill()
    } catch {
      // Already gone.
    }
    this.sessions.delete(id)
    this.shells.delete(id)
  }

  /** Stop every shell. Called on quit, so none outlive the window. */
  shutdown(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value) || min))
}
