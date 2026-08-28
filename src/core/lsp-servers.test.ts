import { describe, expect, it } from 'vitest'
import { allServers, languageIdForFile, serverForFile } from './lsp-servers'

describe('serverForFile', () => {
  it('maps a file to the server that speaks its language', () => {
    expect(serverForFile('/vault/a.ts')?.command).toBe('typescript-language-server')
    expect(serverForFile('/vault/a.py')?.command).toBe('pyright-langserver')
    expect(serverForFile('/vault/a.rs')?.command).toBe('rust-analyzer')
  })

  it('serves JavaScript from the TypeScript server, as that server does', () => {
    expect(serverForFile('a.js')?.languageId).toBe('typescript')
    expect(serverForFile('a.mjs')?.languageId).toBe('typescript')
  })

  it('is case-insensitive about the extension', () => {
    expect(serverForFile('A.TS')?.languageId).toBe('typescript')
  })

  it('returns nothing for a language with no server, and for prose', () => {
    expect(serverForFile('notes.md')).toBeNull()
    expect(serverForFile('a.txt')).toBeNull()
    expect(serverForFile('Makefile')).toBeNull()
  })
})

describe('languageIdForFile', () => {
  it('reports the protocol languageId', () => {
    expect(languageIdForFile('a.tsx')).toBe('typescript')
    expect(languageIdForFile('a.json')).toBe('json')
    expect(languageIdForFile('a.md')).toBeNull()
  })
})

describe('allServers', () => {
  it('gives every server an install command, so a missing one can say so', () => {
    // The whole point of not bundling: a language with nothing installed has to
    // be able to tell the user what to install rather than sit dead.
    for (const server of allServers()) {
      expect(server.install.length, server.label).toBeGreaterThan(0)
      expect(server.command.length, server.label).toBeGreaterThan(0)
    }
  })

  it('has no duplicate languageIds', () => {
    const ids = allServers().map((s) => s.languageId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
