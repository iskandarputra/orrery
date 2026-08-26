/** Characters that are unsafe in a file name on some platform or other. */
const UNSAFE = /[\\/:*?"<>|]/g

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * The name a pasted or dropped image is filed under.
 *
 * A dropped file keeps its own name — it means something to whoever saved it.
 * Clipboard images arrive called `image.png` or nothing at all, so they are
 * named after the moment they were pasted, which at least sorts usefully.
 */
export function assetFileName(sourceName: string, now: number): string {
  const cleaned = sourceName.replace(UNSAFE, '-').trim()
  const anonymous = !cleaned || /^image\.[a-z0-9]+$/i.test(cleaned)
  if (!anonymous) return cleaned

  const extension = cleaned.includes('.') ? cleaned.slice(cleaned.lastIndexOf('.')) : '.png'
  const at = new Date(now)
  const stamp =
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ` +
    `${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`
  return `Pasted image ${stamp}${extension}`
}

/** The markdown that embeds an asset, written relative to the vault. */
export function assetMarkdown(assetPath: string, rootPath: string): string {
  const relative =
    rootPath && assetPath.startsWith(rootPath)
      ? assetPath.slice(rootPath.length).replace(/^[/\\]/, '')
      : assetPath
  // Spaces would end the link target early in most markdown renderers.
  return `![](${relative.replace(/ /g, '%20')})`
}
