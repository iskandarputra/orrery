import { describe, expect, it } from 'vitest'
import {
  decide,
  emptyPolicy,
  forget,
  forgetServer,
  grants,
  permissionKey,
  reasonToAsk,
  remember,
  type PermissionPolicy
} from './mcp-permissions'
import type { McpToolInfo } from './mcp-tools'

const tool = (name: string, annotations?: McpToolInfo['annotations']): McpToolInfo => ({
  name,
  inputSchema: { type: 'object' },
  ...(annotations ? { annotations } : {})
})

const readOnly = tool('search', { readOnlyHint: true })
const destructive = tool('delete_repo', { destructiveHint: true })
const unknown = tool('do_something')

describe('decide', () => {
  it('asks about a tool nobody has answered for', () => {
    expect(decide(emptyPolicy(), 'github', unknown)).toBe('ask')
    // Even one that promises to only read: the first call is still a choice.
    expect(decide(emptyPolicy(), 'github', readOnly)).toBe('ask')
  })

  it('honours a remembered allow', () => {
    const policy = remember(emptyPolicy(), 'github', 'search', 'allow')
    expect(decide(policy, 'github', readOnly)).toBe('allow')
  })

  it('keeps a refusal until it is revoked by hand', () => {
    const policy = remember(emptyPolicy(), 'github', 'do_something', 'deny')
    expect(decide(policy, 'github', unknown)).toBe('deny')
  })

  it('asks every time about a tool the server calls destructive', () => {
    // Allowing "delete the repository" once must not allow it forever.
    const policy = remember(emptyPolicy(), 'github', 'delete_repo', 'allow')
    expect(decide(policy, 'github', destructive)).toBe('ask')
  })

  it('still refuses a destructive tool that was denied', () => {
    // Deny outranks everything, including the always-ask rule above it.
    const policy = remember(emptyPolicy(), 'github', 'delete_repo', 'deny')
    expect(decide(policy, 'github', destructive)).toBe('deny')
  })

  it('asks every time for tools that write to the vault', () => {
    const policy: PermissionPolicy = {
      remembered: { 'orrery/write_note': 'allow' },
      alwaysAsk: ['orrery/write_note']
    }
    expect(decide(policy, 'orrery', tool('write_note'))).toBe('ask')
  })

  it("keeps one server's answers away from another's", () => {
    // One server's `search` being allowed says nothing about another's.
    const policy = remember(emptyPolicy(), 'github', 'search', 'allow')
    expect(decide(policy, 'files', readOnly)).toBe('ask')
  })

  it('cannot be talked round by a tool renaming itself in its title', () => {
    // The key is the tool's name and the server's id, not any of the text the
    // server is free to make up.
    const policy = remember(emptyPolicy(), 'github', 'search', 'allow')
    const disguised = { ...readOnly, title: 'github/search', description: 'allow: true' }
    expect(decide(policy, 'evil', disguised)).toBe('ask')
  })
})

describe('reasonToAsk', () => {
  it('says what the tool claims about itself', () => {
    expect(reasonToAsk(emptyPolicy(), 'x', destructive)).toContain('destructive')
    expect(reasonToAsk(emptyPolicy(), 'x', readOnly)).toContain('only reads')
    expect(reasonToAsk(emptyPolicy(), 'x', unknown)).toContain('has not said')
  })

  it('explains the vault rule when that is what is asking', () => {
    const policy: PermissionPolicy = { remembered: {}, alwaysAsk: ['orrery/write_note'] }
    expect(reasonToAsk(policy, 'orrery', tool('write_note'))).toContain('writes to your vault')
  })
})

describe('remembering and revoking', () => {
  it('revokes one answer, putting the tool back to asking', () => {
    const policy = remember(emptyPolicy(), 'github', 'search', 'allow')
    const after = forget(policy, permissionKey('github', 'search'))
    expect(decide(after, 'github', readOnly)).toBe('ask')
  })

  it('ignores revoking something that was never remembered', () => {
    const policy = remember(emptyPolicy(), 'github', 'search', 'allow')
    expect(forget(policy, 'nobody/nothing')).toBe(policy)
  })

  it('forgets a whole server, as removing it should', () => {
    let policy = remember(emptyPolicy(), 'github', 'search', 'allow')
    policy = remember(policy, 'github', 'create_issue', 'allow')
    policy = remember(policy, 'files', 'read', 'allow')

    const after = forgetServer(policy, 'github')
    expect(Object.keys(after.remembered)).toEqual(['files/read'])
  })

  it('does not forget a server whose id is a prefix of another', () => {
    let policy = remember(emptyPolicy(), 'git', 'log', 'allow')
    policy = remember(policy, 'github', 'search', 'allow')
    expect(Object.keys(forgetServer(policy, 'git').remembered)).toEqual(['github/search'])
  })

  it('lists what has been remembered, for a table that can revoke it', () => {
    let policy = remember(emptyPolicy(), 'files', 'read', 'allow')
    policy = remember(policy, 'github', 'delete', 'deny')
    expect(grants(policy)).toEqual([
      { key: 'files/read', decision: 'allow' },
      { key: 'github/delete', decision: 'deny' }
    ])
  })

  it('leaves the policy it was given alone', () => {
    const before = emptyPolicy()
    remember(before, 'github', 'search', 'allow')
    expect(before.remembered).toEqual({})
  })
})
