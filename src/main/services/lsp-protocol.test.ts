import { describe, expect, it } from 'vitest'
import { MessageDecoder, encodeMessage, type RpcMessage } from './lsp-protocol'

const msg = (method: string, params?: unknown): RpcMessage => ({ jsonrpc: '2.0', method, params })

describe('encodeMessage', () => {
  it('frames with a header, a blank line, then the body', () => {
    const body = '{"jsonrpc":"2.0","method":"initialized"}'
    const out = encodeMessage(msg('initialized')).toString('utf8')
    expect(out).toBe(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`)
  })

  it('counts bytes, not characters', () => {
    // "é" is two bytes in UTF-8. A client counting string length under-reports
    // here and desynchronises the stream on the very next message.
    const body = JSON.stringify(msg('x', 'é'))
    const out = encodeMessage(msg('x', 'é'))
    const declared = Number(/Content-Length: (\d+)/.exec(out.toString('ascii'))![1])
    expect(declared).toBe(Buffer.byteLength(body, 'utf8'))
    expect(declared).toBeGreaterThan(body.length)
  })
})

describe('MessageDecoder', () => {
  it('reads a whole message from one chunk', () => {
    const d = new MessageDecoder()
    expect(d.push(encodeMessage(msg('a')))).toEqual([msg('a')])
    expect(d.pending).toBe(0)
  })

  it('reads several messages arriving in one chunk', () => {
    const d = new MessageDecoder()
    const chunk = Buffer.concat([encodeMessage(msg('a')), encodeMessage(msg('b'))])
    expect(d.push(chunk)).toEqual([msg('a'), msg('b')])
  })

  it('waits for a body split across chunks', () => {
    const d = new MessageDecoder()
    const full = encodeMessage(msg('split', 'value'))
    const cut = full.length - 6
    expect(d.push(full.subarray(0, cut))).toEqual([])
    expect(d.pending).toBeGreaterThan(0)
    expect(d.push(full.subarray(cut))).toEqual([msg('split', 'value')])
    expect(d.pending).toBe(0)
  })

  it('waits for a header split across chunks', () => {
    const d = new MessageDecoder()
    const full = encodeMessage(msg('a'))
    expect(d.push(full.subarray(0, 8))).toEqual([])
    expect(d.push(full.subarray(8))).toEqual([msg('a')])
  })

  it('reassembles a multi-byte character split down the middle', () => {
    // The two bytes of "é" land in different chunks; decoding either half
    // alone would produce a replacement character.
    const d = new MessageDecoder()
    const full = encodeMessage(msg('u', 'café'))
    const eAcute = full.length - 3
    expect(d.push(full.subarray(0, eAcute))).toEqual([])
    expect(d.push(full.subarray(eAcute))).toEqual([msg('u', 'café')])
  })

  it('accepts headers in any case and with extra fields', () => {
    const d = new MessageDecoder()
    const body = Buffer.from(JSON.stringify(msg('a')), 'utf8')
    const framed = Buffer.concat([
      Buffer.from(
        `content-type: application/vscode-jsonrpc\r\ncontent-length: ${body.length}\r\n\r\n`,
        'ascii'
      ),
      body
    ])
    expect(d.push(framed)).toEqual([msg('a')])
  })

  it('drops a malformed body without losing the stream', () => {
    const d = new MessageDecoder()
    const bad = Buffer.from('Content-Length: 5\r\n\r\n{"a":', 'utf8')
    expect(d.push(bad)).toEqual([])
    // The next message still arrives intact.
    expect(d.push(encodeMessage(msg('after')))).toEqual([msg('after')])
  })

  it('skips a header with no content-length rather than spinning on it', () => {
    const d = new MessageDecoder()
    const junk = Buffer.from('X-Nonsense: 1\r\n\r\n', 'ascii')
    expect(d.push(Buffer.concat([junk, encodeMessage(msg('after'))]))).toEqual([msg('after')])
  })

  it('round-trips a message with every field a response carries', () => {
    const d = new MessageDecoder()
    const response: RpcMessage = { jsonrpc: '2.0', id: 7, result: { items: [1, 2] } }
    expect(d.push(encodeMessage(response))).toEqual([response])
  })
})
