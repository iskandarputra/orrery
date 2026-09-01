/**
 * A sidecar that speaks the real protocol.
 *
 * Used by sidecar.test.ts instead of a mocked child process: the framing is
 * half of what the client does, and a mock that hands back parsed objects
 * would test everything except the part most likely to be wrong.
 *
 * Behaviour is chosen by argv so one script covers every case the client has to
 * survive: a normal reply, silence, and a crash mid-conversation.
 */
const mode = process.argv[2] ?? 'echo'

if (mode === 'crash') process.exit(3)

let buffer = Buffer.alloc(0)
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  for (;;) {
    const header = buffer.indexOf('\r\n\r\n')
    if (header === -1) return
    const length = Number(/Content-Length: (\d+)/.exec(buffer.slice(0, header).toString())?.[1])
    const start = header + 4
    if (buffer.length < start + length) return
    const message = JSON.parse(buffer.slice(start, start + length).toString())
    buffer = buffer.slice(start + length)

    if (mode === 'silent') continue
    if (mode === 'die') process.exit(1)

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: { echoed: message.params }
    })
    process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
  }
})
