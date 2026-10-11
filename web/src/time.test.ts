import { describe, expect, it } from 'vitest'
import { quickTimes, utcToZoned, zonedToUtc } from './time'

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

describe('quickTimes', () => {
  it('builds chips in the account time zone', () => {
    const now = new Date('2026-10-05T04:30:00Z') // 12:30 in Manila
    expect(quickTimes('Asia/Manila', now)).toEqual([
      { label: 'In 1 hour', value: '2026-10-05T13:30' },
      { label: 'Tonight 7 pm', value: '2026-10-05T19:00' },
      { label: 'Tomorrow 9 am', value: '2026-10-06T09:00' },
    ])
  })
  it('rolls tonight to tomorrow after 7 pm and handles month end', () => {
    const now = new Date('2026-10-31T12:30:00Z') // 20:30 in Manila
    const chips = quickTimes('Asia/Manila', now)
    expect(chips[1]).toEqual({ label: 'Tomorrow 7 pm', value: '2026-11-01T19:00' })
    expect(chips[2].value).toBe('2026-11-01T09:00')
  })
})
