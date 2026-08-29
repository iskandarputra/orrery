import type { AppState } from './app-state'

/**
 * Reaching the store from code the store itself pulls in.
 *
 * The editor extensions, the menus and the note commands all need application
 * state, and all of them are loaded — directly or through `create-state` — by
 * the very slices that make up the store. Importing `store.ts` from there is a
 * genuine runtime cycle: eight of them existed, and which module won the race
 * to initialise decided whether `useStore` was defined when it was first read.
 *
 * This module imports nothing at runtime, so it can never be part of a cycle.
 * The store hands itself over once, at construction.
 *
 * It is also the seam that makes those modules testable: a test provides a
 * state of its own instead of standing up the whole store.
 */
let read: (() => AppState) | null = null

export function provideAppState(source: () => AppState): void {
  read = source
}

export function appState(): AppState {
  if (!read) {
    // Only reachable by importing one of these modules before the store is
    // constructed, which is a wiring mistake rather than a runtime condition.
    throw new Error('appState() called before the store was provided')
  }
  return read()
}
