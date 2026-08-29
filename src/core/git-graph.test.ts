import { describe, expect, it } from 'vitest'
import { graphWidth, layoutGraph, parseGitLog, type Commit } from './git-graph'

/** The field separator the log command asks git for. */
const F = '\u001f'
const entry = (...fields: string[]): string => fields.join(F)
const z = (...entries: string[]): string => entries.join('\0') + '\0'

const commit = (hash: string, parents: string[] = []): Commit => ({
  hash,
  parents,
  author: 'A',
  date: 'now',
  refs: [],
  subject: hash,
  body: ''
})

describe('parseGitLog', () => {
  it('reads every field of a commit', () => {
    const [c] = parseGitLog(
      z(
        entry(
          'abc',
          'def',
          'Ada',
          '3 days ago',
          'HEAD -> main, origin/main',
          'a subject',
          'the body\n'
        )
      )
    )
    expect(c).toEqual({
      hash: 'abc',
      parents: ['def'],
      author: 'Ada',
      date: '3 days ago',
      refs: ['HEAD -> main', 'origin/main'],
      subject: 'a subject',
      body: 'the body'
    })
  })

  it('reads a merge with two parents', () => {
    const [c] = parseGitLog(z(entry('m', 'p1 p2', 'A', 'now', '', 'merge')))
    expect(c!.parents).toEqual(['p1', 'p2'])
  })

  it('reads a root commit as having no parents', () => {
    expect(parseGitLog(z(entry('root', '', 'A', 'now', '', 'first')))[0]!.parents).toEqual([])
  })

  it('keeps a subject containing commas', () => {
    const [c] = parseGitLog(z(entry('h', '', 'A', 'now', '', 'fix: a, b and more')))
    expect(c!.subject).toBe('fix: a, b and more')
  })

  it('returns nothing for empty output', () => {
    expect(parseGitLog('')).toEqual([])
  })
})

describe('layoutGraph: a straight history', () => {
  it('keeps every commit in one lane', () => {
    const rows = layoutGraph([commit('c', ['b']), commit('b', ['a']), commit('a')])
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0])
    expect(graphWidth(rows)).toBe(1)
  })

  it('leaves no lane waiting after the root commit', () => {
    const rows = layoutGraph([commit('b', ['a']), commit('a')])
    expect(rows[1]!.lanes).toEqual([])
  })
})

describe('layoutGraph: branches', () => {
  const twoTips = (): Commit[] => [
    commit('tipA', ['base']),
    commit('tipB', ['base']),
    commit('base')
  ]

  it('gives a second branch tip its own lane', () => {
    const rows = layoutGraph(twoTips())
    expect(rows[0]!.lane).toBe(0)
    expect(rows[1]!.lane).toBe(1)
    expect(graphWidth(rows)).toBe(2)
  })

  it('converges on one lane where the branches meet', () => {
    const rows = layoutGraph(twoTips())
    // Both tips name the same parent, so only one lane may wait for it —
    // otherwise the graph draws two lines into a single commit.
    expect(rows[1]!.lanes.filter((l) => l === 'base')).toHaveLength(1)
    expect(rows[2]!.lane).toBe(0)
  })

  it('reuses a lane once the branch that held it has ended', () => {
    const rows = layoutGraph([...twoTips(), commit('unrelated')])
    expect(rows[3]!.lane).toBe(0)
  })
})

describe('layoutGraph: merges', () => {
  const history = (): Commit[] => [
    commit('merge', ['main1', 'side1']),
    commit('main1', ['base']),
    commit('side1', ['base']),
    commit('base')
  ]

  it('keeps the first parent in the merge commit own lane', () => {
    const rows = layoutGraph(history())
    expect(rows[0]!.lane).toBe(0)
    expect(rows[0]!.parentLanes[0]).toBe(0)
  })

  it('sends the second parent into a lane of its own', () => {
    const rows = layoutGraph(history())
    expect(rows[0]!.parentLanes[1]).toBe(1)
    expect(rows[2]!.lane).toBe(1)
  })

  it('brings both sides back together at the shared base', () => {
    const rows = layoutGraph(history())
    expect(rows[3]!.lane).toBe(0)
    expect(graphWidth(rows)).toBe(2)
  })
})

describe('layoutGraph: robustness', () => {
  it('handles an empty history', () => {
    expect(layoutGraph([])).toEqual([])
    expect(graphWidth([])).toBe(1)
  })

  it('tolerates a parent that is not in the log', () => {
    // The log is truncated with -n, so its oldest commits name parents that
    // were never read. That must not throw or widen the graph forever.
    const rows = layoutGraph([commit('only', ['missing'])])
    expect(rows[0]!.lane).toBe(0)
    expect(rows[0]!.lanes).toEqual(['missing'])
  })

  it('never reports a lane outside the graph width', () => {
    const rows = layoutGraph([
      commit('m', ['a', 'b', 'c']),
      commit('a', ['z']),
      commit('b', ['z']),
      commit('c', ['z']),
      commit('z')
    ])
    const width = graphWidth(rows)
    for (const row of rows) {
      expect(row.lane).toBeLessThan(width)
      for (const lane of row.parentLanes) expect(lane).toBeLessThan(width)
    }
  })

  it('places an octopus merge parents in distinct lanes', () => {
    const rows = layoutGraph([commit('m', ['a', 'b', 'c']), commit('a'), commit('b'), commit('c')])
    expect(new Set(rows[0]!.parentLanes).size).toBe(3)
  })
})

describe('the message body', () => {
  it('keeps a body that runs to several lines', () => {
    // `%b` is last in the format precisely because it is the only field that
    // can contain a newline.
    const [c] = parseGitLog(z(entry('h', '', 'A', 'now', '', 'subject', 'line one\nline two\n')))
    expect(c!.body).toBe('line one\nline two')
  })

  it('is empty for a commit with only a subject', () => {
    expect(parseGitLog(z(entry('h', '', 'A', 'now', '', 'subject', '')))[0]!.body).toBe('')
  })

  it('is empty when the field is absent entirely', () => {
    // Older output, or a truncated record: a missing body is not a crash.
    expect(parseGitLog(z(entry('h', '', 'A', 'now', '', 'subject')))[0]!.body).toBe('')
  })
})
