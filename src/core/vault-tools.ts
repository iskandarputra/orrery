/**
 * What Orrery offers other MCP clients, described once.
 *
 * The definitions live here, as data, so the server that serves them and the
 * tests that check them read the same list, and so the two decisions that
 * matter are pure functions rather than lines buried in a request handler:
 *
 *  - **which tools write**, because those are the ones that ask before running
 *    and the ones a read-only vault refuses outright;
 *  - **whether a path is inside the vault**, because every path in every
 *    argument arrives from somebody else's agent, and `../../.ssh/id_rsa` is
 *    a perfectly ordinary string.
 *
 * Nothing here touches the filesystem. That is the point: the rules can be
 * tested without one, and there is no code path where a rule is skipped
 * because the caller was in a hurry.
 */

export interface VaultToolSpec {
  name: string
  title: string
  description: string
  /** JSON Schema for the arguments, as MCP describes them. */
  inputSchema: Record<string, unknown>
  /** Writes to the vault. Off unless the user allows writing, and always asks. */
  writes: boolean
  /** For a read-only tool, the annotation that says so. */
  readOnly: boolean
}

const object = (
  properties: Record<string, unknown>,
  required: string[] = []
): Record<string, unknown> => ({
  type: 'object',
  properties,
  ...(required.length > 0 ? { required } : {})
})

const str = (description: string): Record<string, unknown> => ({ type: 'string', description })

/**
 * The tools, in the order a reader would want to meet them.
 *
 * Paths are vault-relative everywhere, in and out: an agent that has to know
 * where the vault lives on disk to read a note is one absolute path away from
 * reading something else.
 */
export const VAULT_TOOLS: VaultToolSpec[] = [
  {
    name: 'search_notes',
    title: 'Search notes',
    description:
      'Full-text search across every text file in the vault. Returns matching lines with their file and line number.',
    inputSchema: object(
      {
        query: str('What to look for'),
        regex: { type: 'boolean', description: 'Treat the query as a regular expression' },
        limit: { type: 'integer', description: 'Maximum hits to return (default 50)' }
      },
      ['query']
    ),
    writes: false,
    readOnly: true
  },
  {
    name: 'read_note',
    title: 'Read a note',
    description: 'The full text of one file in the vault, by its vault-relative path.',
    inputSchema: object({ path: str('Vault-relative path, e.g. Projects/Orrery.md') }, ['path']),
    writes: false,
    readOnly: true
  },
  {
    name: 'list_notes',
    title: 'List notes',
    description: 'Every markdown note in the vault, as vault-relative paths.',
    inputSchema: object({
      folder: str('Limit to this folder, vault-relative. Omit for the whole vault.')
    }),
    writes: false,
    readOnly: true
  },
  {
    name: 'backlinks',
    title: 'Backlinks',
    description: 'Every note that links to the given one, with the line each mention sits on.',
    inputSchema: object({ note: str('Note name or vault-relative path') }, ['note']),
    writes: false,
    readOnly: true
  },
  {
    name: 'git_status',
    title: 'Git status',
    description: 'Changed, staged and untracked files in the vault, if it is a git repository.',
    inputSchema: object({}),
    writes: false,
    readOnly: true
  },
  {
    name: 'git_log',
    title: 'Git log',
    description: 'Recent commits in the vault, newest first.',
    inputSchema: object({ limit: { type: 'integer', description: 'How many (default 20)' } }),
    writes: false,
    readOnly: true
  },
  {
    name: 'create_note',
    title: 'Create a note',
    description: 'Write a new note. Fails if a file is already there.',
    inputSchema: object(
      { path: str('Vault-relative path, ending in .md'), content: str('The note body') },
      ['path', 'content']
    ),
    writes: true,
    readOnly: false
  },
  {
    name: 'append_note',
    title: 'Append to a note',
    description: 'Add text to the end of an existing note.',
    inputSchema: object({ path: str('Vault-relative path'), text: str('Text to add') }, [
      'path',
      'text'
    ]),
    writes: true,
    readOnly: false
  }
]

export const writeTools = (): VaultToolSpec[] => VAULT_TOOLS.filter((tool) => tool.writes)

/** The tools on offer, given whether writing is allowed and what is switched off. */
export function offeredTools(
  allowWrites: boolean,
  disabled: readonly string[] = []
): VaultToolSpec[] {
  return VAULT_TOOLS.filter(
    (tool) => (allowWrites || !tool.writes) && !disabled.includes(tool.name)
  )
}

/**
 * Turn a vault-relative path into an absolute one, or refuse.
 *
 * Refuses anything that climbs out of the vault, anything absolute, and
 * anything with a null byte in it. The check is on the *resolved* path rather
 * than on the text, because `notes/../../etc/passwd` contains no leading `..`
 * and is still outside.
 */
export function resolveInVault(root: string, relative: string): string | null {
  if (!root || typeof relative !== 'string' || relative.includes('\0')) return null
  const trimmed = relative.trim()
  if (trimmed === '' || trimmed.startsWith('/') || /^[a-zA-Z]:/.test(trimmed)) return null

  const base = root.replace(/\/+$/, '')
  const parts: string[] = []
  for (const part of `${base}/${trimmed}`.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
      continue
    }
    parts.push(part)
  }
  const resolved = `/${parts.join('/')}`
  // Inside, and not the vault directory itself: a tool takes a file.
  return resolved.startsWith(`${base}/`) ? resolved : null
}

/** The path as a client should see it: relative to the vault, never absolute. */
export function vaultRelative(root: string, absolute: string): string {
  const base = `${root.replace(/\/+$/, '')}/`
  return absolute.startsWith(base) ? absolute.slice(base.length) : absolute
}

/** A note's uri, for the resource list. */
export function noteUri(relative: string): string {
  return `orrery://note/${relative.split('/').map(encodeURIComponent).join('/')}`
}

/** The path back out of a uri, or null if it is not one of ours. */
export function pathFromUri(uri: string): string | null {
  if (!uri.startsWith('orrery://note/')) return null
  const encoded = uri.slice('orrery://note/'.length)
  try {
    return encoded.split('/').map(decodeURIComponent).join('/')
  } catch {
    return null
  }
}
