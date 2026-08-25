const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Longest tokens first, so `MMMM` is never matched as `MM` + `MM`. */
const TOKENS = /YYYY|YY|MMMM|MMM|MM|M|DDDD|dddd|ddd|DD|D|HH|H|mm|m|ss|s/g

const pad = (value: number): string => String(value).padStart(2, '0')

/**
 * Date formatting with the tokens people already know from Obsidian and moment
 * (`YYYY-MM-DD`, `dddd`, `HH:mm`). Names are hardcoded English rather than
 * locale-derived so a vault's filenames don't change with the machine's locale.
 */
export function formatDate(date: Date, format: string): string {
  return format.replace(TOKENS, (token) => {
    switch (token) {
      case 'YYYY':
        return String(date.getFullYear())
      case 'YY':
        return pad(date.getFullYear() % 100)
      case 'MMMM':
        return MONTHS[date.getMonth()]!
      case 'MMM':
        return MONTHS[date.getMonth()]!.slice(0, 3)
      case 'MM':
        return pad(date.getMonth() + 1)
      case 'M':
        return String(date.getMonth() + 1)
      case 'dddd':
        return WEEKDAYS[date.getDay()]!
      case 'ddd':
        return WEEKDAYS[date.getDay()]!.slice(0, 3)
      case 'DD':
        return pad(date.getDate())
      case 'D':
        return String(date.getDate())
      case 'HH':
        return pad(date.getHours())
      case 'H':
        return String(date.getHours())
      case 'mm':
        return pad(date.getMinutes())
      case 'm':
        return String(date.getMinutes())
      case 'ss':
        return pad(date.getSeconds())
      case 's':
        return String(date.getSeconds())
      default:
        return token
    }
  })
}

export interface TemplateContext {
  /** The instant the template is being rendered at — injected, never read from the clock here. */
  now: Date
  /** Note name, for `{{title}}`. */
  title: string
  /** Format used by a bare `{{date}}`. */
  dateFormat: string
}

export interface RenderedTemplate {
  text: string
  /** Offset of the `{{cursor}}` marker in `text`, or null if there wasn't one. */
  cursor: number | null
}

/** `+1d`, `-2w`, `+3m`, `+1y` — the shift written inside a date placeholder. */
function shift(date: Date, offset: string | undefined): Date {
  if (!offset) return date
  const match = /^([+-])(\d+)([dwmy])$/.exec(offset.trim())
  if (!match) return date
  const sign = match[1] === '-' ? -1 : 1
  const amount = sign * Number(match[2])
  const shifted = new Date(date.getTime())
  switch (match[3]) {
    case 'd':
      shifted.setDate(shifted.getDate() + amount)
      break
    case 'w':
      shifted.setDate(shifted.getDate() + amount * 7)
      break
    case 'm':
      shifted.setMonth(shifted.getMonth() + amount)
      break
    case 'y':
      shifted.setFullYear(shifted.getFullYear() + amount)
      break
  }
  return shifted
}

/** `{{ name [offset] [: format] }}` */
const PLACEHOLDER = /\{\{\s*([a-zA-Z]+)\s*([+-]\s*\d+\s*[dwmy])?\s*(?::\s*([^}]*?)\s*)?\}\}/g

/**
 * Fill a note template. Unknown placeholders are left as written — a template
 * mentioning `{{weather}}` should keep saying so rather than silently emptying,
 * which is how you notice a typo.
 *
 * Pure over an injected `now`, so every date case is testable without mocking
 * the clock. One scan builds the output and records where `{{cursor}}` landed,
 * so the caret offset needs no second pass over the source.
 */
export function renderTemplate(source: string, ctx: TemplateContext): RenderedTemplate {
  let text = ''
  let cursor: number | null = null
  let copied = 0

  for (const match of source.matchAll(PLACEHOLDER)) {
    const at = match.index
    text += source.slice(copied, at)
    copied = at + match[0].length

    const name = match[1]!.toLowerCase()
    const offset = match[2]?.replace(/\s+/g, '')
    const format = match[3]

    if (name === 'cursor') {
      if (cursor === null) cursor = text.length
      continue
    }
    if (name === 'title') text += ctx.title
    else if (name === 'date') text += formatDate(shift(ctx.now, offset), format || ctx.dateFormat)
    else if (name === 'time') text += formatDate(shift(ctx.now, offset), format || 'HH:mm')
    else text += match[0] // not a placeholder we know — leave it visible
  }

  return { text: text + source.slice(copied), cursor }
}
