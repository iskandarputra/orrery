#!/usr/bin/env node
/**
 * A minimal language server, for testing the client.
 *
 * It speaks just enough LSP to prove the pipe: it answers `initialize`, and on
 * every `didOpen` / `didChange` it publishes one diagnostic per line containing
 * the word BAD. That makes the assertion in the spec a real round trip —
 * spawn, frame, handshake, sync, publish, decode, draw — rather than a mock.
 */
let buffer = Buffer.alloc(0)

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
      publish(doc.uri, text)
    }
  }
})
