import { describe, expect, it } from 'vitest'
import { ago, canRetry, chipState, chips, flightStep, groupByDay, mediaWasRemoved, mergePosts, needsYou, statsLine, statusLabel, weekStrip } from './postView'
import { isDraft, needsFinishing, postedByApi, sentByHand, type Post } from './types'

function post(over: Partial<Post>): Post {
  return {
    num: 1, account_id: 1, group_id: null, platforms: ['facebook'], publish_at: null, caption: '', media_type: 'none', media_urls: [],
    link: '', status: 'scheduled', attempts: 0, claimed_at: null, fb_post_id: '', fb_permalink: '', ig_media_id: '',
    ig_permalink: '', first_comment: '', fb_comment_id: '', ig_comment_id: '', stats: {}, x_post_id: '', x_permalink: '', tiktok_id: '', tiktok_permalink: '', tg_message_id: '', variants: {}, assist_done_at: null, last_error: '', posted_at: null, ...over,
  }
}

describe('chips', () => {
  it('maps platform states', () => {
    const p = post({ platforms: ['facebook', 'instagram', 'tiktok'], status: 'partial', fb_post_id: '1',
      tg_message_id: '9', tiktok_id: 'telegram', last_error: 'instagram: busy' })
    expect(chips(p).map((c) => c.state)).toEqual(['done', 'retry', 'assist'])
  })
  it('assisted platforms become done once marked posted', () => {
    const p = post({ platforms: ['tiktok'], tg_message_id: '9', tiktok_id: 'telegram', assist_done_at: '2026-10-05T10:00:00Z' })
    expect(chips(p)[0].state).toBe('done')
    expect(needsYou(p)).toBe(false)
  })
})

describe('status', () => {
  it('awaiting handoff outranks posted', () => {
    expect(statusLabel(post({ status: 'posted', tg_message_id: '9' })).text).toBe('By hand')
    expect(needsYou(post({ status: 'posted', tg_message_id: '9' }))).toBe(true)
  })
  it('partial shows attempts', () => {
    expect(statusLabel(post({ status: 'partial', attempts: 2 })).text).toBe('Retrying 2/3')
  })
  it('failed and missed need you', () => {
    expect(needsYou(post({ status: 'failed' }))).toBe(true)
    expect(needsYou(post({ status: 'missed' }))).toBe(true)
    expect(needsYou(post({ status: 'scheduled' }))).toBe(false)
  })
})

describe('groupByDay', () => {
  it('labels relative days and puts undated last', () => {
    const now = new Date(2026, 9, 5, 12, 0)
    const groups = groupByDay([
      post({ num: 3 }),
      post({ num: 2, publish_at: new Date(2026, 9, 6, 9, 0).toISOString() }),
      post({ num: 1, publish_at: new Date(2026, 9, 5, 18, 0).toISOString() }),
    ], now)
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Tomorrow', 'No date yet'])
    expect(groups[0].posts[0].num).toBe(1)
  })
})

describe('canRetry', () => {
  it('offers retry only when the post surely did not go out', () => {
    expect(canRetry(post({ status: 'missed', last_error: 'Not posted: over 180 min late.' }))).toBe(true)
    expect(canRetry(post({ status: 'failed', last_error: 'instagram: Meta rejected the post' }))).toBe(true)
    expect(canRetry(post({ status: 'failed', last_error: 'No clear answer from Meta while publishing: check if it posted' }))).toBe(false)
    expect(canRetry(post({ status: 'failed', last_error: 'Run stopped while posting. Check instagram' }))).toBe(false)
    expect(canRetry(post({ status: 'scheduled' }))).toBe(false)
  })
})

describe('weekStrip', () => {
  it('counts live posts per day for 7 days and flags empty days', () => {
    const now = new Date(2026, 9, 5, 12, 0)
    const at = (d: number, h: number) => new Date(2026, 9, d, h, 0).toISOString()
    const strip = weekStrip([
      post({ num: 1, publish_at: at(5, 9), status: 'posted' }),
      post({ num: 2, publish_at: at(5, 18) }),
      post({ num: 3, publish_at: at(6, 9), status: 'failed' }),
      post({ num: 4, publish_at: at(11, 23) }),
      post({ num: 5, publish_at: at(12, 9) }), // day 8: outside the strip
    ], now)
    expect(strip.map((d) => d.count)).toEqual([2, 0, 0, 0, 0, 0, 1])
    expect(strip[0].label).toBe('Today')
    expect(strip.map((d) => d.date)).toEqual([5, 6, 7, 8, 9, 10, 11])
  })
})

