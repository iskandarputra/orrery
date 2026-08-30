/**
 * Turning many servers' tools into one list a model can be handed.
 *
 * Two servers both offering `search` is the normal case, not the edge case, so
 * every tool is qualified by the server it came from. The qualified name then
 * has to survive being put in a provider's tool list, where the rules are
 * narrower than MCP's: letters, digits, underscore and dash, 64 characters.
 * Truncating to fit can itself collide, which is why this is a function with
 * tests rather than a template string at the call site.
 *
 * The other half is the reverse trip: a tool result is a list of content blocks
 * — text, images, links, embedded resources — and a chat model takes text. What
 * is dropped in that flattening should be visible in the transcript rather than
 * silently missing, so the parts that cannot be text say what they were.
 */

export interface ToolAnnotations {
  title?: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface McpToolInfo {
  name: string
  title?: string
  description?: string
  inputSchema?: Record<string, unknown>
  annotations?: ToolAnnotations
}

export interface CatalogueEntry {
  /** The name the model sees: `server__tool`. */
  qualified: string
  serverId: string
  serverName: string
  tool: McpToolInfo
}

export interface CatalogueInput {
  id: string
  name: string
  tools: McpToolInfo[]
  /** Tools switched off by the user, by bare tool name. */
  disabled?: string[]
}

/** Providers agree on this much: `^[a-zA-Z0-9_-]{1,64}$`. */
const NAME_MAX = 64

const sanitise = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, '_')

/**
 * `server__tool`, trimmed to fit and made unique.
 *
 * The tool's own name is what gets trimmed, never the server's: two tools from
 * one server with a long shared prefix must stay apart, and knowing which
 * server answered matters more than the tail of a name.
 */
export function qualify(serverId: string, toolName: string, taken: readonly string[] = []): string {
  const prefix = `${sanitise(serverId)}__`
  const room = Math.max(1, NAME_MAX - prefix.length)
  let candidate = prefix + sanitise(toolName).slice(0, room)
  for (let n = 2; taken.includes(candidate); n++) {
    const suffix = `_${n}`
    candidate = prefix + sanitise(toolName).slice(0, Math.max(1, room - suffix.length)) + suffix
  }
  return candidate
}

/** Every enabled tool from every connected server, as one list. */
export function buildCatalogue(servers: readonly CatalogueInput[]): CatalogueEntry[] {
  const entries: CatalogueEntry[] = []
  const taken: string[] = []
  for (const server of servers) {
    for (const tool of server.tools) {
      if (server.disabled?.includes(tool.name)) continue
      const qualified = qualify(server.id, tool.name, taken)
      taken.push(qualified)
      entries.push({ qualified, serverId: server.id, serverName: server.name, tool })
    }
  }
  return entries
}

export function findTool(
  catalogue: readonly CatalogueEntry[],
  qualified: string
): CatalogueEntry | null {
  return catalogue.find((entry) => entry.qualified === qualified) ?? null
}

interface EmbeddedResource {
  uri?: string
  mimeType?: string
  text?: string
}

interface ContentBlock {
  type?: string
  text?: string
  mimeType?: string
  uri?: string
  name?: string
  resource?: EmbeddedResource
}

/**
 * A tool result as text.
 *
 * An image or a binary resource cannot be text, so it leaves a line saying what
 * it was. A transcript that reads "the tool returned nothing" when it returned a
 * PNG is a transcript that sends someone debugging the wrong thing.
 */
export function contentToText(content: unknown, structured?: unknown): string {
  const parts: string[] = []

  if (Array.isArray(content)) {
    for (const raw of content as ContentBlock[]) {
      if (!raw || typeof raw !== 'object') continue
      switch (raw.type) {
        case 'text':
          if (raw.text) parts.push(raw.text)
          break
        case 'image':
        case 'audio':
          parts.push(`[${raw.type}: ${raw.mimeType ?? 'unknown type'}]`)
          break
        case 'resource_link':
          parts.push(
            `[resource: ${raw.name ?? raw.uri ?? 'unnamed'}${raw.uri ? ` (${raw.uri})` : ''}]`
          )
          break
        case 'resource': {
          const resource = raw.resource
          if (resource?.text) parts.push(resource.text)
          else parts.push(`[resource: ${resource?.uri ?? 'embedded'}]`)
          break
        }
        default:
          if (raw.text) parts.push(raw.text)
      }
    }
  }

  // Structured output is the machine-readable half of the same answer. It is
  // included only when there was no text, so a server that sends both does not
  // say everything twice.
  if (parts.length === 0 && structured !== undefined && structured !== null) {
    parts.push(JSON.stringify(structured, null, 2))
  }
  return parts.join('\n')
}

/**
 * Keep a result to a size worth sending to a model.
 *
 * The middle goes rather than the tail: the end of a tool result is often where
 * the summary or the error is, and a result cut off mid-sentence with nothing
 * to say about it looks like the tool failed.
 */
export function truncate(text: string, max: number): string {
  if (max <= 0 || text.length <= max) return text
  const dropped = text.length - max
  const head = Math.ceil(max * 0.6)
  const tail = max - head
  return `${text.slice(0, head)}\n\n… ${dropped.toLocaleString()} characters omitted …\n\n${text.slice(text.length - tail)}`
}

export interface PromptArgument {
  name: string
  description?: string
  required?: boolean
}

/**
 * A prompt's arguments, as a JSON Schema.
 *
 * MCP describes prompt arguments as a flat list rather than a schema, but they
 * are filled in by the same form as everything else, and a form wants a schema.
 * Every argument is a string: that is all the protocol offers.
 */
export function schemaForPromptArguments(
  args: readonly PromptArgument[] | undefined
): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const argument of args ?? []) {
    if (!argument?.name) continue
    properties[argument.name] = {
      type: 'string',
      ...(argument.description ? { description: argument.description } : {})
    }
    if (argument.required) required.push(argument.name)
  }
  return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) }
}

/** Does this tool change anything? Used for wording, not for permission. */
export function isReadOnly(tool: McpToolInfo): boolean {
  return tool.annotations?.readOnlyHint === true
}

/** What to show as the tool's name in the UI: its title if it has one. */
export function toolLabel(tool: McpToolInfo): string {
  return tool.annotations?.title || tool.title || tool.name
}
