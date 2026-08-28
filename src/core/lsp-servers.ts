import { extname } from './paths'

/**
 * The language servers Orrery knows how to talk to.
 *
 * Servers are discovered on PATH rather than bundled. Bundling one would add
 * tens of megabytes to every install and still only cover a single language
 * family — Python, Go and Rust would need discovery regardless — so discovery
 * is the mechanism, and bundling could only ever be a layer on top of it.
 *
 * The cost of that choice is that a language with nothing installed does
 * nothing at all, which is why `install` is part of the record: a missing
 * server is reported, with the command that would supply it, rather than
 * silently doing nothing.
 */
export interface ServerSpec {
  /** LSP `languageId`, as the protocol spells it. */
  languageId: string
  /** Human name, for the UI. */
  label: string
  /** Executable to look for on PATH. */
  command: string
  args: string[]
  /** What the user would run to get it. Shown when it is missing. */
  install: string
}

const SERVERS: ServerSpec[] = [
  {
    languageId: 'typescript',
    label: 'TypeScript',
    command: 'typescript-language-server',
    args: ['--stdio'],
    install: 'npm i -g typescript-language-server typescript'
  },
  {
    languageId: 'python',
    label: 'Python',
    command: 'pyright-langserver',
    args: ['--stdio'],
    install: 'npm i -g pyright'
  },
  {
    languageId: 'rust',
    label: 'Rust',
    command: 'rust-analyzer',
    args: [],
    install: 'rustup component add rust-analyzer'
  },
  {
    languageId: 'go',
    label: 'Go',
    command: 'gopls',
    args: [],
    install: 'go install golang.org/x/tools/gopls@latest'
  },
  {
    languageId: 'json',
    label: 'JSON',
    command: 'vscode-json-language-server',
    args: ['--stdio'],
    install: 'npm i -g vscode-langservers-extracted'
  }
]

/** Extensions that map onto a server's languageId. */
const BY_EXTENSION: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  // typescript-language-server serves JavaScript from the same process.
  '.js': 'typescript',
  '.jsx': 'typescript',
  '.mjs': 'typescript',
  '.cjs': 'typescript',
  '.py': 'python',
  '.pyi': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.json': 'json',
  '.jsonc': 'json'
}

export function allServers(): ServerSpec[] {
  return SERVERS
}

/** The server that would serve this file, installed or not. */
export function serverForFile(filePath: string): ServerSpec | null {
  const languageId = BY_EXTENSION[extname(filePath).toLowerCase()]
  if (!languageId) return null
  return SERVERS.find((s) => s.languageId === languageId) ?? null
}

/** The `languageId` to report in `textDocument/didOpen`. */
export function languageIdForFile(filePath: string): string | null {
  return BY_EXTENSION[extname(filePath).toLowerCase()] ?? null
}
