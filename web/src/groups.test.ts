import { describe, expect, it } from 'vitest'
import { groupHref, groupPosts, groupStatus, postLinks } from './groups'
import type { Post } from './types'

function post(over: Partial<Post>): Post {
  return {
    num: 1, account_id: 1, group_id: null, platforms: ['facebook'], publish_at: null, caption: '', media_type: 'none', media_urls: [],
    link: '', status: 'scheduled', attempts: 0, claimed_at: null, fb_post_id: '', fb_permalink: '', ig_media_id: '',
    ig_permalink: '', x_post_id: '', x_permalink: '', tiktok_id: '', tiktok_permalink: '', tg_message_id: '', variants: {}, assist_done_at: null, last_error: '', posted_at: null, ...over,
  }
}

describe('groups', () => {
  it('joins rows that share a group_id and keeps lone rows apart', () => {
    const groups = groupPosts([post({ num: 5, group_id: 'g' }), post({ num: 2 }), post({ num: 3, group_id: 'g' })])
    expect(groups.map((g) => g.rows.map((r) => r.num))).toEqual([[3, 5], [2]])
    expect(groups[0].lead.num).toBe(3)
  })

  it('shows the most urgent status', () => {
    expect(groupStatus([post({ status: 'posted' }), post({ status: 'failed' })]).tone).toBe('failed')
    expect(groupStatus([post({ status: 'posted' }), post({ status: 'scheduled' })]).tone).toBe('scheduled')
  })

  it('opens the row waiting on your phone first', () => {
    expect(groupHref([post({ num: 1 }), post({ num: 2, tg_message_id: '9' })])).toBe('#/handoff/2')
    expect(groupHref([post({ num: 1 }), post({ num: 2 })])).toBe('#/edit/1')
  })

  it('lists only real links', () => {
    expect(postLinks(post({ fb_permalink: 'https://facebook.com/1', x_permalink: '' })).map((l) => l.platform)).toEqual(['facebook'])
  })
})
