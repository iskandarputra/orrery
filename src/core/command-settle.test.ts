import { describe, expect, it } from 'vitest'
import { commandSettle, submitsLine, type Clock } from './command-settle'

/** A clock that only moves when told to. */
function manualClock(): Clock & { advance(ms: number): void; pending(): number } {
  let now = 0
  let next = 1
  const timers = new Map<number, { at: number; run: () => void }>()
  return {
    set(run, ms) {
      const id = next++
      timers.set(id, { at: now + ms, run })
      return id
    },
    clear(handle) {
      timers.delete(handle as number)
    },
    advance(ms) {
      now += ms
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at <= now) {
          timers.delete(id)
          timer.run()
        }
      }
    },
    pending: () => timers.size
  }
}

function setup() {
  const clock = manualClock()
  let settled = 0
  const settle = commandSettle(() => settled++, 500, clock)
  return { clock, settle, settled: () => settled }
}

describe('submitsLine', () => {
  it('is Enter, or a pasted block with lines in it', () => {
    expect(submitsLine('\r')).toBe(true)
    expect(submitsLine('ls -la\r')).toBe(true)
    expect(submitsLine('one\ntwo')).toBe(true)
  })

  it('is not a keystroke on the way to one', () => {
    expect(submitsLine('l')).toBe(false)
    expect(submitsLine('\x7f')).toBe(false) // backspace
    expect(submitsLine('\x1b[A')).toBe(false) // up arrow
    expect(submitsLine('\t')).toBe(false)
  })
})

describe('commandSettle', () => {
  it('fires once when the output after a command goes quiet', () => {
    const { clock, settle, settled } = setup()
    settle.input('echo hi > a.md\r')
    settle.output()
    clock.advance(300)
    settle.output()
    clock.advance(300)
    expect(settled()).toBe(0)
    clock.advance(200)
    expect(settled()).toBe(1)
  })

  it('fires for a command that prints nothing', () => {
    const { clock, settle, settled } = setup()
    settle.input('\r')
    clock.advance(500)
    expect(settled()).toBe(1)
  })

  it('waits out a command that keeps printing', () => {
    const { clock, settle, settled } = setup()
    settle.input('npm test\r')
    for (let i = 0; i < 20; i++) {
      settle.output()
      clock.advance(400)
    }
    expect(settled()).toBe(0)
    clock.advance(100)
    expect(settled()).toBe(1)
  })

  it('does nothing for output that follows no command', () => {
    // A dev server started earlier, still printing: not a new command each time.
    const { clock, settle, settled } = setup()
    settle.input('npm run dev\r')
    clock.advance(500)
    expect(settled()).toBe(1)
    for (let i = 0; i < 10; i++) {
      settle.output()
      clock.advance(600)
    }
    expect(settled()).toBe(1)
    expect(clock.pending()).toBe(0)
  })

  it('does nothing for typing that has not been submitted', () => {
    const { clock, settle, settled } = setup()
    settle.input('g')
    settle.input('i')
    settle.input('t')
    settle.output()
    clock.advance(5000)
    expect(settled()).toBe(0)
  })

  it('forgets a command waiting to settle when disposed', () => {
    const { clock, settle, settled } = setup()
    settle.input('ls\r')
    settle.dispose()
    clock.advance(5000)
    settle.output()
    clock.advance(5000)
    expect(settled()).toBe(0)
  })
})
