/**
 * What a launch was asked to open.
 *
 * Three ways in, one shape. The command line this process started with, the
 * command line a second instance brought with it before quitting, and the
 * path macOS hands over in `open-file`.
 *
 * The desktop entry electron-builder writes ends in `%U`, so a file manager's
 * "Open With" passes `file:///home/you/notes.txt` rather than a path, with the
 * spaces and accents percent-encoded. A shell passes whatever was typed, which
 * may be relative to wherever it was typed. And Chromium's own switches ride in
 * the same argv: `--user-data-dir=…` is not a document.
 */

export interface LaunchContext {
  /** Where the command was run, for resolving what was typed there. */
  cwd: string
  /**
   * The app argument to ignore, when there is one: `process.argv[1]` on an
   * unpacked run, which is the bundle Electron was pointed at rather than a
   * document. A packaged build has no such argument and passes nothing.
   *
   * Matched by value and not by position, which was the first attempt and is
   * wrong. Chromium rebuilds a second instance's command line with every
   * switch first and the loose arguments after, so `./out/main/index.js`
   * arrives at whatever index is left over and dropping argv[1] drops
   * `--no-sandbox` instead: the dev run then opened a tab on its own bundle
   * every time another launch handed it a file.
   */
  appArgument?: string | undefined
}

/** The paths an argv asks for, absolute, in the order they were given. */
export function openArguments(argv: readonly string[], context: LaunchContext): string[] {
  const paths: string[] = []
  // argv[0] is the executable, and never a document.
  for (const arg of argv.slice(1)) {
    if (context.appArgument !== undefined && arg === context.appArgument) continue
    const path = openArgument(arg, context.cwd)
    if (path !== null) paths.push(path)
  }
  return paths
}

/** One argument: a path, or null when it is not one we can open. */
function openArgument(arg: string, cwd: string): string | null {
  if (arg === '' || arg.startsWith('-')) return null
  if (/^file:/i.test(arg)) return fromFileUri(arg)
  // Any other scheme is somebody else's to handle. Two or more characters
  // before the colon, so a Windows drive letter is still a path.
  if (/^[a-z][a-z0-9+.-]+:/i.test(arg)) return null
  return isAbsolute(arg) ? arg : join(cwd, arg)
}

/**
 * `file:///home/you/my%20notes.txt` is the form a file manager sends, and the
 * decoding is the point: without it the path has a literal `%20` in it and the
 * open fails with ENOENT on a file that is plainly there.
 */
function fromFileUri(uri: string): string | null {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return null
  }
  // A host means the file is on another machine, which is not something that
  // can be read by path here.
  if (url.hostname !== '' && url.hostname !== 'localhost') return null
  let path: string
  try {
    path = decodeURIComponent(url.pathname)
  } catch {
    // Percent-encoding that is not valid UTF-8. Better the raw path than none.
    path = url.pathname
  }
  // `file:///C:/notes/todo.md` parses with a leading slash that Windows does
  // not want.
  return /^\/[a-z]:/i.test(path) ? path.slice(1) : path
}

function isAbsolute(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\') || /^[a-z]:[\\/]/i.test(path)
}

function join(cwd: string, path: string): string {
  const separator = cwd.includes('\\') && !cwd.includes('/') ? '\\' : '/'
  return cwd.endsWith(separator) ? `${cwd}${path}` : `${cwd}${separator}${path}`
}
