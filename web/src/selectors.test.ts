import { describe, expect, it } from 'vitest'
import { draftGroups, historyGroups, localDay, parseRoute, plannedDay, todayView, weekDays } from './selectors'
import type { Post } from './types'

function post(over: Partial<Post>): Post {
  return {
    num: 1, account_id: 1, group_id: null, platforms: ['facebook'], publish_at: null, caption: '', media_type: 'none', media_urls: [],
    link: '', status: 'scheduled', attempts: 0, claimed_at: null, fb_post_id: '', fb_permalink: '', ig_media_id: '',
    ig_permalink: '', first_comment: '', fb_comment_id: '', ig_comment_id: '', stats: {}, x_post_id: '', x_permalink: '', tiktok_id: '', tiktok_permalink: '', tg_message_id: '', variants: {}, assist_done_at: null, last_error: '', posted_at: null, ...over,
  }
}

const TZ = 'Asia/Manila'
const now = new Date('2026-10-30T06:00:00Z') // 14:00 in Manila
const nums = (gs: { lead: Post }[]) => gs.map((g) => g.lead.num)
const none = () => undefined

describe('localDay', () => {
  it('local day follows the account time zone', () => {
    expect(localDay('2026-10-30T15:30:00Z', TZ)).toBe('2026-10-30')
    expect(localDay('2026-10-30T16:30:00Z', TZ)).toBe('2026-10-31')
  })
})

describe('todayView', () => {
  const v = todayView([
    post({ num: 1, status: 'failed', publish_at: '2026-10-22T02:00:00Z' }),
    post({ num: 2, status: 'scheduled', publish_at: '2026-10-30T01:00:00Z' }),
    post({ num: 3, status: 'posted', publish_at: '2026-10-30T00:00:00Z', posted_at: '2026-10-30T00:01:00Z' }),
    post({ num: 4, status: 'scheduled', publish_at: '2026-10-31T01:00:00Z' }),
    post({ num: 5, status: 'posting', publish_at: '2026-10-30T05:00:00Z', claimed_at: '2026-10-30T05:15:00Z' }),
    post({ num: 6, status: 'posting', publish_at: '2026-10-30T05:50:00Z', claimed_at: '2026-10-30T05:55:00Z' }),
  ], now, TZ)
  it('sorts posts into the three lists', () => {
    expect(nums(v.needsYou)).toEqual([5, 1])
    expect(nums(v.goingOut)).toEqual([2, 5, 6])
    expect(nums(v.outToday)).toEqual([3])
  })
  it('leaves tomorrow out and a fresh claim out of needsYou', () => {
    expect([...v.needsYou, ...v.goingOut, ...v.outToday].map((g) => g.lead.num)).not.toContain(4)
    expect(nums(v.needsYou)).not.toContain(6)
  })
})

describe('mixed group', () => {
  it('is in needsYou and in history', () => {
    const rows = [
      post({ num: 1, group_id: 'g', status: 'failed' }),
      post({ num: 2, group_id: 'g', status: 'posted', posted_at: '2026-10-30T01:00:00Z', fb_post_id: '1' }),
    ]
    expect(todayView(rows, now, TZ).needsYou).toHaveLength(1)
    expect(historyGroups(rows, 'all', none)).toHaveLength(1)
  })
})

describe('week and planned', () => {
  const posts = [
    post({ num: 1, publish_at: '2026-11-01T05:00:00Z' }),
    post({ num: 2, publish_at: '2026-11-01T01:00:00Z' }),
    post({ num: 3, status: 'draft', publish_at: '2026-11-01T02:00:00Z' }),
  ]
  it('weekDays counts only scheduled', () => {
    const w = weekDays(posts, '2026-10-31', TZ)
    expect(w).toHaveLength(7)
    expect(w[0]).toEqual({ day: '2026-10-31', weekday: 'Sat', date: 31, count: 0 })
    expect(w[1].count).toBe(2)
  })
  it('plannedDay is sorted by time', () => expect(nums(plannedDay(posts, '2026-11-01', TZ))).toEqual([2, 1]))
  it('draftGroups excludes scheduled', () => expect(nums(draftGroups(posts))).toEqual([3]))
})

describe('historyGroups filters', () => {
  const posts = [
    post({ num: 1, status: 'posted', platforms: ['fb_profile'], tg_message_id: '9', posted_at: '2026-10-30T01:00:00Z' }),
    post({ num: 2, status: 'posted', platforms: ['facebook', 'instagram'], ig_media_id: 'i', fb_post_id: 'f', posted_at: '2026-10-30T02:00:00Z' }),
    post({ num: 3, status: 'posted', platforms: ['facebook'], fb_post_id: 'f', posted_at: '2026-10-30T03:00:00Z' }),
  ]
  it('hand keeps the profile post', () => expect(nums(historyGroups(posts, 'hand', none))).toEqual([1]))
  it('instagram keeps only posts with ig_media_id', () => expect(nums(historyGroups(posts, 'instagram', none))).toEqual([2]))
  it('all is newest first', () => expect(nums(historyGroups(posts, 'all', none))).toEqual([3, 2, 1]))
})

describe('parseRoute', () => {
  const q = (s = '') => new URLSearchParams(s)
  it('parses screens', () => {
    expect(parseRoute([''], q())).toEqual({ screen: 'today' })
    expect(parseRoute(['handoff', '12'], q())).toEqual({ screen: 'handoff', num: 12 })
    expect(parseRoute(['history', '7'], q())).toEqual({ screen: 'post', num: 7 })
    expect(parseRoute(['history'], q())).toEqual({ screen: 'history' })
    expect(parseRoute(['new'], q('day=2026-11-02'))).toEqual({ screen: 'new', day: '2026-11-02' })
    expect(parseRoute(['new'], q('day=nope'))).toEqual({ screen: 'new', day: undefined })
    expect(parseRoute(['edit', 'x'], q())).toEqual({ screen: 'today' })
    expect(parseRoute(['accounts'], q())).toEqual({ screen: 'accounts' })
  })
})
