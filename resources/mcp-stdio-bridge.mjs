#!/usr/bin/env node
/**
 * stdio to Orrery, for clients that only speak stdio.
 *
 * Orrery serves the vault over HTTP on the loopback interface, because that is
 * what a running application can do. Several MCP clients — Claude Desktop among
 * them — launch their servers as programs and talk to them over pipes. This is
 * the twenty lines in between: read newline-delimited JSON-RPC from stdin, post
 * each message to Orrery, write the answer back.
 *
 * Deliberately dependency-free. It runs in whatever Node the other client has,
 * so it cannot assume anything is installed beside it.
 *
 *   node mcp-stdio-bridge.mjs http://127.0.0.1:7373/mcp <token>
 *
 * Or through the environment, which keeps the token out of the process list:
 *
 *   ORRERY_MCP_URL=… ORRERY_MCP_TOKEN=… node mcp-stdio-bridge.mjs
 */

const url = process.argv[2] ?? process.env.ORRERY_MCP_URL ?? 'http://127.0.0.1:7373/mcp'
const token = process.argv[3] ?? process.env.ORRERY_MCP_TOKEN ?? ''

if (!token) {
  process.stderr.write('orrery bridge: no token. Settings → MCP shows one.\n')
  process.exit(2)
}

/** Post one message and write back whatever came with it. */
async function forward(line) {
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`
      },
      body: line
    })
  } catch (err) {
    // Orrery is closed, or listening somewhere else. Answer the request rather
    // than leaving the client waiting for a reply that cannot come.
    reply(line, -32001, `Orrery is not reachable at ${url}: ${err.message}`)
    return
  }

  if (response.status === 401 || response.status === 403) {
    reply(line, -32002, 'Orrery refused the token. Settings → MCP shows the current one.')
    return
  }
  // 202 with no body: a notification was accepted, and there is nothing to say.
  const text = await response.text()
  if (text.trim()) process.stdout.write(`${text.trim()}\n`)
}

/** A JSON-RPC error for the id in `line`, when there is one to answer. */
function reply(line, code, message) {
  let id = null
  try {
    id = JSON.parse(line).id ?? null
  } catch {
    // Unparseable input; nothing to answer.
  }
  if (id === null) return
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`)
}

let buffer = ''
process.stdin.setEncoding('utf-8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let at = buffer.indexOf('\n')
  while (at !== -1) {
    const line = buffer.slice(0, at).trim()
    buffer = buffer.slice(at + 1)
    if (line) void forward(line)
    at = buffer.indexOf('\n')
  }
})
process.stdin.on('end', () => process.exit(0))