describe('mediaWasRemoved', () => {
  it('is true only when a post with media has no link left', () => {
    expect(mediaWasRemoved(post({ media_type: 'video', media_urls: [] }))).toBe(true)
    expect(mediaWasRemoved(post({ media_type: 'video', media_urls: ['https://x/a.mp4'] }))).toBe(false)
    expect(mediaWasRemoved(post({ media_type: 'none', media_urls: [] }))).toBe(false)
  })
})

describe('mergePosts', () => {
  it('keeps one copy of each post across queries and tolerates failed queries', () => {
    const merged = mergePosts([post({ num: 1 }), post({ num: 2 })], null, [post({ num: 2, status: 'failed' }), post({ num: 9 })])
    expect(merged.map((p) => p.num).sort()).toEqual([1, 2, 9])
  })
})

describe('TikTok by hand or automatic', () => {
  it('an uploaded TikTok draft waits for you until marked posted', () => {
    expect(chipState(post({ platforms: ['tiktok'], tiktok_id: 'v_pub_1' }), 'tiktok')).toBe('assist')
    expect(chipState(post({ platforms: ['tiktok'], tiktok_id: 'v_pub_1', assist_done_at: '2026-10-28T10:00:00Z' }), 'tiktok')).toBe('done')
    expect(needsFinishing(post({ platforms: ['tiktok'], tiktok_id: 'v_pub_1' }), 'tiktok')).toBe(true)
    expect(isDraft(post({ tiktok_id: 'telegram' }), 'tiktok')).toBe(false)
    expect(chipState(post({ platforms: ['tiktok'], tiktok_id: 'telegram', tg_message_id: '9' }), 'tiktok')).toBe('assist')
  })
})

describe('sentByHand', () => {
  const linked = { id: 1, name: 'K', fb_page_id: '', ig_user_id: '', token_env: '', timezone: 'UTC', connections: [{ platform: 'tiktok' as const, handle: 'k' }] }
  it('a connected TikTok still retrying is automatic, not by hand', () => {
    const p = post({ platforms: ['tiktok', 'youtube'], status: 'partial', tg_message_id: '9' })
    expect(sentByHand(p, 'tiktok')).toBe(false)
    expect(sentByHand(post({ platforms: ['tiktok'] }), 'tiktok', linked)).toBe(false)
    expect(sentByHand(post({ platforms: ['tiktok'] }), 'tiktok')).toBe(true)
    expect(sentByHand(post({ platforms: ['tiktok'], tiktok_id: 'telegram' }), 'tiktok', linked)).toBe(true)
  })
  it('posts live on an automatic platform cannot be deleted', () => {
    expect(postedByApi(post({ x_post_id: '1' }))).toBe(true)
    expect(postedByApi(post({ tiktok_id: 'telegram' }))).toBe(false)
  })
})

describe('statsLine', () => {
  it('compacts and joins present counts', () => {
    expect(statsLine({ as_of: 'x', views: 1200, likes: 48, comments: 6, shares: 2 })).toBe('1.2k views · 48 likes · 6 comments · 2 shares')
    expect(statsLine({ as_of: 'x', views: 2000, likes: 12500 })).toBe('2k views · 12.5k likes')
    expect(statsLine({ as_of: 'x', views: 1_000_000 })).toBe('1m views')
  })
  it('falls back to reach and leaves out missing values', () => {
    expect(statsLine({ as_of: 'x', reach: 310, likes: 4 })).toBe('310 reach · 4 likes')
    expect(statsLine({ as_of: 'x' })).toBe('')
  })
})

describe('ago', () => {
  const now = new Date('2026-10-30T12:00:00Z')
  it('says how long ago', () => {
    expect(ago('2026-10-30T11:59:40Z', now)).toBe('just now')
    expect(ago('2026-10-30T11:55:00Z', now)).toBe('5 min ago')
    expect(ago('2026-10-30T09:00:00Z', now)).toBe('3 h ago')
    expect(ago('2026-10-28T12:00:00Z', now)).toBe('2 d ago')
  })
})

describe('flightStep', () => {
  const g = (...rows: Partial<Post>[]) => ({ key: 'k', lead: post(rows[0]), rows: rows.map((r, i) => post({ num: i + 1, ...r })) })
  it('says where a post in flight is', () => {
    expect(flightStep(g({ status: 'posted' }, { status: 'posting' }))).toBe('Posting…')
    expect(flightStep(g({ status: 'scheduled' }))).toBe('Waiting for the next run')
    expect(flightStep(g({ status: 'posted' }, { status: 'partial' }))).toBe('Waiting for the next run')
    expect(flightStep(g({ status: 'posted' }))).toBe('Posted')
  })
})
