/** Prepend `item` to an LRU list, deduplicating and capping length. */
export function pushRecent(list: readonly string[], item: string, cap = 15): string[] {
  const next = [item, ...list.filter((x) => x !== item)]
  return next.length > cap ? next.slice(0, cap) : next
}
