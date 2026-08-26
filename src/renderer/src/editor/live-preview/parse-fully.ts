import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

type SyntaxTree = NonNullable<ReturnType<typeof ensureSyntaxTree>>

/**
 * Parse a document completely before anything reads its tree.
 *
 * `ensureSyntaxTree` parses within a time budget and returns null when it runs
 * out. Discarding that null is how a decoration test comes to assert against an
 * unparsed document: every feature walks an empty tree, emits no decorations,
 * and the failure reads as the feature being broken rather than as the parse
 * never having finished. Under parallel test load that happened often enough to
 * look like a flake.
 *
 * Retrying is what makes it deterministic — each call resumes where the last
 * one stopped — and the throw turns a silent wrong answer into a clear one.
 */
export function parseFully(state: EditorState): SyntaxTree {
  for (let attempt = 0; attempt < 20; attempt++) {
    const tree = ensureSyntaxTree(state, state.doc.length, 5000)
    if (tree && tree.length >= state.doc.length) return tree
  }
  throw new Error(`syntax tree did not cover the document (${state.doc.length} chars)`)
}
