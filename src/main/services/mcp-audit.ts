import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import type { McpAuditEntry } from '@shared/types'

/**
 * A record of every tool that ran.
 *
 * Permission dialogs are answered quickly and forgotten immediately. The log is
 * what makes "allow always" reversible in practice: it is the only way to find
 * out, afterwards, what a server actually did with the permission it was given.
 * So it records the arguments too, and it is written even for calls that were
 * denied — a server repeatedly asking for something it has been refused is
 * exactly what someone would want to see.
 *
 * JSON lines, one file per day, appended and never rewritten. Appended with
 * `appendFile` rather than through a held-open stream: a tool call must not be
 * able to hang on the log, and a stream that fails to open leaves a write
 * callback that never fires. Reading takes the newest files rather than the
 * whole history, because a log that has to be fully parsed to show ten lines is
 * a log that gets deleted.
 */

/** Re-exported so callers name the log's own type. */
export type AuditEntry = McpAuditEntry

/** Longer than this and a single entry is a log file, not a log line. */
const SUMMARY_MAX = 300
/** Enough days back to fill any panel; a log is not an archive. */
const FILES_READ = 3

export class McpAudit {
  constructor(private readonly dir: string) {}

  /** Append one entry. Never throws: a log that breaks a tool call is worse than no log. */
  async write(entry: AuditEntry): Promise<void> {
    try {
      await fsp.mkdir(this.dir, { recursive: true })
      const day = new Date(entry.at).toISOString().slice(0, 10)
      const line = JSON.stringify({ ...entry, summary: entry.summary.slice(0, SUMMARY_MAX) })
      await fsp.appendFile(join(this.dir, `${day}.jsonl`), `${line}\n`, 'utf-8')
    } catch {
      // Logging is best effort.
    }
  }

  /**
   * The most recent entries, newest first.
   *
   * The newest files by name, not the last few dates by arithmetic: a log
   * written at 23:59 is still what you want to see at 00:05, and a machine that
   * was off for a week should still show the last thing that happened.
   */
  async recent(limit: number): Promise<AuditEntry[]> {
    let files: string[]
    try {
      files = (await fsp.readdir(this.dir))
        .filter((name) => name.endsWith('.jsonl'))
        .sort()
        .reverse()
        .slice(0, FILES_READ)
    } catch {
      return []
    }

    // Read order is the tiebreaker, so two calls inside the same millisecond
    // still come back in the order they happened. Without it "newest first"
    // silently becomes "oldest first" for a burst, which is exactly when the
    // log is being read.
    const entries: { entry: AuditEntry; order: number }[] = []
    for (const file of files) {
      let raw: string
      try {
        raw = await fsp.readFile(join(this.dir, file), 'utf-8')
      } catch {
        continue
      }
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        try {
          entries.push({ entry: JSON.parse(line) as AuditEntry, order: entries.length })
        } catch {
          // A half-written last line from a crash; the rest is still good.
        }
      }
      if (entries.length >= limit) break
    }
    return entries
      .sort((a, b) => b.entry.at - a.entry.at || b.order - a.order)
      .slice(0, limit)
      .map((row) => row.entry)
  }
}
