import { describe, expect, it } from 'vitest'
import {
  clientConfigSnippet,
  configErrors,
  describeServer,
  expandEnv,
  importServers,
  serverId,
  type McpServerConfig
} from './mcp-config'

type StdioConfig = Extract<McpServerConfig, { transport: 'stdio' }>

const stdio = (over: Partial<StdioConfig> = {}): StdioConfig => ({
  id: 'files',
  name: 'files',
  enabled: true,
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
  env: {},
  cwd: '',
  ...over
})

describe('serverId', () => {
  it('makes a name safe to put in a tool name', () => {
    expect(serverId('GitHub Issues!')).toBe('github_issues')
  })

  it('never collides with one already taken', () => {
    expect(serverId('files', ['files'])).toBe('files_2')
    expect(serverId('files', ['files', 'files_2'])).toBe('files_3')
  })

  it('has something to say about a name with nothing usable in it', () => {
    expect(serverId('***')).toBe('server')
  })
})

describe('configErrors', () => {
  it('accepts a working definition', () => {
    expect(configErrors(stdio())).toEqual([])
  })

  it('rejects a whole command line pasted into the command field', () => {
    // It would spawn nothing: the executable is one word.
    expect(configErrors(stdio({ command: 'npx -y some-server' }))).toEqual([
      'The command is one executable; put the rest in arguments'
    ])
  })

  it('names every problem at once', () => {
    expect(configErrors(stdio({ name: '  ', command: '' }))).toEqual([
      'Needs a name',
      'Needs a command to run'
    ])
  })

  it('checks a URL is one, and one we can speak', () => {
    const http = (url: string): McpServerConfig => ({
      id: 'r',
      name: 'remote',
      enabled: true,
      transport: 'http',
      url,
      headers: {}
    })
    expect(configErrors(http('https://example.com/mcp'))).toEqual([])
    expect(configErrors(http('not a url'))).toEqual(['URL is not valid'])
    expect(configErrors(http('ftp://example.com'))).toEqual(['URL must be http or https'])
  })
})

describe('expandEnv', () => {
  it('reads both spellings config files use', () => {
    expect(expandEnv('${TOKEN}/${env:USER}', { TOKEN: 'abc', USER: 'ada' })).toBe('abc/ada')
  })

  it('expands an unset variable to nothing, not to its own name', () => {
    // Passing the literal `${TOKEN}` as a token produces a puzzling 401.
    expect(expandEnv('Bearer ${TOKEN}', {})).toBe('Bearer ')
  })

  it('leaves text that only looks like a reference alone', () => {
    expect(expandEnv('costs $5 {TOKEN}', { TOKEN: 'x' })).toBe('costs $5 {TOKEN}')
  })
})

describe('importServers', () => {
  const config = JSON.stringify({
    mcpServers: {
      filesystem: { command: 'npx', args: ['-y', 'server-filesystem', '/tmp'] },
      github: { command: 'docker', args: ['run', 'ghcr.io/github/mcp'], env: { TOKEN: 'x' } },
      remote: { url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer x' } }
    }
  })

  it('reads a Claude Desktop config as it is', () => {
    const { servers, errors } = importServers(config)
    expect(errors).toEqual([])
    expect(servers.map((s) => s.name)).toEqual(['filesystem', 'github', 'remote'])
    expect(servers[0]).toMatchObject({ transport: 'stdio', command: 'npx' })
    expect(servers[2]).toMatchObject({ transport: 'http', url: 'https://mcp.example.com/mcp' })
  })

  it('reads the VS Code spelling and a bare map too', () => {
    const bare = JSON.stringify({ files: { command: 'npx', args: [] } })
    expect(importServers(bare).servers).toHaveLength(1)
    expect(
      importServers(JSON.stringify({ servers: { files: { command: 'npx' } } })).servers
    ).toHaveLength(1)
  })

  it('keeps the good entries and reports the bad ones', () => {
    // One broken server in a file of five should not cost the other four.
    const mixed = JSON.stringify({
      mcpServers: { good: { command: 'npx' }, bad: { args: ['x'] }, worse: 'nonsense' }
    })
    const { servers, errors } = importServers(mixed)
    expect(servers.map((s) => s.name)).toEqual(['good'])
    expect(errors).toEqual(['bad: Needs a command to run', 'worse: not a server definition'])
  })

  it('honours the disabled flag other clients write', () => {
    const off = JSON.stringify({ mcpServers: { files: { command: 'npx', disabled: true } } })
    expect(importServers(off).servers[0]?.enabled).toBe(false)
  })

  it('gives ids that do not collide with servers already configured', () => {
    const { servers } = importServers(
      JSON.stringify({ mcpServers: { files: { command: 'npx' } } }),
      ['files']
    )
    expect(servers[0]?.id).toBe('files_2')
  })

  it('says what is wrong rather than throwing', () => {
    expect(importServers('{oh dear').errors).toEqual(['That is not valid JSON'])
    expect(importServers('[]').errors).toEqual(['Expected an object of servers'])
    expect(importServers('{}').errors).toEqual(['No servers found'])
  })
})

describe('describeServer', () => {
  it('shows the command line or the URL', () => {
    expect(describeServer(stdio())).toBe('npx -y @modelcontextprotocol/server-filesystem /tmp')
    expect(
      describeServer({
        id: 'r',
        name: 'r',
        enabled: true,
        transport: 'http',
        url: 'https://x/mcp',
        headers: {}
      })
    ).toBe('https://x/mcp')
  })
})

describe('clientConfigSnippet', () => {
  it('is a config another client can be given as it stands', () => {
    const snippet = clientConfigSnippet('http://127.0.0.1:7373/mcp', 'tok')
    expect(JSON.parse(snippet)).toEqual({
      mcpServers: {
        orrery: { url: 'http://127.0.0.1:7373/mcp', headers: { Authorization: 'Bearer tok' } }
      }
    })
    // And round-trips back through our own importer.
    expect(importServers(snippet).servers[0]).toMatchObject({ transport: 'http' })
  })
})
