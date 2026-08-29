#!/usr/bin/env node
/**
 * A real MCP server, for testing the client against.
 *
 * Real rather than mocked: the framing, the handshake, the capability
 * negotiation and the argument validation are exactly where a client goes
 * wrong, and a stub that answers whatever the client expects proves none of
 * them. This is the same choice `git.test.ts` makes by running real git.
 *
 * It offers, deliberately, the awkward cases as well as the happy one: a tool
 * that never answers, one that reports failure, one that kills the process, and
 * a list that changes after a moment.
 *
 * Run directly (`node mcp-fixture-server.mjs`) it speaks MCP on stdio.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer(
  { name: 'fixture', version: '1.0.0' },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
)

server.registerTool(
  'echo',
  {
    title: 'Echo',
    description: 'Returns what it was given.',
    inputSchema: { text: z.string() },
    annotations: { readOnlyHint: true }
  },
  ({ text }) => ({ content: [{ type: 'text', text }] })
)

server.registerTool(
  'add',
  {
    description: 'Adds two numbers.',
    inputSchema: { a: z.number(), b: z.number() },
    annotations: { readOnlyHint: true }
  },
  ({ a, b }) => ({
    content: [{ type: 'text', text: String(a + b) }],
    structuredContent: { sum: a + b }
  })
)

server.registerTool(
  'wipe',
  {
    description: 'Pretends to delete everything.',
    inputSchema: {},
    annotations: { destructiveHint: true }
  },
  () => ({ content: [{ type: 'text', text: 'wiped' }] })
)

server.registerTool('explode', { description: 'Always fails.', inputSchema: {} }, () => ({
  content: [{ type: 'text', text: 'it went wrong' }],
  isError: true
}))

server.registerTool(
  'hang',
  { description: 'Never answers.', inputSchema: {} },
  () => new Promise(() => {})
)

server.registerTool('crash', { description: 'Kills the server.', inputSchema: {} }, () => {
  setTimeout(() => process.exit(1), 10)
  return { content: [{ type: 'text', text: 'goodbye' }] }
})

server.registerResource(
  'greeting',
  'fixture://greeting',
  { title: 'Greeting', mimeType: 'text/plain' },
  async (uri) => ({ contents: [{ uri: uri.href, text: 'hello from the fixture' }] })
)

server.registerPrompt(
  'summarise',
  { description: 'Ask for a summary.', argsSchema: { subject: z.string() } },
  ({ subject }) => ({
    messages: [{ role: 'user', content: { type: 'text', text: `Summarise ${subject}.` } }]
  })
)

// A server whose tool list settles a moment after connecting, which is the
// normal case for anything that loads configuration on start.
if (process.env['FIXTURE_LATE_TOOL'] === '1') {
  setTimeout(() => {
    server.registerTool(
      'late',
      { description: 'Arrived after the handshake.', inputSchema: {} },
      () => ({ content: [{ type: 'text', text: 'late but here' }] })
    )
  }, 150)
}

await server.connect(new StdioServerTransport())
