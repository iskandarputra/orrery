import { describe, expect, it } from 'vitest'
import { shellIsBusy } from './shell-busy'

describe('shellIsBusy', () => {
  it('is idle when the shell itself is in the foreground', () => {
    expect(shellIsBusy('bash', '/bin/bash', 'linux')).toBe(false)
    expect(shellIsBusy('zsh', '/usr/bin/zsh', 'darwin')).toBe(false)
  })

  it('counts a login shell as the shell', () => {
    expect(shellIsBusy('-zsh', '/bin/zsh', 'darwin')).toBe(false)
  })

  it('is busy when anything else is in the foreground', () => {
    expect(shellIsBusy('node', '/bin/bash', 'linux')).toBe(true)
    expect(shellIsBusy('vim', '/usr/bin/zsh', 'linux')).toBe(true)
  })

  it('cannot tell on Windows, or without a name', () => {
    expect(shellIsBusy('powershell.exe', 'powershell.exe', 'win32')).toBeNull()
    expect(shellIsBusy(undefined, '/bin/bash', 'linux')).toBeNull()
  })
})
