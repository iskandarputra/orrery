/** `:name:` → glyph. A working set of the ones people actually reach for. */
const EMOJI: Record<string, string> = {
  smile: '😄', grin: '😁', joy: '😂', wink: '😉', thinking: '🤔', neutral: '😐',
  cry: '😢', sob: '😭', angry: '😠', scream: '😱', sleeping: '😴', sunglasses: '😎',
  heart: '❤️', broken_heart: '💔', star: '⭐', sparkles: '✨', fire: '🔥', zap: '⚡',
  boom: '💥', tada: '🎉', rocket: '🚀', bulb: '💡', warning: '⚠️', bell: '🔔',
  check: '✅', x: '❌', question: '❓', exclamation: '❗', white_check_mark: '✅',
  heavy_check_mark: '✔️', pushpin: '📌', paperclip: '📎', memo: '📝', book: '📖',
  books: '📚', calendar: '📅', clock: '🕐', hourglass: '⏳', mag: '🔍', lock: '🔒',
  unlock: '🔓', key: '🔑', link: '🔗', gear: '⚙️', wrench: '🔧', hammer: '🔨',
  bug: '🐛', package: '📦', inbox: '📥', outbox: '📤', chart: '📈', bar_chart: '📊',
  clipboard: '📋', folder: '📁', file: '📄', trash: '🗑️', computer: '💻',
  keyboard: '⌨️', phone: '📱', camera: '📷', headphones: '🎧', coffee: '☕',
  tea: '🍵', pizza: '🍕', cake: '🍰', apple: '🍎', beer: '🍺',
  thumbsup: '👍', thumbsdown: '👎', ok_hand: '👌', clap: '👏', wave: '👋',
  pray: '🙏', muscle: '💪', point_right: '👉', eyes: '👀', brain: '🧠',
  sun: '☀️', moon: '🌙', cloud: '☁️', rain: '🌧️', snow: '❄️', rainbow: '🌈',
  earth: '🌍', seedling: '🌱', tree: '🌳', flower: '🌸', leaves: '🍃',
  dog: '🐶', cat: '🐱', bird: '🐦', fish: '🐟', bee: '🐝', snail: '🐌',
  green_circle: '🟢', yellow_circle: '🟡', red_circle: '🔴', blue_circle: '🔵',
  arrow_right: '➡️', arrow_left: '⬅️', arrow_up: '⬆️', arrow_down: '⬇️',
  recycle: '♻️', infinity: '♾️', hourglass_flowing: '⏳', stopwatch: '⏱️',
  construction: '🚧', no_entry: '⛔', shield: '🛡️', label: '🏷️', flag: '🚩',
  trophy: '🏆', medal: '🏅', dart: '🎯', game: '🎮', dice: '🎲', art: '🎨',
  music: '🎵', bell_slash: '🔕', loud: '📢', speech: '💬', thought: '💭'
}

export interface EmojiMatch {
  name: string
  glyph: string
}

/** `:` starts a shortcode only at a word boundary — not inside `a:b` or a URL. */
const TRIGGER = /(^|\s):([a-z_]*)$/

export function matchEmojiQuery(
  lineText: string,
  cursor: number
): { from: number; query: string } | null {
  const match = TRIGGER.exec(lineText.slice(0, cursor))
  if (!match) return null
  return { from: cursor - match[2]!.length - 1, query: match[2]! }
}

/** Shortcodes containing the query, prefix matches first. */
export function findEmoji(query: string, limit = 24): EmojiMatch[] {
  const needle = query.trim().toLowerCase()
  const all = Object.entries(EMOJI).map(([name, glyph]) => ({ name, glyph }))
  if (!needle) return all.slice(0, limit)
  const starts = all.filter((e) => e.name.startsWith(needle))
  const contains = all.filter((e) => !e.name.startsWith(needle) && e.name.includes(needle))
  return [...starts, ...contains].slice(0, limit)
}
