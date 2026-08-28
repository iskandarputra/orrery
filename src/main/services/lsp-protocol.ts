/**
 * The Language Server Protocol's wire framing.
 *
 * LSP is JSON-RPC over a stream, each message preceded by headers and a blank
 * line, exactly like HTTP:
 *
 *     Content-Length: 42\r\n
 *     \r\n
 *     {"jsonrpc":"2.0", ...}
 *
 * Kept free of streams and processes so the framing — which is where the bugs
 * live — can be tested directly.
 */

export interface RpcMessage {
  jsonrpc: '2.0'
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/**
 * Frame one message for the wire.
 *
 * Content-Length counts *bytes*, not characters. A server sent a message
 * containing one non-ASCII character will hang or desynchronise a client that
 * counts `string.length` here — the classic LSP client bug.
 */
export function encodeMessage(message: RpcMessage): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii')
  return Buffer.concat([header, body])
}

/**
 * Incremental reader for a server's stdout.
 *
 * A stream gives no guarantee about where chunks land: one read can hold half a
 * header, three whole messages, or a message body split mid-character. The
 * decoder holds a buffer and yields only the messages that have fully arrived.
 */
export class MessageDecoder {
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)

  /** Append a chunk and take every message it completed. */
  push(chunk: Buffer<ArrayBufferLike>): RpcMessage[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
    const out: RpcMessage[] = []

    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) break

      const header = this.buffer.subarray(0, headerEnd).toString('ascii')
      const match = /content-length:\s*(\d+)/i.exec(header)
      if (!match) {
        // Unparseable header: skip past it rather than spin on it forever.
        this.buffer = this.buffer.subarray(headerEnd + 4)
        continue
      }

      const length = Number(match[1])
      const bodyStart = headerEnd + 4
      if (this.buffer.length < bodyStart + length) break // body still arriving

      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf8')
      this.buffer = this.buffer.subarray(bodyStart + length)
      try {
        out.push(JSON.parse(body) as RpcMessage)
      } catch {
        // A malformed body is one lost message, not a lost connection: the
        // stream is still framed correctly and the next message is intact.
      }
    }
    return out
  }

  /** Bytes held back waiting for the rest of a message. */
  get pending(): number {
    return this.buffer.length
  }
}
