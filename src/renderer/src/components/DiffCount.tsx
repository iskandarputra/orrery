import type { DiffStat } from '@core/git-numstat'

/**
 * How much a file changed, beside its name.
 *
 * The status letter says a file was modified. It does not say whether that was
 * a typo or a rewrite, and that is the question being asked of a list of thirty
 * changed files: which two are worth opening. So the counts go on the row,
 * where they can be scanned down a column, rather than being something you find
 * out by opening each diff in turn.
 *
 * Shared by the working-tree lists and by a commit's files in the graph, which
 * ask the same question of the same numbers.
 */
export function DiffCount({ stat }: { stat?: DiffStat }): React.JSX.Element | null {
  // No counts yet, or none to be had: a row without a number, never a zero that
  // would read as "nothing changed".
  if (!stat) return null

  if (stat.binary) {
    return (
      <span className="scm-count scm-count--binary" title="Binary — its change is not in lines">
        bin
      </span>
    )
  }

  // A change with no lines in it is real — a permission bit, a rename that
  // moved nothing — and "+0 -0" is a worse way of saying so than silence.
  if (stat.insertions === 0 && stat.deletions === 0) return null

  return (
    <span
      className="scm-count"
      title={`${stat.insertions} line${stat.insertions === 1 ? '' : 's'} added, ${stat.deletions} removed`}
    >
      {stat.insertions > 0 && <span className="scm-count__add">+{stat.insertions}</span>}
      {stat.deletions > 0 && <span className="scm-count__del">-{stat.deletions}</span>}
    </span>
  )
}
