import { describe, expect, it } from 'vitest'
import { formatDate, renderTemplate } from './template'

// A fixed instant so nothing here depends on when the tests run.
const NOW = new Date(2026, 7, 25, 14, 5, 9) // Tue 25 Aug 2026, 14:05:09

describe('formatDate', () => {
  it('fills the common tokens', () => {
    expect(formatDate(NOW, 'YYYY-MM-DD')).toBe('2026-08-25')
    expect(formatDate(NOW, 'DD/MM/YY')).toBe('25/08/26')
    expect(formatDate(NOW, 'HH:mm:ss')).toBe('14:05:09')
  })

  it('writes month and weekday names', () => {
    expect(formatDate(NOW, 'dddd, D MMMM YYYY')).toBe('Tuesday, 25 August 2026')
    expect(formatDate(NOW, 'ddd MMM D')).toBe('Tue Aug 25')
  })

  it('leaves unknown characters alone', () => {
    expect(formatDate(NOW, '[note] YYYY')).toBe('[note] 2026')
  })
})

describe('renderTemplate', () => {
  const ctx = { now: NOW, title: 'My Note', dateFormat: 'YYYY-MM-DD' }

  it('substitutes date, time and title', () => {
    expect(renderTemplate('# {{title}}\n\n{{date}} at {{time}}', ctx).text).toBe(
      '# My Note\n\n2026-08-25 at 14:05'
    )
  })

  it('honours an explicit format', () => {
    expect(renderTemplate('{{date:dddd}}', ctx).text).toBe('Tuesday')
  })

  it('shifts the date by an offset', () => {
    expect(renderTemplate('{{date+1d}}', ctx).text).toBe('2026-08-26')
    expect(renderTemplate('{{date-1d}}', ctx).text).toBe('2026-08-24')
    expect(renderTemplate('{{date+1w:YYYY-MM-DD}}', ctx).text).toBe('2026-09-01')
  })

  it('crosses month and year boundaries correctly', () => {
    const eve = { ...ctx, now: new Date(2026, 11, 31, 9, 0, 0) }
    expect(renderTemplate('{{date+1d}}', eve).text).toBe('2027-01-01')
    const first = { ...ctx, now: new Date(2026, 0, 1, 9, 0, 0) }
    expect(renderTemplate('{{date-1d}}', first).text).toBe('2025-12-31')
  })

  it('reports where the cursor marker was and removes it', () => {
    const { text, cursor } = renderTemplate('# {{title}}\n\n{{cursor}}\n\nrest', ctx)
    expect(text).toBe('# My Note\n\n\n\nrest')
    expect(cursor).toBe(text.indexOf('\n\n\n\nrest') + 2)
  })

  it('leaves the cursor null when the template has no marker', () => {
    expect(renderTemplate('plain', ctx).cursor).toBeNull()
  })

  it('leaves unknown placeholders untouched rather than blanking them', () => {
    expect(renderTemplate('{{weather}} {{title}}', ctx).text).toBe('{{weather}} My Note')
  })

  it('tolerates spaces inside the braces', () => {
    expect(renderTemplate('{{ title }} {{ date : dddd }}', ctx).text).toBe('My Note Tuesday')
  })
})
