import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { appState } from '@/state/app-state-access'

/** Tags already used in the vault, most used first. */
function knownTags(): { tag: string; notes: number }[] {
  const counts = new Map<string, number>()
  for (const node of appState().graph?.nodes ?? []) {
    for (const tag of node.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([tag, notes]) => ({ tag, notes }))
    .sort((a, b) => b.notes - a.notes || a.tag.localeCompare(b.tag))
}

/**
 * `#` offers the tags the vault already uses. Reusing an existing tag is the
 * whole point of tagging — a typo makes a second, near-identical tag that
 * quietly splits the notes it should have gathered.
 */
export function tagCompletionSource(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/(^|\s)#[A-Za-z0-9_/-]*$/)
  if (!match) return null
  const hash = context.state.doc.sliceString(match.from, match.to).indexOf('#') + match.from
  const tags = knownTags()
  if (tags.length === 0) return null
  return {
    from: hash + 1,
    options: tags.map((entry) => ({
      label: entry.tag,
      type: 'keyword',
      detail: `${entry.notes} note${entry.notes === 1 ? '' : 's'}`
    })),
    validFor: /^[A-Za-z0-9_/-]*$/
  }
}
