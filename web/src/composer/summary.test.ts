import { describe, expect, it } from 'vitest'
import { initialWhen, linkSummary, whenSummary, whereSummary } from './summary'
import type { Account } from '../types'

const acct = (id: number, name: string) => ({ id, name, timezone: 'Asia/Manila' }) as Account
const fb = acct(1, 'fb')
const shop = acct(2, 'shop')

describe('whereSummary', () => {
  it('names the one account and its platforms', () => {
    expect(whereSummary({ 1: ['instagram', 'facebook'] }, [fb, shop])).toBe('fb · FB, IG')
  })
  it('counts several accounts and lists each platform once', () => {
    expect(whereSummary({ 1: ['facebook', 'fb_profile'], 2: ['instagram', 'facebook'] }, [fb, shop])).toBe('2 accounts · FB, IG, Profile')
  })
  it('says when nothing is picked', () => {
    expect(whereSummary({}, [fb])).toBe('Nowhere yet')
    expect(whereSummary({ 1: [] }, [fb])).toBe('Nowhere yet')
  })
  it('ignores accounts that no longer exist', () => {
    expect(whereSummary({ 9: ['facebook'] }, [fb])).toBe('Nowhere yet')
  })
})

describe('whenSummary', () => {
  it('reads Now when posting now', () => {
    expect(whenSummary('now', '2026-11-02T18:36', 'Asia/Manila')).toBe('Now')
  })
  it('shows the wall-clock time in the account zone', () => {
    expect(whenSummary('later', '2026-11-02T18:36', 'Asia/Manila', 'en-GB')).toBe('Mon 2 Nov, 18:36')
    expect(whenSummary('later', '2026-11-02T09:05', 'America/New_York', 'en-GB')).toBe('Mon 2 Nov, 09:05')
  })
  it('asks for a time when none is set', () => {
    expect(whenSummary('later', '', 'Asia/Manila')).toBe('Pick a time')
  })
})

describe('linkSummary', () => {
  it('shows a dash with no link', () => {
    expect(linkSummary('')).toBe('—')
    expect(linkSummary('   ')).toBe('—')
  })
  it('shows the host of a valid link', () => {
    expect(linkSummary('https://shop.example.com/sale?x=1')).toBe('shop.example.com')
  })
  it('shows the raw text, cut to 24 characters, when it is not a link', () => {
    expect(linkSummary('shop dot example dot com slash sale')).toBe('shop dot example dot com')
    expect(linkSummary('nope')).toBe('nope')
  })
})

describe('initialWhen', () => {
  const draft = { mode: 'now' as const, publishAt: '2026-11-05T18:00' }
  it('schedules a day from Planned at 9 am', () => {
    expect(initialWhen('2026-11-02', null)).toEqual({ mode: 'later', publishAt: '2026-11-02T09:00' })
  })
  it('lets the day win over a restored draft', () => {
    expect(initialWhen('2026-11-02', draft)).toEqual({ mode: 'later', publishAt: '2026-11-02T09:00' })
  })
  it('keeps the draft time with no day', () => {
    expect(initialWhen(undefined, draft)).toEqual({ mode: 'now', publishAt: '2026-11-05T18:00' })
  })
  it('posts now with neither', () => {
    expect(initialWhen(undefined, null)).toEqual({ mode: 'now', publishAt: '' })
  })
})
