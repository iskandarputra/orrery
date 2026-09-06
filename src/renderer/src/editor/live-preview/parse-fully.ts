import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

type SyntaxTree = NonNullable<ReturnType<typeof ensureSyntaxTree>>

/**
 * Parse a document completely before anything reads its tree.
 *
 * `ensureSyntaxTree` parses within a time budget and returns null when it runs
 * out. Discarding that null is how a decoration test comes to assert against an
 * unparsed document: every feature walks an empty tree, emits no decorations,
 * and the failure reads as the feature being broken rather than as the parse
 * never having finished. Retrying is what makes it deterministic, since each
 * call resumes where the last one stopped.
 *
 * **What it checks, and why that is not the obvious thing.** The tree handed
 * back by `ensureSyntaxTree` is not the tree the state will give out: a state
 * whose parse stopped early keeps that partial tree, and `syntaxTree(state)`
 * goes on returning it. Decorations are built from `syntaxTree(state)`, so
 * checking the returned tree proves nothing about what a feature will see.
 * Measured on a 130,971-character document: this returned a complete tree while
 * `syntaxTree(state)` stayed at 3,005 characters, and every caller was told the
 * document was parsed.
 *
 * So the state is what is checked, and the throw is the point of the whole
 * helper: it turns a silent wrong answer into a clear one.
 *
 * It cannot help with a parse that is cut short *inside* `EditorState.create`,
 * before any of this runs. A `StateField` computes its value there, and nothing
 * recomputes it until a transaction arrives — so a test that mounts a view and
 * asserts without dispatching anything is asserting against whatever that first
 * parse managed. For a small document it always finishes; the budget is
 * wall-clock, so a machine under enough load is the case to suspect when one of
 * these fails only in a parallel run.
 */
export function parseFully(state: EditorState): SyntaxTree {
  for (let attempt = 0; attempt < 20; attempt++) {
    ensureSyntaxTree(state, state.doc.length, 5000)
    const tree = syntaxTree(state)
    if (tree.length >= state.doc.length) return tree
  }
  throw new Error(
    `syntax tree covers ${syntaxTree(state).length} of ${state.doc.length} characters. ` +
      'The state kept a partial parse, so anything reading it will see an unparsed document.'
  )
}
