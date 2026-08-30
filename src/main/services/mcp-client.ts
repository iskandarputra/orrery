import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  CreateMessageRequestSchema,
  ElicitRequestSchema,
  ListRootsRequestSchema,
  LoggingMessageNotificationSchema,
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema
} from '@modelcontextprotocol/sdk/types.js'
import { pathToFileURL } from 'node:url'
import { expandEnv, type McpServerConfig } from '@core/mcp-config'
import {
  buildCatalogue,
  contentToText,
  truncate,
  type CatalogueEntry,
  type McpToolInfo
} from '@core/mcp-tools'
import {
  decide,
  permissionKey,
  reasonToAsk,
  type PermissionPolicy,
  type Remembered
} from '@core/mcp-permissions'
import type { Settings } from '@shared/settings'
import type { McpPromptInfo, McpResourceInfo, McpServerStatus, McpToolResult } from '@shared/types'
import type { AskUser } from './ask-user'
import type { McpAudit } from './mcp-audit'

/**
 * Talking to MCP servers.
 *
 * The shape is `lsp.ts`'s: one connection per configured server, started when
 * it is first needed, and incapable of taking anything else down with it. A
 * server that will not start, crashes, hangs or answers with nonsense leaves
 * the app exactly as it was without it. That is not politeness — an MCP server
 * is somebody else's program, run on this machine, on the user's say-so.
 *
 * The permission gate lives here rather than in the renderer because two very
 * different callers need it: a person clicking "run" in the panel, and a model
 * deciding to call a tool mid-sentence. If the check sat in the UI, the second
 * caller would arrive without one.
 */

export interface McpEvents {
  onServerChanged(status: McpServerStatus): void
  /** A call started or finished, for the panel's live log. */
  onActivity(): void
}

/**
 * Answering a server's `sampling/createMessage`: run these messages through
 * whichever model the user configured, and hand back what it said.
 */
export type Sampler = (system: string, prompt: string) => Promise<string>

interface SettingsAccess {
  get(): Settings
  set(patch: Partial<Settings>): Settings
}

/** How long to wait for a handshake before calling a server broken. */
const CONNECT_TIMEOUT_MS = 20_000
/** A crashed server is retried, but not forever and not instantly. */
const MAX_RETRIES = 3
const RETRY_BASE_MS = 1000

interface Connection {
  config: McpServerConfig
  client: Client | null
  status: McpServerStatus
  retries: number
  /** Set while connecting so two callers share one handshake. */
  connecting: Promise<McpServerStatus> | null
}

const emptyStatus = (config: McpServerConfig): McpServerStatus => ({
  id: config.id,
  name: config.name,
  enabled: config.enabled,
  state: 'idle',
  error: '',
  tools: [],
  resources: [],
  prompts: []
})

export class McpClientService {
  private readonly connections = new Map<string, Connection>()

  constructor(
    private readonly settings: SettingsAccess,
    private readonly ask: AskUser,
    private readonly audit: McpAudit,
    private readonly events: McpEvents,
    /** The vault: the working directory for stdio servers, and the one root. */
    private readonly vaultRoot: () => string | null,
    private readonly sample: Sampler
  ) {}

  /** Every configured server and what is known about it, connected or not. */
  statuses(): McpServerStatus[] {
    const configs = this.settings.get().mcp.servers
    // Configuration is the source of truth for which servers exist: one removed
    // in settings disappears here even if its connection is still winding down.
    for (const id of [...this.connections.keys()]) {
      if (!configs.some((c) => c.id === id)) this.forget(id)
    }
    return configs.map((config) => this.connections.get(config.id)?.status ?? emptyStatus(config))
  }

  /** Connect every enabled server. Called once the vault is open. */
  async connectAll(): Promise<void> {
    await Promise.all(
      this.settings
        .get()
        .mcp.servers.filter((config) => config.enabled)
        .map((config) => this.connect(config.id).catch(() => undefined))
    )
  }

