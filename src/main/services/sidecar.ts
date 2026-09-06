import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { MessageDecoder, encodeMessage } from './lsp-protocol'

/**
 * Client for the Rust sidecar (`native/orrery-sidecar`).
 *
 * The sidecar is an optimisation, never a dependency: every failure — a missing
 * binary, a crash, a timeout, a malformed reply — resolves to `null`, and the
 * caller falls back to its TypeScript implementation. That is what lets the
 * binary be absent on a contributor's machine without breaking anything.
 *
 * The framing is deliberately not reimplemented here. `lsp-protocol.ts` already
 * owns a tested encoder and incremental decoder for exactly this wire format,
 * so the sidecar speaks the same dialect as the language servers do.
 *
 * Electron is never imported: the binary path arrives by constructor injection,
 * matching how the other services take their paths, which keeps this unit
 * testable against a plain Node stub.
 */

/** A slow reply is worth abandoning; the fallback is only milliseconds away. */
const REQUEST_TIMEOUT_MS = 10_000

export class SidecarClient {
  private proc: ChildProcessWithoutNullStreams | null = null
  private decoder = new MessageDecoder()
  private readonly pending = new Map<number, (value: unknown) => void>()
  private nextId = 1
  /** Set once the binary is known to be unusable, so we stop retrying it. */
  private disabled = false

  constructor(private readonly binaryPath: string) {}

  get available(): boolean {
    return !this.disabled && existsSync(this.binaryPath)
  }

  /**
   * Send a request and wait for its reply.
   *
   * Always settles: a sidecar that never answers resolves to `null` on a
   * timeout, and its pending entry is dropped so a late reply cannot resolve
   * something nobody is waiting for any more.
   */
  async call(method: string, params: unknown): Promise<unknown> {
    const proc = this.ensureStarted()
    if (!proc) return null

    const id = this.nextId++
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve(null)
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, (value) => {
        clearTimeout(timer)
        resolve(value)
      })
      try {
        proc.stdin.write(encodeMessage({ jsonrpc: '2.0', id, method, params }))
      } catch {
        clearTimeout(timer)
        this.pending.delete(id)
        resolve(null)
      }
    })
  }

  private ensureStarted(): ChildProcessWithoutNullStreams | null {
    if (this.proc) return this.proc
    if (!this.available) return null

    try {
      const proc = spawn(this.binaryPath, [], { stdio: 'pipe' })
      // A child that dies mid-write closes the pipe under us, and Node reports
      // that as an `error` event on the stream rather than as a throw from
      // `write`. Unheard, it is an unhandled `error` on an EventEmitter and it
      // takes the whole main process down. The `try/catch` at the write site
      // cannot see it, and the `writable` check only narrows the window.
      proc.stdin.on('error', () => {})
      proc.stdout.on('data', (chunk: Buffer) => this.receive(chunk))
      // Captured rather than drained. A Rust panic written to stderr and thrown
      // away is indistinguishable from "no results", which is an afternoon lost.
      proc.stderr.on('data', (chunk: Buffer) => {
        console.error('orrery-sidecar:', chunk.toString().trimEnd())
      })
      proc.on('error', () => this.fail())
      proc.on('exit', () => {
        // Settle anyone still waiting; the next call spawns a fresh process.
        this.proc = null
        this.decoder = new MessageDecoder()
        for (const settle of this.pending.values()) settle(null)
        this.pending.clear()
      })
      this.proc = proc
      return proc
    } catch {
      this.fail()
      return null
    }
  }

  private fail(): void {
    this.disabled = true
    this.proc = null
  }

  private receive(chunk: Buffer): void {
    for (const message of this.decoder.push(chunk)) {
      if (message.id === undefined) continue
      const settle = this.pending.get(Number(message.id))
      if (!settle) continue
      this.pending.delete(Number(message.id))
      settle(message.error ? null : message.result)
    }
  }

  shutdown(): void {
    try {
      this.proc?.kill()
    } catch {
      // Quitting anyway.
    }
    this.proc = null
  }
}
