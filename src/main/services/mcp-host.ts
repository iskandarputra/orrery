import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import { dirname } from 'node:path'
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { buildNoteIndex } from '@core/notes'
import {
  noteUri,
  offeredTools,
  pathFromUri,
  resolveInVault,
  vaultRelative,
  VAULT_TOOLS
} from '@core/vault-tools'
import type { Settings } from '@shared/settings'
import type { FileSystemService } from './file-system'
import type { GitService } from './git'
import type { LinkScanner } from './link-scanner'
import type { AskUser } from './ask-user'
import type { McpAudit } from './mcp-audit'

/**
 * The vault, as an MCP server.
 *
 * This is the direction that makes a knowledge base worth having: Claude Code
 * or Claude Desktop, or anything else that speaks MCP, searching your notes,
 * reading one, following backlinks, and — when you allow it — adding to them.
 *
 * Three things keep it from being a hole in the side of the machine:
 *
 *  - it listens on 127.0.0.1 only, and refuses a request that did not come
 *    from there;
 *  - every request carries a bearer token, generated here and shown only in
 *    settings;
 *  - writing is off until it is switched on, and every write asks, through the
 *    same dialog an MCP tool call asks through.
 *
 * A server per request, with no session state: the connection is local, the
 * tools are short, and a session table is a thing to leak. Everything a client
 * asks for goes in the same log the panel shows, so "what did that agent do to
 * my notes" has an answer.
 */

export interface HostSettings {
  get(): Settings
  set(patch: Partial<Settings>): Settings
}

export interface HostDeps {
  settings: HostSettings
  fs: FileSystemService
  links: LinkScanner
  git: GitService
  ask: AskUser
  audit: McpAudit
  vaultRoot: () => string | null
  onChanged(): void
}

interface ToolOutcome {
  text: string
  isError: boolean
}

/** Hits past this and a search answer is a wall of text nobody reads. */
const SEARCH_LIMIT = 50

export class McpHostService {
  private http: Server | null = null
  private listening = ''

  constructor(private readonly deps: HostDeps) {}

  get running(): boolean {
    return this.http !== null
  }

  /** Where a client should point, or '' when nothing is listening. */
  get url(): string {
    return this.listening
  }

  /** Start if the setting says so; stop if it does not. Safe to call repeatedly. */
  async sync(): Promise<void> {
    const { host } = this.deps.settings.get().mcp
    if (host.enabled && !this.running) await this.start()
    else if (!host.enabled && this.running) await this.stop()
  }

