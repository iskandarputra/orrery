import { describe, expect, it } from 'vitest'
import {
  noteUri,
  offeredTools,
  pathFromUri,
  resolveInVault,
  VAULT_TOOLS,
  vaultRelative,
  writeTools
} from './vault-tools'

describe('the tool list', () => {
  it('describes every tool well enough for a model to choose one', () => {
    for (const tool of VAULT_TOOLS) {
      expect(tool.description.length, tool.name).toBeGreaterThan(20)
      expect(tool.inputSchema['type'], tool.name).toBe('object')
    }
  })

  it('names the ones that write, since those are the ones that ask', () => {
    expect(writeTools().map((t) => t.name)).toEqual(['create_note', 'append_note'])
  })

  it('offers no writing tools at all when writing is off', () => {
    // Not "offers them and refuses": a tool that is never going to run should
    // not be in the list an agent is planning against.
    const offered = offeredTools(false).map((t) => t.name)
    expect(offered).not.toContain('create_note')
    expect(offered).toContain('read_note')
  })

  it('offers them when writing is allowed', () => {
    expect(offeredTools(true).map((t) => t.name)).toContain('create_note')
  })

  it('leaves out whatever the user switched off', () => {
    expect(offeredTools(true, ['git_log', 'append_note']).map((t) => t.name)).not.toContain(
      'git_log'
    )
  })
})

describe('resolveInVault', () => {
  const root = '/home/ada/vault'

  it('resolves an ordinary vault-relative path', () => {
    expect(resolveInVault(root, 'Projects/Orrery.md')).toBe('/home/ada/vault/Projects/Orrery.md')
    expect(resolveInVault(root, './Notes/A.md')).toBe('/home/ada/vault/Notes/A.md')
  })

  it('tidies a path that walks up and back down inside the vault', () => {
    expect(resolveInVault(root, 'Projects/../Notes/A.md')).toBe('/home/ada/vault/Notes/A.md')
  })

  it('refuses a path that climbs out', () => {
    // The check is on the resolved path: this one contains no leading `..` and
    // is still somebody's private key.
    expect(resolveInVault(root, 'notes/../../.ssh/id_rsa')).toBeNull()
    expect(resolveInVault(root, '../secrets.md')).toBeNull()
    expect(resolveInVault(root, '../../../../etc/passwd')).toBeNull()
  })

  it('refuses an absolute path', () => {
    expect(resolveInVault(root, '/etc/passwd')).toBeNull()
    expect(resolveInVault(root, 'C:/Windows/System32')).toBeNull()
  })

  it('refuses a path with a null byte, which truncates in a syscall', () => {
    expect(resolveInVault(root, 'note.md\u0000.png')).toBeNull()
  })

  it('refuses the vault directory itself and an empty path', () => {
    expect(resolveInVault(root, '')).toBeNull()
    expect(resolveInVault(root, '.')).toBeNull()
    expect(resolveInVault(root, '   ')).toBeNull()
  })

  it('refuses everything when there is no vault open', () => {
    expect(resolveInVault('', 'a.md')).toBeNull()
  })

  it('is not fooled by a vault path with a trailing slash', () => {
    expect(resolveInVault('/home/ada/vault/', 'A.md')).toBe('/home/ada/vault/A.md')
  })

  it('does not accept a sibling directory that starts with the vault name', () => {
    // `/home/ada/vault-backup` starts with `/home/ada/vault` as text.
    expect(resolveInVault(root, '../vault-backup/A.md')).toBeNull()
  })
})

describe('paths in and out', () => {
  it('reports a path relative to the vault', () => {
    expect(vaultRelative('/home/ada/vault', '/home/ada/vault/Notes/A.md')).toBe('Notes/A.md')
  })

  it('leaves a path that is not in the vault alone rather than mangling it', () => {
    expect(vaultRelative('/home/ada/vault', '/tmp/other.md')).toBe('/tmp/other.md')
  })

  it('round-trips a note uri, spaces and all', () => {
    const uri = noteUri('Daily notes/2026-08-30.md')
    expect(uri).toBe('orrery://note/Daily%20notes/2026-08-30.md')
    expect(pathFromUri(uri)).toBe('Daily notes/2026-08-30.md')
  })

  it('refuses a uri that is not ours', () => {
    expect(pathFromUri('file:///etc/passwd')).toBeNull()
    expect(pathFromUri('orrery://something-else')).toBeNull()
  })

  it('survives a uri with broken encoding in it', () => {
    expect(pathFromUri('orrery://note/%E0%A4%A')).toBeNull()
  })
})
