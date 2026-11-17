import { describe, expect, it } from 'vitest'
import { openArguments } from './open-arguments'

/** A packaged build: the executable, then whatever it was asked to open. */
const PACKAGED = { cwd: '/home/you' }
/** A dev run: Electron, the bundle it was pointed at, then the arguments. */
const UNPACKED = { cwd: '/home/you', appArgument: './out/main/index.js' }

describe('openArguments', () => {
  it('reads the file:// URI a file manager sends', () => {
    // The reported bug, exactly: right-click, Open With, nothing happens. The
    // desktop entry ends in %U, so this is what argv actually holds.
    expect(
      openArguments(
        ['/opt/Orrery/orrery', 'file:///home/you/Downloads/TOBACKUP_SEPT26/jobs-arch.txt'],
        PACKAGED
      )
    ).toEqual(['/home/you/Downloads/TOBACKUP_SEPT26/jobs-arch.txt'])
  })

  it('decodes what the URI escaped', () => {
    expect(
      openArguments(['/opt/Orrery/orrery', 'file:///home/you/my%20notes/caf%C3%A9.md'], PACKAGED)
    ).toEqual(['/home/you/my notes/café.md'])
  })

  it('takes a plain path as well, since a shell gives one', () => {
    expect(openArguments(['/opt/Orrery/orrery', '/tmp/notes.md'], PACKAGED)).toEqual([
      '/tmp/notes.md'
    ])
  })

  it('resolves a relative path against where the command was run', () => {
    expect(openArguments(['/opt/Orrery/orrery', 'notes.md'], PACKAGED)).toEqual([
      '/home/you/notes.md'
    ])
    expect(openArguments(['/opt/Orrery/orrery', 'sub/notes.md'], { cwd: '/vault/' })).toEqual([
      '/vault/sub/notes.md'
    ])
  })

  it('ignores switches, which share the argv with the files', () => {
    expect(
      openArguments(
        [
          '/opt/Orrery/orrery',
          '--no-sandbox',
          '/tmp/notes.md',
          '--user-data-dir=/tmp/x',
          '-n',
          '--'
        ],
        PACKAGED
      )
    ).toEqual(['/tmp/notes.md'])
  })

  it('ignores a scheme that is not a file', () => {
    expect(
      openArguments(['/opt/Orrery/orrery', 'https://example.com/a.md', 'mailto:a@b.c'], PACKAGED)
    ).toEqual([])
  })

  it('ignores a file on another machine, which has no path to read', () => {
    expect(openArguments(['/opt/Orrery/orrery', 'file://fileserver/share/a.md'], PACKAGED)).toEqual(
      []
    )
    // localhost is this machine, spelled the long way.
    expect(openArguments(['/opt/Orrery/orrery', 'file://localhost/tmp/a.md'], PACKAGED)).toEqual([
      '/tmp/a.md'
    ])
  })

  it('does not mistake the app for a document when unpacked', () => {
    // How the dev run and every e2e launch start. Read the bundle as a
    // document and every launch opens a tab on it.
    expect(
      openArguments(
        ['/usr/bin/electron', './out/main/index.js', '--no-sandbox', '/tmp/notes.md'],
        UNPACKED
      )
    ).toEqual(['/tmp/notes.md'])
    expect(openArguments(['/usr/bin/electron', './out/main/index.js'], UNPACKED)).toEqual([])
  })

  it('finds the app wherever the command line was rebuilt to put it', () => {
    // What `second-instance` actually hands over: Chromium reorders the
    // command line so that the switches come first. Dropping argv[1] here
    // drops `--no-sandbox` and opens the bundle as a document.
    expect(
      openArguments(
        [
          '/usr/bin/electron',
          '--no-sandbox',
          '--user-data-dir=/tmp/ud',
          './out/main/index.js',
          'file:///tmp/notes.md'
        ],
        UNPACKED
      )
    ).toEqual(['/tmp/notes.md'])
  })

  it('keeps a Windows path and its drive letter', () => {
    const cwd = 'C:\\Users\\you'
    expect(openArguments(['orrery.exe', 'C:\\Notes\\todo.md'], { cwd })).toEqual([
      'C:\\Notes\\todo.md'
    ])
    expect(openArguments(['orrery.exe', 'file:///C:/Notes/todo.md'], { cwd })).toEqual([
      'C:/Notes/todo.md'
    ])
    expect(openArguments(['orrery.exe', 'todo.md'], { cwd })).toEqual(['C:\\Users\\you\\todo.md'])
  })

  it('keeps several files in the order they were asked for', () => {
    expect(
      openArguments(['/opt/Orrery/orrery', '/a.md', 'file:///b.md', '/c.md'], PACKAGED)
    ).toEqual(['/a.md', '/b.md', '/c.md'])
  })

  it('has nothing to open on an ordinary launch', () => {
    expect(openArguments(['/opt/Orrery/orrery'], PACKAGED)).toEqual([])
  })
})
