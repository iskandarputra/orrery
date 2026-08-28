import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { dirname } from 'node:path'
import { MessageDecoder, encodeMessage, type RpcMessage } from './lsp-protocol'
import { languageIdForFile, serverForFile, type ServerSpec } from '@core/lsp-servers'
import type { DiagnosticsPayload, LspDiagnostic } from '@shared/types'

const SEVERITY: Record<number, LspDiagnostic['severity']> = {
  1: 'error',
  2: 'warning',
  3: 'info',
  4: 'hint'
}

interface RawDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  severity?: number
  message: string
  source?: string
}

/** A server that failed to start is remembered, so we do not retry per keystroke. */
type SessionState = 'starting' | 'ready' | 'failed'

class Session {
  readonly decoder = new MessageDecoder()
  proc: ChildProcessWithoutNullStreams | null = null
  state: SessionState = 'starting'
  nextId = 1
  /** Document versions, as the protocol requires them to increase per file. */
  readonly versions = new Map<string, number>()
  readonly open = new Set<string>()

  constructor(
    readonly spec: ServerSpec,
    readonly root: string
  ) {}
}

/**
 * Language servers, discovered on PATH and spoken to over stdio.
 *
 * One session per (server, workspace root): a server is expensive to start and
 * holds a whole project's analysis, so every file of a language in one vault
 * shares it.
 *
 * Nothing here is allowed to take the app down with it. A server that is not
 * installed, exits, crashes on start or writes nonsense leaves the editor
 * exactly as it was without it — highlighting, brackets and folding all still
 * work, because none of them come from here.
 */
export class LspService {
  private readonly sessions = new Map<string, Session>()

  constructor(private readonly onDiagnostics: (payload: DiagnosticsPayload) => void) {}

  /** Which known servers are actually present on this machine. */
  async installed(): Promise<Record<string, boolean>> {
    const { allServers } = await import('@core/lsp-servers')
    const out: Record<string, boolean> = {}
    await Promise.all(
      allServers().map(async (s) => {
        out[s.languageId] = await onPath(s.command)
      })
    )
    return out
  }

  /** Tell the server a file is open, starting it if this is the first one. */
  async openDocument(path: string, text: string): Promise<void> {
    const session = await this.sessionFor(path)
    if (!session || session.state !== 'ready') return
    const languageId = languageIdForFile(path) ?? 'plaintext'
    session.versions.set(path, 1)
    session.open.add(path)
    this.notify(session, 'textDocument/didOpen', {
      textDocument: { uri: uriOf(path), languageId, version: 1, text }
    })
  }

  /** Full-text sync: simple, and correct for a file the size of a source file. */
  async changeDocument(path: string, text: string): Promise<void> {
    const session = this.sessions.get(this.keyFor(path) ?? '')
    if (!session || session.state !== 'ready' || !session.open.has(path)) return
    const version = (session.versions.get(path) ?? 1) + 1
    session.versions.set(path, version)
    this.notify(session, 'textDocument/didChange', {
      textDocument: { uri: uriOf(path), version },
      contentChanges: [{ text }]
    })
  }

  closeDocument(path: string): void {
    const session = this.sessions.get(this.keyFor(path) ?? '')
    if (!session || !session.open.has(path)) return
    session.open.delete(path)
    session.versions.delete(path)
    this.notify(session, 'textDocument/didClose', { textDocument: { uri: uriOf(path) } })
  }

  /** Stop every server. Called on quit. */
  shutdown(): void {
    for (const session of this.sessions.values()) {
      try {
        session.proc?.kill()
      } catch {
        // Quitting anyway.
      }
    }
    this.sessions.clear()
  }

  private keyFor(path: string): string | null {
    const spec = serverForFile(path)
    return spec ? `${spec.command}::${dirname(path)}` : null
  }

  private async sessionFor(path: string): Promise<Session | null> {
    const spec = serverForFile(path)
    if (!spec) return null
    const key = `${spec.command}::${dirname(path)}`
    const existing = this.sessions.get(key)
    if (existing) return existing

    const session = new Session(spec, dirname(path))
    this.sessions.set(key, session)

    if (!(await onPath(spec.command))) {
      // Not installed. Remembered as failed so the next keystroke does not
      // start another PATH lookup.
      session.state = 'failed'
      return session
    }

    try {
      const proc = spawn(spec.command, spec.args, { cwd: session.root, stdio: 'pipe' })
      session.proc = proc
      proc.stdout.on('data', (chunk: Buffer) => this.receive(session, chunk))
      // A server's stderr is its own business; draining it stops the pipe
      // filling and blocking the server.
      proc.stderr.resume()
      proc.on('error', () => {
        session.state = 'failed'
      })
      proc.on('exit', () => {
        session.state = 'failed'
        this.sessions.delete(key)
      })
      await this.initialize(session)
    } catch {
      session.state = 'failed'
    }
    return session
  }

  private async initialize(session: Session): Promise<void> {
    this.request(session, 'initialize', {
      processId: process.pid,
      rootUri: uriOf(session.root),
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false },
          publishDiagnostics: { relatedInformation: false }
        }
      }
    })
    // The handshake is not awaited on a response here: a server that never
    // answers must not wedge the first file open. Notifications sent before
    // `initialized` are dropped by the server, and the next didOpen resends.
    session.state = 'ready'
    this.notify(session, 'initialized', {})
  }

  private receive(session: Session, chunk: Buffer): void {
    for (const message of session.decoder.push(chunk)) {
      if (message.method === 'textDocument/publishDiagnostics') {
        const params = message.params as { uri?: string; diagnostics?: RawDiagnostic[] } | undefined
        if (!params?.uri) continue
        this.onDiagnostics({
          path: pathOf(params.uri),
          diagnostics: (params.diagnostics ?? []).map(flatten)
        })
      }
    }
  }

  private send(session: Session, message: RpcMessage): void {
    if (!session.proc?.stdin.writable) return
    try {
      session.proc.stdin.write(encodeMessage(message))
    } catch {
      session.state = 'failed'
    }
  }

  private notify(session: Session, method: string, params: unknown): void {
    this.send(session, { jsonrpc: '2.0', method, params })
  }

  private request(session: Session, method: string, params: unknown): void {
    this.send(session, { jsonrpc: '2.0', id: session.nextId++, method, params })
  }
}

function flatten(d: RawDiagnostic): LspDiagnostic {
  return {
    startLine: d.range.start.line,
    startChar: d.range.start.character,
    endLine: d.range.end.line,
    endChar: d.range.end.character,
    severity: SEVERITY[d.severity ?? 1] ?? 'error',
    message: d.message,
    ...(d.source ? { source: d.source } : {})
  }
}

function uriOf(path: string): string {
  return pathToFileURL(path).toString()
}

function pathOf(uri: string): string {
  try {
    return decodeURIComponent(new URL(uri).pathname)
  } catch {
    return uri
  }
}

/** Whether an executable can be found, without running it. */
async function onPath(command: string): Promise<boolean> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  try {
    await run(process.platform === 'win32' ? 'where' : 'which', [command], { timeout: 3000 })
    return true
  } catch {
    return false
  }
}
