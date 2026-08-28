#!/usr/bin/env node
/**
 * A minimal language server, for testing the client.
 *
 * It speaks just enough LSP to prove the pipe:
 *   - answers `initialize`
 *   - publishes one diagnostic per line containing BAD, on open and on change
 *   - answers `hover` with the word under the cursor
 *   - answers `completion` with two fixed items
 *   - answers `definition` by pointing at the first line of `target.ts`
 *
 * That makes the assertions in the spec real round trips — spawn, frame,
 * handshake, sync, request, correlate, decode, draw — rather than mocks.
 */
let buffer = Buffer.alloc(0)
const documents = new Map()

function send(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`)
  process.stdout.write(body)
}

function publish(uri, text) {
  const diagnostics = []
  text.split('\n').forEach((line, index) => {
    const at = line.indexOf('BAD')
    if (at === -1) return
    diagnostics.push({
      range: {
        start: { line: index, character: at },
        end: { line: index, character: at + 3 }
      },
      severity: 1,
      source: 'stub',
      message: 'BAD is not allowed here'
    })
  })
  send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri, diagnostics } })
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd === -1) return
    const header = buffer.subarray(0, headerEnd).toString('ascii')
    const match = /content-length:\s*(\d+)/i.exec(header)
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4)
      continue
    }
    const length = Number(match[1])
    const start = headerEnd + 4
    if (buffer.length < start + length) return
    const message = JSON.parse(buffer.subarray(start, start + length).toString('utf8'))
    buffer = buffer.subarray(start + length)

    if (message.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: { capabilities: { textDocumentSync: 1 } }
      })
    } else if (
      message.method === 'textDocument/didOpen' ||
      message.method === 'textDocument/didChange'
    ) {
      const doc = message.params.textDocument
      // didOpen carries the text on the document; didChange carries it in the
      // change list (full-text sync).
      const text = doc.text ?? message.params.contentChanges?.[0]?.text ?? ''
      documents.set(doc.uri, text)
      publish(doc.uri, text)
    } else if (message.method === 'textDocument/hover') {
      const { textDocument, position } = message.params
      const line = (documents.get(textDocument.uri) ?? '').split('\n')[position.line] ?? ''
      const word = /[A-Za-z0-9_]+/.exec(line.slice(position.character)) ?? ['']
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: word[0]
          ? { contents: { kind: 'markdown', value: `stub docs for ${word[0]}` } }
          : null
      })
    } else if (message.method === 'textDocument/completion') {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          isIncomplete: false,
          items: [
            { label: 'stubComplete', kind: 3, detail: '(a: number) => void' },
            { label: 'stubOther', kind: 6, detail: 'number' }
          ]
        }
      })
    } else if (message.method === 'textDocument/definition') {
      // Always point at the first line of target.ts, next to the open file.
      const dir = message.params.textDocument.uri.replace(/\/[^/]*$/, '')
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          uri: `${dir}/target.ts`,
          range: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } }
        }
      })
    }
  }
})
