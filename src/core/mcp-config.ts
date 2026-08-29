/**
 * What an MCP server is, before anything tries to talk to one.
 *
 * A server definition is user input in the worst place: a command line that is
 * spawned, or a URL that is called, with environment variables that may hold
 * secrets. So the shape is validated here, in a module that cannot spawn
 * anything, and the parts that are decisions rather than protocol — is this
 * command plausible, which config blob did the user paste, what does `${VAR}`
 * mean — are pure functions with tests.
 *
 * The import path matters as much as the shape. Everyone with MCP servers
 * already has them written down in Claude Desktop's `claude_desktop_config.json`
 * or a `.mcp.json`, and asking them to retype that into a form is asking them
 * not to bother.
 */

export interface StdioServer {
  transport: 'stdio'
  /** The executable. Not a shell line: no quoting rules, no injection. */
  command: string
  args: string[]
  /** Extra environment for the child. Values may be `${VAR}` references. */
  env: Record<string, string>
  /** Working directory; empty means the vault. */
  cwd: string
}

export interface HttpServer {
  transport: 'http'
  url: string
  headers: Record<string, string>
}

export type McpServerConfig = { id: string; name: string; enabled: boolean } & (
  StdioServer | HttpServer
)

/** A definition read out of someone's config file, with what was wrong with it. */
export interface ImportResult {
  servers: McpServerConfig[]
  /** One line per entry that could not be read, naming it. */
  errors: string[]
}

const ID_MAX = 40

/**
 * A stable id from a display name.
 *
 * Ids reach the model as part of a tool name, so they are limited to what every
 * provider accepts there: letters, digits, underscore.
 */
export function serverId(name: string, taken: readonly string[] = []): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, ID_MAX) || 'server'
  if (!taken.includes(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, ID_MAX - 3)}_${n}`
    if (!taken.includes(candidate)) return candidate
  }
}

/**
 * Everything wrong with a definition, in the words of someone who has to fix it.
 *
 * Returned as a list rather than thrown: a form shows all of its problems at
 * once, and a config file being imported reports per entry rather than stopping
 * at the first bad one.
 */
export function configErrors(server: McpServerConfig): string[] {
  const errors: string[] = []
  if (!server.name.trim()) errors.push('Needs a name')

  if (server.transport === 'stdio') {
    if (!server.command.trim()) errors.push('Needs a command to run')
    // A command line pasted whole ("npx -y server") spawns nothing: the args
    // are a list, and saying so beats a process that exits instantly.
    else if (/\s/.test(server.command.trim())) {
      errors.push('The command is one executable; put the rest in arguments')
    }
    return errors
  }

  const url = server.url.trim()
  if (!url) errors.push('Needs a URL')
  else {
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        errors.push('URL must be http or https')
      }
    } catch {
      errors.push('URL is not valid')
    }
  }
  return errors
}

/** One line describing where a server comes from, for a list nobody wants to read twice. */
export function describeServer(server: McpServerConfig): string {
  if (server.transport === 'http') return server.url
  return [server.command, ...server.args].join(' ')
}

/**
 * Expand `${VAR}` and `${env:VAR}` against an environment.
 *
 * Config files in the wild use both spellings, and a server whose token lives
 * in the shell environment should not have it copied into a settings file that
 * syncs. An unset variable expands to nothing rather than to the literal text,
 * because passing `${GITHUB_TOKEN}` as a token produces a confusing 401 instead
 * of an obvious empty one.
 */
export function expandEnv(value: string, env: Record<string, string | undefined>): string {
  return value.replace(
    /\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}/g,
    (_, name: string) => env[name] ?? ''
  )
}

interface RawEntry {
  command?: unknown
  args?: unknown
  env?: unknown
  cwd?: unknown
  url?: unknown
  headers?: unknown
  type?: unknown
  disabled?: unknown
}

const asStringMap = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') out[key] = raw
    else if (typeof raw === 'number' || typeof raw === 'boolean') out[key] = String(raw)
  }
  return out
}

const asStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

/**
 * Read the config format every MCP client already uses.
 *
 * `{"mcpServers": {...}}` is Claude Desktop and `.mcp.json`; `{"servers": {...}}`
 * is the VS Code spelling; a bare map of entries is what people paste when they
 * strip the wrapper. All three are accepted, because the alternative is telling
 * someone their own config is the wrong shape.
 */
export function importServers(json: string, taken: readonly string[] = []): ImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { servers: [], errors: ['That is not valid JSON'] }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { servers: [], errors: ['Expected an object of servers'] }
  }

  const root = parsed as Record<string, unknown>
  const container = (root['mcpServers'] ?? root['servers'] ?? root) as Record<string, unknown>
  if (!container || typeof container !== 'object' || Array.isArray(container)) {
    return { servers: [], errors: ['Expected an object of servers'] }
  }

  const servers: McpServerConfig[] = []
  const errors: string[] = []
  const ids = [...taken]

  for (const [name, value] of Object.entries(container)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${name}: not a server definition`)
      continue
    }
    const entry = value as RawEntry
    const id = serverId(name, ids)
    const shared = { id, name, enabled: entry.disabled !== true }

    const server: McpServerConfig =
      typeof entry.url === 'string'
        ? { ...shared, transport: 'http', url: entry.url, headers: asStringMap(entry.headers) }
        : {
            ...shared,
            transport: 'stdio',
            command: typeof entry.command === 'string' ? entry.command : '',
            args: asStringList(entry.args),
            env: asStringMap(entry.env),
            cwd: typeof entry.cwd === 'string' ? entry.cwd : ''
          }

    const problems = configErrors(server)
    if (problems.length > 0) {
      errors.push(`${name}: ${problems.join(', ')}`)
      continue
    }
    ids.push(id)
    servers.push(server)
  }

  if (servers.length === 0 && errors.length === 0) errors.push('No servers found')
  return { servers, errors }
}

/** The config block to paste into another client, for Orrery's own server. */
export function clientConfigSnippet(url: string, token: string): string {
  return JSON.stringify(
    { mcpServers: { orrery: { url, headers: { Authorization: `Bearer ${token}` } } } },
    null,
    2
  )
}
