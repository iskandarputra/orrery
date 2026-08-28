import { isMarkdownFile } from './paths'

/** Which editor surface a buffer belongs in. */
export type DocumentKind = 'markdown' | 'canvas' | 'code'

/**
 * `.canvas` files are JSON boards, markdown extensions are notes, and
 * everything else is code or plain text.
 *
 * The third case is not a nicety. Parsing a source file as markdown silently
 * rewrites what you see: `[1, 2, 3]` in a JSON file renders as `1, 2, 3`
 * because the brackets are read as link syntax, `*args*` in a comment loses
 * its asterisks to emphasis, and Reading mode reflows hard-wrapped lines into
 * one. The file on disk is untouched, but nothing on screen can be trusted.
 */
export function documentKind(fileName: string): DocumentKind {
  if (/\.canvas$/i.test(fileName)) return 'canvas'
  return isMarkdownFile(fileName) ? 'markdown' : 'code'
}
