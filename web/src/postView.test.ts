import { describe, expect, it } from 'vitest'
import { chips, groupByDay, needsYou, statusLabel } from './postView'
import type { Post } from './types'

function post(over: Partial<Post>): Post {
  return {
    num: 1, account_id: 1, platforms: ['facebook'], publish_at: null, caption: '', media_type: 'none', media_urls: [],
    link: '', status: 'scheduled', attempts: 0, claimed_at: null, fb_post_id: '', fb_permalink: '', ig_media_id: '',
    ig_permalink: '', tg_message_id: '', variants: {}, assist_done_at: null, last_error: '', posted_at: null, ...over,
  }
}

describe('chips', () => {
  it('maps platform states', () => {
    const p = post({ platforms: ['facebook', 'instagram', 'tiktok'], status: 'partial', fb_post_id: '1',
      tg_message_id: '9', last_error: 'instagram: busy' })
    expect(chips(p).map((c) => c.state)).toEqual(['done', 'retry', 'assist'])
  })
  it('assisted platforms become done once marked posted', () => {
    const p = post({ platforms: ['tiktok'], tg_message_id: '9', assist_done_at: '2026-10-05T10:00:00Z' })
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
