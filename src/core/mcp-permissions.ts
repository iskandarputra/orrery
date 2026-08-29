/**
 * Whether a tool may run.
 *
 * This is the only thing standing between a sentence in a note and a program on
 * your machine. A model reads text it did not write — a tool result, a fetched
 * page, a note someone else wrote — and that text can ask it to call a tool. The
 * gate has to be a decision made here, over data, and not an inference made by
 * the model, which is why this module is pure and why it is the one with the
 * most tests.
 *
 * The rules, in order:
 *
 *  1. A refusal sticks. Denying a tool means denying it until it is revoked by
 *     hand, not until the next time it is asked for.
 *  2. A tool the server marks destructive always asks, however many times it has
 *     been allowed before. "Delete the repository" is not a habit.
 *  3. Otherwise a remembered allow is honoured.
 *  4. Otherwise ask.
 *
 * Nothing here can be reached from the model's side: there is no argument, no
 * result and no prompt that changes what `decide` returns, only what the user
 * has said and what the server declared about its own tool.
 */

import type { McpToolInfo } from './mcp-tools'

export type Decision = 'allow' | 'ask' | 'deny'
/** What a user can choose to remember. `ask` is the absence of a memory. */
export type Remembered = 'allow' | 'deny'

export interface PermissionPolicy {
  /** Remembered answers, keyed by `permissionKey`. */
  remembered: Record<string, Remembered>
  /**
   * Tools that always ask however they are answered, by key. Orrery's own
   * server puts its writing tools here, so no agent can be given standing
   * permission to rewrite notes.
   */
  alwaysAsk: string[]
}

export const emptyPolicy = (): PermissionPolicy => ({ remembered: {}, alwaysAsk: [] })

/** One tool of one server. Servers are keyed by id, so renaming one is safe. */
export function permissionKey(serverId: string, toolName: string): string {
  return `${serverId}/${toolName}`
}

export function decide(policy: PermissionPolicy, serverId: string, tool: McpToolInfo): Decision {
  const key = permissionKey(serverId, tool.name)
  const remembered = policy.remembered[key]

  if (remembered === 'deny') return 'deny'
  if (tool.annotations?.destructiveHint === true) return 'ask'
  if (policy.alwaysAsk.includes(key)) return 'ask'
  if (remembered === 'allow') return 'allow'
  return 'ask'
}

/**
 * Why the user is being asked, in a sentence the dialog can show.
 *
 * A prompt that says only "allow this tool?" teaches people to click allow. One
 * that says what the tool claims about itself gives them something to weigh.
 */
export function reasonToAsk(policy: PermissionPolicy, serverId: string, tool: McpToolInfo): string {
  const key = permissionKey(serverId, tool.name)
  if (tool.annotations?.destructiveHint === true) {
    return 'This tool says it makes destructive changes, so it asks every time.'
  }
  if (policy.alwaysAsk.includes(key))
    return 'This tool writes to your vault, so it asks every time.'
  if (tool.annotations?.readOnlyHint === true) return 'This tool says it only reads.'
  return 'This tool has not said whether it changes anything.'
}

export function remember(
  policy: PermissionPolicy,
  serverId: string,
  toolName: string,
  decision: Remembered
): PermissionPolicy {
  return {
    ...policy,
    remembered: { ...policy.remembered, [permissionKey(serverId, toolName)]: decision }
  }
}

/** Revoke one remembered answer, putting the tool back to asking. */
export function forget(policy: PermissionPolicy, key: string): PermissionPolicy {
  if (!(key in policy.remembered)) return policy
  const remembered = { ...policy.remembered }
  delete remembered[key]
  return { ...policy, remembered }
}

/** Revoke everything remembered about one server, as removing it should. */
export function forgetServer(policy: PermissionPolicy, serverId: string): PermissionPolicy {
  const prefix = `${serverId}/`
  const remembered = Object.fromEntries(
    Object.entries(policy.remembered).filter(([key]) => !key.startsWith(prefix))
  )
  return { ...policy, remembered }
}

/** The remembered answers, for a settings table that can revoke them. */
export function grants(policy: PermissionPolicy): { key: string; decision: Remembered }[] {
  return Object.entries(policy.remembered)
    .map(([key, decision]) => ({ key, decision }))
    .sort((a, b) => a.key.localeCompare(b.key))
}
