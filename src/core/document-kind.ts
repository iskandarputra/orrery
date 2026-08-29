import { isMarkdownFile } from './paths'

/**
 * Which editor surface a buffer belongs in.
 *
 * `diff` never comes from a file name — it is opened directly by the source
 * control panel — so `documentKind` below never returns it.
 */
export type BuiltinDocumentKind = 'markdown' | 'canvas' | 'code' | 'diff'

/**
 * A plugin may claim a file for a surface of its own, and its id becomes the
 * kind. The union keeps the built-ins suggested by autocomplete while leaving
 * the set open — a closed union would mean no plugin could ever add to it.
 */
export type DocumentKind = BuiltinDocumentKind | (string & {})

/**
 * `.canvas` files are JSON boards, markdown extensions are notes, and
 * everything else is code or plain text.
 *
 * Built-in classification only: a plugin-registered surface claims its files
 * before this is consulted (see the renderer's surface registry).
 *
 * The third case is not a nicety. Parsing a source file as markdown silently
 * rewrites what you see: `[1, 2, 3]` in a JSON file renders as `1, 2, 3`
 * because the brackets are read as link syntax, `*args*` in a comment loses
 * its asterisks to emphasis, and Reading mode reflows hard-wrapped lines into
 * one. The file on disk is untouched, but nothing on screen can be trusted.
 */
export function documentKind(fileName: string): BuiltinDocumentKind {
  if (/\.canvas$/i.test(fileName)) return 'canvas'
  return isMarkdownFile(fileName) ? 'markdown' : 'code'
}