  async connect(id: string): Promise<McpServerStatus> {
    const config = this.settings.get().mcp.servers.find((server) => server.id === id)
    if (!config) throw new Error(`No MCP server called ${id}`)

    const existing = this.connections.get(id)
    if (existing?.status.state === 'ready') return existing.status
    if (existing?.connecting) return existing.connecting

    const connection: Connection = existing ?? {
      config,
      client: null,
      status: { ...emptyStatus(config), state: 'connecting' },
      retries: 0,
      connecting: null
    }
    connection.config = config
    connection.status = { ...connection.status, state: 'connecting', error: '' }
    this.connections.set(id, connection)
    this.publish(connection)

    connection.connecting = this.handshake(connection)
    try {
      return await connection.connecting
    } finally {
      connection.connecting = null
    }
  }

  private async handshake(connection: Connection): Promise<McpServerStatus> {
    const { config } = connection
    try {
      const client = new Client(
        { name: 'orrery', version: '0.1.0' },
        // Declared because all three are implemented below. A client that
        // claims a capability and then refuses every request is worse than one
        // that never claimed it.
        {
          capabilities: {
            roots: { listChanged: true },
            sampling: {},
            elicitation: {}
          }
        }
      )
      this.serveClientCapabilities(client, config)

      client.onclose = () => this.onClosed(config.id)
      // A list that changes under us is the normal case: servers add tools when
      // they finish loading. Re-listing is cheap and keeps the panel honest.
      for (const schema of [
        ToolListChangedNotificationSchema,
        ResourceListChangedNotificationSchema,
        PromptListChangedNotificationSchema
      ]) {
        client.setNotificationHandler(schema, () => {
          void this.refresh(config.id)
        })
      }
      client.setNotificationHandler(LoggingMessageNotificationSchema, () => {
        // Kept quiet in the connection; the panel reads the audit log instead.
      })

      await client.connect(this.transportFor(config), { timeout: CONNECT_TIMEOUT_MS })
      connection.client = client
      connection.retries = 0
      connection.status = { ...connection.status, state: 'ready', error: '' }
      await this.listEverything(connection)
    } catch (err) {
      connection.client = null
      connection.status = {
        ...connection.status,
        state: 'failed',
        error: describeError(err),
        tools: [],
        resources: [],
        prompts: []
      }
    }
    this.publish(connection)
    return connection.status
  }

