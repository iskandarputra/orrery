import { describe, expect, it } from 'vitest'
import {
  buildCatalogue,
  contentToText,
  findTool,
  isReadOnly,
  qualify,
  schemaForPromptArguments,
  toolLabel,
  truncate,
  type CatalogueInput
} from './mcp-tools'

const tool = (name: string, over = {}): CatalogueInput['tools'][number] => ({
  name,
  description: `does ${name}`,
  inputSchema: { type: 'object' },
  ...over
})

describe('qualify', () => {
  it('names the server the tool came from', () => {
    expect(qualify('github', 'create_issue')).toBe('github__create_issue')
  })

  it('drops what a provider will not accept in a tool name', () => {
    expect(qualify('my server', 'search files!')).toBe('my_server__search_files_')
  })

  it('fits inside the 64 characters every provider allows', () => {
    const long = qualify('files', 'a'.repeat(120))
    expect(long.length).toBe(64)
    expect(long.startsWith('files__')).toBe(true)
  })

  it('stays unique when trimming makes two names the same', () => {
    // Both tools trim to the same 57 characters; the second has to differ.
    const first = qualify('files', `${'a'.repeat(60)}_one`)
    const second = qualify('files', `${'a'.repeat(60)}_two`, [first])
    expect(second).not.toBe(first)
    expect(second.length).toBeLessThanOrEqual(64)
  })
})

describe('buildCatalogue', () => {
  const servers: CatalogueInput[] = [
    { id: 'github', name: 'GitHub', tools: [tool('search'), tool('create_issue')] },
    { id: 'files', name: 'Filesystem', tools: [tool('search'), tool('read')] }
  ]

  it('keeps two servers offering the same tool apart', () => {
    expect(buildCatalogue(servers).map((e) => e.qualified)).toEqual([
      'github__search',
      'github__create_issue',
      'files__search',
      'files__read'
    ])
  })

  it('leaves out the tools the user switched off', () => {
    const trimmed = buildCatalogue([{ ...servers[0]!, disabled: ['create_issue'] }])
    expect(trimmed.map((e) => e.qualified)).toEqual(['github__search'])
  })

  it('finds a tool by the name the model used, and admits when it cannot', () => {
    const catalogue = buildCatalogue(servers)
    expect(findTool(catalogue, 'files__read')?.serverName).toBe('Filesystem')
    // A model that invents a tool name gets an answer, not an exception.
    expect(findTool(catalogue, 'files__invented')).toBeNull()
  })
})

describe('contentToText', () => {
  it('joins the text blocks', () => {
    expect(
      contentToText([
        { type: 'text', text: 'one' },
        { type: 'text', text: 'two' }
      ])
    ).toBe('one\ntwo')
  })

  it('says what an image was rather than dropping it silently', () => {
    // "The tool returned nothing" would send someone debugging the wrong thing.
    expect(contentToText([{ type: 'image', mimeType: 'image/png' }])).toBe('[image: image/png]')
  })

  it('reads an embedded resource, and names one it cannot read', () => {
    expect(
      contentToText([{ type: 'resource', resource: { uri: 'file:///a.md', text: 'hello' } }])
    ).toBe('hello')
    expect(contentToText([{ type: 'resource', resource: { uri: 'file:///a.png' } }])).toBe(
      '[resource: file:///a.png]'
    )
  })

  it('names a resource link', () => {
    expect(contentToText([{ type: 'resource_link', name: 'notes', uri: 'orrery://note/a' }])).toBe(
      '[resource: notes (orrery://note/a)]'
    )
  })

  it('falls back to structured output when there is no text', () => {
    expect(contentToText([], { ok: true })).toBe('{\n  "ok": true\n}')
  })

  it('does not say everything twice when a server sends both', () => {
    expect(contentToText([{ type: 'text', text: 'done' }], { ok: true })).toBe('done')
  })

  it('survives a server that sends nonsense', () => {
    expect(contentToText(null)).toBe('')
    expect(contentToText([null, 42, { type: 'mystery' }])).toBe('')
  })
})

describe('truncate', () => {
  it('leaves a result that fits alone', () => {
    expect(truncate('short', 100)).toBe('short')
  })

  it('keeps the end, where the error usually is', () => {
    const text = `${'a'.repeat(500)}THE ERROR`
    const cut = truncate(text, 100)
    expect(cut).toContain('THE ERROR')
    expect(cut).toContain('characters omitted')
  })

  it('treats a limit of zero as no limit rather than as nothing', () => {
    expect(truncate('text', 0)).toBe('text')
  })
})

describe('schemaForPromptArguments', () => {
  it("turns a prompt's argument list into a schema a form can draw", () => {
    expect(
      schemaForPromptArguments([
        { name: 'subject', description: 'What to summarise', required: true },
        { name: 'tone' }
      ])
    ).toEqual({
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'What to summarise' },
        tone: { type: 'string' }
      },
      required: ['subject']
    })
  })

  it('has nothing to ask for a prompt that takes nothing', () => {
    expect(schemaForPromptArguments(undefined)).toEqual({ type: 'object', properties: {} })
    expect(schemaForPromptArguments([])).toEqual({ type: 'object', properties: {} })
  })
})

describe('labels', () => {
  it('prefers the human title a server offers', () => {
    expect(toolLabel(tool('create_issue', { annotations: { title: 'Create issue' } }))).toBe(
      'Create issue'
    )
    expect(toolLabel(tool('create_issue'))).toBe('create_issue')
  })

  it('only calls a tool read-only when the server says so', () => {
    expect(isReadOnly(tool('read', { annotations: { readOnlyHint: true } }))).toBe(true)
    // Absent means unknown, and unknown is not a promise.
    expect(isReadOnly(tool('read'))).toBe(false)
  })
})