  async start(): Promise<string> {
    if (this.http) return this.listening
    const { mcp } = this.deps.settings.get()

    // A token is generated the first time it is needed rather than at install:
    // a token in a settings file of someone who never turns this on is a
    // secret with no purpose.
    let token = mcp.host.token
    if (!token) {
      token = randomUUID()
      this.deps.settings.set({ mcp: { ...mcp, host: { ...mcp.host, token } } })
    }

    const server = createServer((req, res) => {
      void this.handle(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500).end()
      })
    })

    await new Promise<void>((done, fail) => {
      server.once('error', fail)
      server.listen(mcp.host.port, '127.0.0.1', done)
    })

    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : mcp.host.port
    this.http = server
    this.listening = `http://127.0.0.1:${port}/mcp`
    this.deps.onChanged()
    return this.listening
  }

  async stop(): Promise<void> {
    const server = this.http
    this.http = null
    this.listening = ''
    if (server) await new Promise<void>((done) => server.close(() => done()))
    this.deps.onChanged()
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Loopback only, whatever the socket was bound to. A request arriving from
    // anywhere else is not a client of ours.
    const remote = req.socket.remoteAddress ?? ''
    if (!remote.includes('127.0.0.1') && remote !== '::1') {
      res.writeHead(403).end()
      return
    }

    const { host } = this.deps.settings.get().mcp
    const offered = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
    if (!host.token || offered !== host.token) {
      res
        .writeHead(401, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: 'Orrery: bad or missing token' }))
      return
    }

    if (req.url && !req.url.startsWith('/mcp')) {
      res.writeHead(404).end()
      return
    }

    const body = await readBody(req)
    const transport = new StreamableHTTPServerTransport({
      // Stateless: no session id, no table of sessions to leak or to clean up.
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    })
    const server = this.buildServer()
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  }

  private buildServer(): McpServer {
    const server = new McpServer(
      { name: 'orrery', version: '0.1.0' },
      { capabilities: { tools: {}, resources: {} } }
    )

    server.setRequestHandler(ListToolsRequestSchema, () => {
      const { host } = this.deps.settings.get().mcp
      return {
        tools: offeredTools(host.allowWrites, host.disabledTools).map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: { title: tool.title, readOnlyHint: tool.readOnly, destructiveHint: false }
        }))
      }
    })

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const started = Date.now()
      const name = request.params.name
      const args = (request.params.arguments ?? {}) as Record<string, unknown>
      const outcome = await this.runTool(name, args)
      await this.deps.audit.write({
        at: Date.now(),
        serverId: 'orrery',
        serverName: 'This vault',
        tool: name,
        args,
        decision: outcome.isError ? 'deny' : 'allow',
        outcome: outcome.isError ? 'error' : 'ok',
        ms: Date.now() - started,
        summary: outcome.text
      })
      this.deps.onChanged()
      return { content: [{ type: 'text', text: outcome.text }], isError: outcome.isError }
    })

    server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const notes = await this.notes()
      return {
        resources: notes.slice(0, 500).map((path) => ({
          uri: noteUri(path),
          name: path,
          mimeType: 'text/markdown'
        }))
      }
    })

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const root = this.deps.vaultRoot() ?? ''
      const relative = pathFromUri(request.params.uri)
      const absolute = relative ? resolveInVault(root, relative) : null
      if (!absolute) throw new Error(`Not a note in this vault: ${request.params.uri}`)
      const file = await this.deps.fs.readFile(absolute)
      return {
        contents: [{ uri: request.params.uri, mimeType: 'text/markdown', text: file.content }]
      }
    })

    return server
  }

  /** Every markdown note in the vault, vault-relative. */
  private async notes(folder = ''): Promise<string[]> {
    const root = this.deps.vaultRoot()
    if (!root) return []
    const from = folder ? resolveInVault(root, folder) : root
    if (!from) return []
    const tree = await this.deps.fs.readTree(from).catch(() => null)
    return tree ? buildNoteIndex(tree).map((note) => vaultRelative(root, note.path)) : []
  }

  private async runTool(name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
    const root = this.deps.vaultRoot()
    if (!root) return { text: 'No vault is open in Orrery.', isError: true }

    const { host } = this.deps.settings.get().mcp
    const spec = VAULT_TOOLS.find((tool) => tool.name === name)
    if (!spec || host.disabledTools.includes(name)) {
      return { text: `Orrery does not offer a tool called ${name}.`, isError: true }
    }
    if (spec.writes && !host.allowWrites) {
      return { text: 'Writing to this vault is switched off in Orrery.', isError: true }
    }

    // Writing asks, every time. A remembered answer is deliberately not
    // offered: standing permission to edit someone's notes from outside the
    // app is not a thing this should be able to grant.
    if (spec.writes) {
      const allowed = await this.deps.ask.ask<{ decision: string }>('tool', {
        serverId: 'orrery',
        serverName: 'An MCP client',
        tool: {
          name: spec.name,
          title: spec.title,
          description: spec.description,
          annotations: { title: spec.title, destructiveHint: true }
        },
        args,
        source: 'model',
        reason: 'This writes to your vault, so it asks every time.'
      })
      if (!allowed || allowed.decision === 'deny' || allowed.decision === 'never') {
        return { text: 'The user refused this write.', isError: true }
      }
    }

    const text = (key: string): string =>
      typeof args[key] === 'string' ? (args[key] as string) : ''

    switch (name) {
      case 'search_notes': {
        const query = text('query')
        if (!query) return { text: 'search_notes needs a query.', isError: true }
        const limit = Math.min(Number(args['limit']) || SEARCH_LIMIT, SEARCH_LIMIT)
        const hits = await this.deps.links.search(root, query, {
          regex: args['regex'] === true,
          caseSensitive: false,
          wholeWord: false,
          include: '',
          exclude: ''
        })
        if (hits.length === 0) return { text: `No matches for ${query}.`, isError: false }
        return {
          text: hits
            .slice(0, limit)
            .map((hit) => `${vaultRelative(root, hit.path)}:${hit.line}: ${hit.snippet}`)
            .join('\n'),
          isError: false
        }
      }

      case 'read_note': {
        const absolute = resolveInVault(root, text('path'))
        if (!absolute) return { text: 'That path is not inside the vault.', isError: true }
        try {
          const file = await this.deps.fs.readFile(absolute)
          return { text: file.content, isError: false }
        } catch {
          return { text: `Could not read ${text('path')}.`, isError: true }
        }
      }

      case 'list_notes': {
        const notes = await this.notes(text('folder'))
        return {
          text: notes.length > 0 ? notes.join('\n') : 'The vault has no notes.',
          isError: false
        }
      }

      case 'backlinks': {
        const note = text('note')
        if (!note) return { text: 'backlinks needs a note.', isError: true }
        const stem = note.replace(/\.md$/i, '').split('/').pop() ?? note
        const hits = await this.deps.links.scan(root, stem)
        return {
          text:
            hits.length > 0
              ? hits
                  .map((hit) => `${vaultRelative(root, hit.path)}:${hit.line}: ${hit.snippet}`)
                  .join('\n')
              : `Nothing links to ${stem}.`,
          isError: false
        }
      }

      case 'git_status': {
        const status = await this.deps.git.status(root)
        const lines = status.changes.map((change) => {
          const staged = change.staged ? `staged ${change.staged}` : ''
          const unstaged = change.unstaged ? `working tree ${change.unstaged}` : ''
          return `${change.path}: ${[staged, unstaged].filter(Boolean).join(', ')}`
        })
        const branch = status.branch ? `On ${status.branch}.` : 'No branch.'
        return {
          text: lines.length > 0 ? `${branch}\n${lines.join('\n')}` : `${branch} Nothing changed.`,
          isError: false
        }
      }

      case 'git_log': {
        const commits = await this.deps.git.log(root, Math.min(Number(args['limit']) || 20, 100))
        return {
          text:
            commits.length > 0
              ? commits.map((c) => `${c.hash.slice(0, 8)} ${c.subject} — ${c.author}`).join('\n')
              : 'No commits, or not a git repository.',
          isError: false
        }
      }

      case 'create_note': {
        const absolute = resolveInVault(root, text('path'))
        if (!absolute) return { text: 'That path is not inside the vault.', isError: true }
        const exists = await fsp
          .access(absolute)
          .then(() => true)
          .catch(() => false)
        if (exists) return { text: `${text('path')} already exists.`, isError: true }
        await fsp.mkdir(dirname(absolute), { recursive: true })
        await fsp.writeFile(absolute, text('content'), 'utf-8')
        return { text: `Created ${text('path')}.`, isError: false }
      }

      case 'append_note': {
        const absolute = resolveInVault(root, text('path'))
        if (!absolute) return { text: 'That path is not inside the vault.', isError: true }
        try {
          const existing = await fsp.readFile(absolute, 'utf-8')
          const joined = existing.endsWith('\n') ? existing : `${existing}\n`
          await fsp.writeFile(absolute, `${joined}${text('text')}\n`, 'utf-8')
          return { text: `Appended to ${text('path')}.`, isError: false }
        } catch {
          return { text: `Could not append to ${text('path')}.`, isError: true }
        }
      }

      default:
        return { text: `Orrery does not offer a tool called ${name}.`, isError: true }
    }
  }
}

/** The request body, as JSON, or undefined when there is none. */
async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'))
  } catch {
    return undefined
  }
}