  /**
   * The three things a server may ask the client for.
   *
   * Two of them spend something that is not ours to spend — the user's
   * attention, and the user's model budget — so both go through the same
   * dialog a tool call does, and a refusal is an answer rather than an error.
   * The third, roots, is the vault, and is not worth interrupting anyone over.
   */
  private serveClientCapabilities(client: Client, config: McpServerConfig): void {
    client.setRequestHandler(ListRootsRequestSchema, () => {
      const root = this.vaultRoot()
      return root ? { roots: [{ uri: pathToFileURL(root).href, name: 'Vault' }] } : { roots: [] }
    })

    client.setRequestHandler(CreateMessageRequestSchema, async (request) => {
      const messages = request.params.messages
        .map((message) => {
          const content = message.content as { type?: string; text?: string }
          return content.type === 'text' ? `${message.role}: ${content.text ?? ''}` : ''
        })
        .filter(Boolean)
        .join('\n\n')

      const approved = await this.ask.ask<{ decision: string }>('sampling', {
        serverId: config.id,
        serverName: config.name,
        system: request.params.systemPrompt ?? '',
        preview: messages
      })
      if (!approved || approved.decision === 'deny') {
        // Refusing has to look like an answer, not a broken connection: a
        // server is entitled to carry on without the completion it asked for.
        return {
          model: 'orrery/refused',
          role: 'assistant',
          content: { type: 'text', text: 'The user declined this request.' },
          stopReason: 'endTurn'
        }
      }

      const text = await this.sample(request.params.systemPrompt ?? '', messages).catch(
        (err: unknown) => `The model could not answer: ${describeError(err)}`
      )
      return {
        model: 'orrery',
        role: 'assistant',
        content: { type: 'text', text },
        stopReason: 'endTurn'
      }
    })

    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      const params = request.params as { message?: string; requestedSchema?: unknown }
      const answer = await this.ask.ask<{
        action: 'accept' | 'decline' | 'cancel'
        content?: Record<string, unknown>
      }>('elicitation', {
        serverId: config.id,
        serverName: config.name,
        message: params.message ?? '',
        schema: params.requestedSchema ?? { type: 'object', properties: {} }
      })
      // No answer at all is a cancellation, which is what closing a window is.
      if (!answer) return { action: 'cancel' }
      return answer.action === 'accept'
        ? { action: 'accept', content: answer.content ?? {} }
        : { action: answer.action }
    })
  }

  /**
   * Tell every server the vault changed.
   *
   * A server given a root it can no longer read is worse than one given none:
   * it will keep answering about a folder nobody is looking at.
   */
  rootsChanged(): void {
    for (const connection of this.connections.values()) {
      if (connection.status.state !== 'ready') continue
      void connection.client?.sendRootsListChanged().catch(() => undefined)
    }
  }

  private transportFor(
    config: McpServerConfig
  ): StdioClientTransport | StreamableHTTPClientTransport {
    if (config.transport === 'http') {
      const headers = Object.fromEntries(
        Object.entries(config.headers).map(([key, value]) => [key, expandEnv(value, process.env)])
      )
      return new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: { headers }
      })
    }

    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') env[key] = value
    }
    for (const [key, value] of Object.entries(config.env)) {
      env[key] = expandEnv(value, process.env)
    }
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env,
      cwd: config.cwd || this.vaultRoot() || undefined,
      // Captured rather than inherited: a server writing a stack trace to the
      // terminal Orrery was launched from is a bug report nobody ever sees.
      stderr: 'pipe'
    })
  }

  /** Ask a connected server what it offers, guarded by what it says it has. */
  private async listEverything(connection: Connection): Promise<void> {
    const client = connection.client
    if (!client) return
    const capabilities = client.getServerCapabilities() ?? {}
    const timeout = this.settings.get().mcp.timeoutMs

    const tools = capabilities.tools
      ? await client
          .listTools(undefined, { timeout })
          .then((r) => r.tools as McpToolInfo[])
          .catch(() => [])
      : []
    const resources = capabilities.resources
      ? await client
          .listResources(undefined, { timeout })
          .then((r) => r.resources as McpResourceInfo[])
          .catch(() => [])
      : []
    const prompts = capabilities.prompts
      ? await client
          .listPrompts(undefined, { timeout })
          .then((r) => r.prompts as McpPromptInfo[])
          .catch(() => [])
      : []

    connection.status = { ...connection.status, tools, resources, prompts }
  }

  /**
   * Every tool the model may be offered, qualified by server.
   *
   * Only connected servers, and only tools the user left switched on: a tool
   * that is off should not be in the list the model chooses from, rather than
   * being refused after it picks one.
   */
  toolCatalogue(): CatalogueEntry[] {
    const disabled = this.settings.get().mcp.disabledTools
    return buildCatalogue(
      [...this.connections.values()]
        .filter((connection) => connection.status.state === 'ready')
        .map((connection) => ({
          id: connection.status.id,
          name: connection.status.name,
          tools: connection.status.tools,
          disabled: connection.status.tools
            .map((tool) => tool.name)
            .filter((name) => disabled.includes(`${connection.status.id}/${name}`))
        }))
    )
  }

  /** Re-read a server's lists, after a change notification or on demand. */
  async refresh(id: string): Promise<McpServerStatus> {
    const connection = this.connections.get(id)
    if (!connection || connection.status.state !== 'ready') return this.connect(id)
    await this.listEverything(connection)
    this.publish(connection)
    return connection.status
  }

  disconnect(id: string): void {
    const connection = this.connections.get(id)
    if (!connection) return
    connection.retries = MAX_RETRIES // deliberate: do not reconnect behind the user
    try {
      void connection.client?.close()
    } catch {
      // Going away anyway.
    }
    connection.client = null
    connection.status = {
      ...connection.status,
      state: 'idle',
      tools: [],
      resources: [],
      prompts: []
    }
    this.publish(connection)
  }

  private forget(id: string): void {
    this.disconnect(id)
    this.connections.delete(id)
  }

  /**
   * A connection dropped.
   *
   * Servers exit for ordinary reasons — a wrapper script restarting, a machine
   * waking up — so a ready connection is retried a few times with a widening
   * gap. One that never came up is not retried at all: it is broken, and
   * hammering it turns one failure into a stream of them.
   */
  private onClosed(id: string): void {
    const connection = this.connections.get(id)
    if (!connection || connection.status.state === 'idle') return

    connection.client = null
    connection.status = {
      ...connection.status,
      state: 'failed',
      tools: [],
      resources: [],
      prompts: []
    }
    this.publish(connection)

    if (!connection.config.enabled || connection.retries >= MAX_RETRIES) return
    const wait = RETRY_BASE_MS * 2 ** connection.retries
    connection.retries += 1
    setTimeout(() => {
      if (this.connections.get(id) === connection) void this.connect(id).catch(() => undefined)
    }, wait).unref?.()
  }

  /**
   * Run a tool, asking first unless the answer is already known.
   *
   * `source` says who wanted it. It reaches the dialog, because "the model
   * would like to run this" and "you clicked run" deserve different wording,
   * and it reaches the log, because afterwards that is the interesting part.
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    source: 'user' | 'model' = 'user'
  ): Promise<McpToolResult> {
    const started = Date.now()
    const connection = this.connections.get(serverId)
    const config = this.settings.get().mcp.servers.find((server) => server.id === serverId)
    const name = config?.name ?? serverId

    if (!connection || connection.status.state !== 'ready' || !connection.client) {
      // One retry through the front door: the model asking for a tool is a
      // perfectly good reason to start the server that has it.
      const status = await this.connect(serverId).catch(() => null)
      if (!status || status.state !== 'ready') {
        return this.fail(serverId, name, toolName, args, started, 'Server is not connected')
      }
      return this.callTool(serverId, toolName, args, source)
    }

    const tool = connection.status.tools.find((candidate) => candidate.name === toolName)
    if (!tool) {
      return this.fail(serverId, name, toolName, args, started, `No tool called ${toolName}`)
    }

    const policy = this.policy()
    let decision = decide(policy, serverId, tool)

    if (decision === 'ask') {
      const answer = await this.ask.ask<{ decision: 'allow' | 'once' | 'deny' | 'never' }>('tool', {
        serverId,
        serverName: name,
        tool,
        args,
        source,
        reason: reasonToAsk(policy, serverId, tool)
      })
      if (!answer || answer.decision === 'deny' || answer.decision === 'never') {
        // A plain refusal is about this call. Only "never" is remembered, and
        // only because the user asked for it: a dialog whose Deny button
        // silently bans a tool forever is a dialog nobody can use twice.
        if (answer?.decision === 'never') this.remember(serverId, toolName, 'deny')
        await this.log({
          serverId,
          serverName: name,
          tool: toolName,
          args,
          decision: 'deny',
          outcome: 'denied',
          ms: Date.now() - started,
          summary: answer ? 'Refused' : 'No answer'
        })
        return { text: 'The user refused this tool call.', isError: true, denied: true }
      }
      if (answer.decision === 'allow') this.remember(serverId, toolName, 'allow')
      decision = 'allow'
    }

    if (decision === 'deny') {
      await this.log({
        serverId,
        serverName: name,
        tool: toolName,
        args,
        decision: 'deny',
        outcome: 'denied',
        ms: Date.now() - started,
        summary: 'Refused earlier, and not asked again'
      })
      return { text: 'This tool has been denied for this server.', isError: true, denied: true }
    }

    const { timeoutMs, maxResultChars } = this.settings.get().mcp
    try {
      const result = await connection.client.callTool(
        { name: toolName, arguments: args },
        undefined,
        { timeout: timeoutMs }
      )
      const text = truncate(contentToText(result.content, result.structuredContent), maxResultChars)
      const isError = result.isError === true
      await this.log({
        serverId,
        serverName: name,
        tool: toolName,
        args,
        decision: 'allow',
        outcome: isError ? 'error' : 'ok',
        ms: Date.now() - started,
        summary: text
      })
      return { text, isError, denied: false }
    } catch (err) {
      return this.fail(serverId, name, toolName, args, started, describeError(err))
    }
  }

  async readResource(serverId: string, uri: string): Promise<string> {
    const connection = this.connections.get(serverId)
    if (!connection?.client) return ''
    try {
      const result = await connection.client.readResource(
        { uri },
        { timeout: this.settings.get().mcp.timeoutMs }
      )
      const contents = (result.contents ?? []) as { text?: string; uri?: string }[]
      return contents.map((part) => part.text ?? `[binary: ${part.uri ?? uri}]`).join('\n')
    } catch (err) {
      return `Could not read ${uri}: ${describeError(err)}`
    }
  }

  async getPrompt(
    serverId: string,
    name: string,
    args: Record<string, string> = {}
  ): Promise<string> {
    const connection = this.connections.get(serverId)
    if (!connection?.client) return ''
    try {
      const result = await connection.client.getPrompt(
        { name, arguments: args },
        { timeout: this.settings.get().mcp.timeoutMs }
      )
      return (result.messages ?? [])
        .map((message) => contentToText([message.content]))
        .filter(Boolean)
        .join('\n\n')
    } catch (err) {
      return `Could not read prompt ${name}: ${describeError(err)}`
    }
  }

  /** Stop every server. Called on quit, so none outlive the window. */
  async shutdown(): Promise<void> {
    for (const connection of this.connections.values()) {
      try {
        await connection.client?.close()
      } catch {
        // Quitting anyway.
      }
    }
    this.connections.clear()
  }

  private policy(): PermissionPolicy {
    // `alwaysAsk` is empty here and filled by Orrery's own server for its
    // writing tools; a server someone else wrote gets no standing exemption
    // either way, because the rules above already make it ask by default.
    return { remembered: this.settings.get().mcp.permissions.remembered, alwaysAsk: [] }
  }

  private remember(serverId: string, toolName: string, decision: Remembered): void {
    const { mcp } = this.settings.get()
    this.settings.set({
      mcp: {
        ...mcp,
        permissions: {
          remembered: {
            ...mcp.permissions.remembered,
            [permissionKey(serverId, toolName)]: decision
          }
        }
      }
    })
  }

  private async fail(
    serverId: string,
    serverName: string,
    tool: string,
    args: Record<string, unknown>,
    started: number,
    message: string
  ): Promise<McpToolResult> {
    await this.log({
      serverId,
      serverName,
      tool,
      args,
      decision: 'allow',
      outcome: 'error',
      ms: Date.now() - started,
      summary: message
    })
    return { text: message, isError: true, denied: false }
  }

  private async log(entry: Omit<Parameters<McpAudit['write']>[0], 'at'>): Promise<void> {
    await this.audit.write({ ...entry, at: Date.now() })
    this.events.onActivity()
  }

  private publish(connection: Connection): void {
    this.events.onServerChanged(connection.status)
  }
}

/** What went wrong, in one line, without a stack nobody reads. */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  return typeof err === 'string' ? err : 'Unknown error'
}
