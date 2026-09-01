import type { IconName } from '@/components/Icon'
import {
  applyLinePrefix,
  insertCallout,
  insertCodeBlock,
  insertMathBlock,
  insertMermaidBlock,
  insertSnippet,
  insertTableTemplate
} from './format-helpers'

export interface SlashItem {
  label: string
  hint: string
  icon: IconName
  /** Extra words that should find this item, beyond its label. */
  keywords: string[]
  run(): void
}

/** `/` opens the menu only where a command could plausibly start. */
const TRIGGER = /(^|\s)\/([A-Za-z]*)$/

/**
 * Where the slash command starts, and what has been typed since — or null when
 * this slash is just a slash.
 *
 * The exclusions matter more than the match: `and/or`, `https://`, `path/to`
 * and `24/7` all contain one, and a menu that opened on those would be worse
 * than no menu at all.
 */
export function matchSlashQuery(
  lineText: string,
  cursor: number
): { from: number; query: string } | null {
  const before = lineText.slice(0, cursor)
  const match = TRIGGER.exec(before)
  if (!match) return null
  return { from: cursor - match[2]!.length - 1, query: match[2]! }
}

/** Everything the editor can render, reachable without knowing its syntax. */
export function slashItems(): SlashItem[] {
  return [
    {
      label: 'Heading 1',
      hint: '# Large section title',
      icon: 'heading',
      keywords: ['h1', 'title'],
      run: () => applyLinePrefix('# ')
    },
    {
      label: 'Heading 2',
      hint: '## Section title',
      icon: 'heading',
      keywords: ['h2'],
      run: () => applyLinePrefix('## ')
    },
    {
      label: 'Heading 3',
      hint: '### Subsection',
      icon: 'heading',
      keywords: ['h3'],
      run: () => applyLinePrefix('### ')
    },
    {
      label: 'Bulleted list',
      hint: 'A list of points',
      icon: 'list',
      keywords: ['bullet', 'ul', 'unordered'],
      run: () => applyLinePrefix('- ')
    },
    {
      label: 'Numbered list',
      hint: 'A list in order',
      icon: 'list-ordered',
      keywords: ['ordered', 'ol', 'number'],
      run: () => applyLinePrefix('1. ')
    },
    {
      label: 'Task list',
      hint: 'Checkboxes you can tick',
      icon: 'check-square',
      keywords: ['todo', 'checkbox', 'check'],
      run: () => applyLinePrefix('- [ ] ')
    },
    {
      label: 'Table',
      hint: 'Rows and columns',
      icon: 'table',
      keywords: ['grid'],
      run: () => insertTableTemplate()
    },
    {
      label: 'Code block',
      hint: 'Syntax-highlighted code',
      icon: 'code',
      keywords: ['fence', 'snippet'],
      run: () => insertCodeBlock()
    },
    {
      label: 'Quote',
      hint: 'Set text apart',
      icon: 'quote',
      keywords: ['blockquote', 'citation'],
      run: () => applyLinePrefix('> ')
    },
    {
      label: 'Callout — note',
      hint: 'Highlighted aside',
      icon: 'callout',
      keywords: ['admonition', 'info', 'aside'],
      run: () => insertCallout('NOTE')
    },
    {
      label: 'Callout — warning',
      hint: 'Something to watch for',
      icon: 'callout',
      keywords: ['admonition', 'caution'],
      run: () => insertCallout('WARNING')
    },
    {
      label: 'Divider',
      hint: 'A horizontal rule',
      icon: 'minimize',
      keywords: ['hr', 'rule', 'separator', 'line'],
      run: () => insertSnippet('\n---\n')
    },
    {
      label: 'Diagram',
      hint: 'Mermaid flowchart',
      icon: 'diagram',
      keywords: ['mermaid', 'flowchart', 'graph'],
      run: () => insertMermaidBlock()
    },
    {
      label: 'Math block',
      hint: 'A LaTeX formula',
      icon: 'math',
      keywords: ['latex', 'formula', 'equation', 'katex'],
      run: () => insertMathBlock()
    },
    {
      label: 'Link to a note',
      hint: 'A [[wikilink]]',
      icon: 'link',
      keywords: ['wikilink', 'note', 'reference'],
      run: () => insertSnippet('[[]]', 2)
    },
    {
      label: "Today's date",
      hint: 'Insert the date',
      icon: 'clock',
      keywords: ['date', 'now', 'today'],
      run: () => insertSnippet(new Date().toISOString().slice(0, 10))
    }
  ]
}

/** Label first, then keywords — so `/todo` finds the task list. */
export function filterSlashItems(items: SlashItem[], query: string): SlashItem[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return items
  return items.filter(
    (item) =>
      item.label.toLowerCase().includes(needle) ||
      item.keywords.some((word) => word.includes(needle))
  )
}
