import { describe, expect, it } from 'vitest'
import { utcToZoned, zonedToUtc } from './time'

describe('zone conversion', () => {
  it('Manila is UTC+8', () => {
    expect(zonedToUtc('2026-10-05T18:00', 'Asia/Manila')).toBe('2026-10-05T10:00:00.000Z')
    expect(utcToZoned('2026-10-05T10:00:00Z', 'Asia/Manila')).toBe('2026-10-05T18:00')
  })
  it('handles DST zones and day rollover', () => {
    expect(zonedToUtc('2026-07-01T09:30', 'America/New_York')).toBe('2026-07-01T13:30:00.000Z')
    expect(zonedToUtc('2026-01-01T00:15', 'Asia/Manila')).toBe('2025-12-31T16:15:00.000Z')
  })
  it('round-trips', () => {
    const local = '2026-03-08T14:45'
    expect(utcToZoned(zonedToUtc(local, 'Europe/London'), 'Europe/London')).toBe(local)
  })
})
