/**
 * Subsequence fuzzy matcher: query chars must appear in order. Score rewards
 * consecutive runs and word starts, penalizes gaps. Null = no match.
 */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (!q) return 0
  let qi = 0
  let score = 0
  let streak = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      streak++
      const wordStart = ti === 0 || t[ti - 1] === ' ' || t[ti - 1] === '-' || t[ti - 1] === '/'
      score += 2 + streak * 2 + (wordStart ? 8 : 0)
      qi++
    } else {
      streak = 0
      score -= 0.5
    }
  }
  return qi === q.length ? score : null
}

/** Rank items by fuzzy score against `key(item)`, best first. */
export function fuzzyFilter<T>(query: string, items: readonly T[], key: (item: T) => string): T[] {
  if (!query.trim()) return items.slice(0, 50)
  return items
    .map((item) => ({ item, score: fuzzyScore(query, key(item)) }))
    .filter((r): r is { item: T; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map((r) => r.item)
}
