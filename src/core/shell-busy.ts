import { basename } from './paths'

/**
 * Whether the integrated terminal is running something, from the name of the
 * process in its foreground.
 *
 * Asked before "Open in Integrated Terminal" replaces the shell with one in
 * another folder: a shell sitting at its prompt can go without a word, a dev
 * server or an editor in the middle of a file should not.
 *
 * The foreground process is the shell itself when it is at its prompt, and
 * whatever it started otherwise. node-pty only knows it on macOS and Linux; on
 * Windows it reports the shell whatever is running, so there the answer is
 * null, which callers treat as busy.
 */
export function shellIsBusy(
  foreground: string | undefined,
  shell: string,
  platform: string
): boolean | null {
  if (platform === 'win32' || !foreground) return null
  // A login shell reports itself as `-bash`.
  const name = (s: string): string => basename(s).replace(/^-/, '')
  return name(foreground) !== name(shell)
}
