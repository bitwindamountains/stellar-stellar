import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Post } from './types'

vi.mock('./supabase', () => ({ supabase: {} }))
vi.mock('./prefs', () => ({ saveDraft: vi.fn() }))
vi.mock('./route', () => ({ go: vi.fn() }))

const { startPostAgain } = await import('./actions')
const { saveDraft } = await import('./prefs')
const { go } = await import('./route')

function post(over: Partial<Post>): Post {
  return {
    num: 1, account_id: 1, group_id: null, platforms: ['facebook'], publish_at: '2026-10-30T06:00:00Z', caption: '', media_type: 'none', media_urls: [],
    link: '', status: 'posted', attempts: 1, claimed_at: null, fb_post_id: '1_2', fb_permalink: '', ig_media_id: '',
    ig_permalink: '', first_comment: '', cover_url: '', fb_comment_id: 'c1', ig_comment_id: '', stats: {}, x_post_id: '', x_permalink: '', tiktok_id: '',
    tiktok_permalink: '', tg_message_id: '', variants: {}, assist_done_at: null, last_error: '', posted_at: '2026-10-30T06:00:00Z', ...over,
  }
}

describe('startPostAgain', () => {
  beforeEach(() => vi.clearAllMocks())

  it('saves a fresh "now" draft from the post (no time, no comment IDs) and opens New post', () => {
    const variants = { instagram: { hashtags: '#coffee' } }
    startPostAgain([
      post({ num: 3, account_id: 1, platforms: ['facebook', 'instagram'], caption: 'Hi', first_comment: 'Link: x', variants,
        link: 'https://a.b', media_type: 'video', media_urls: ['https://cdn/x.mp4'], cover_url: 'https://cdn/c.jpg' }),
      post({ num: 4, account_id: 2, platforms: ['fb_profile'], caption: 'Hi' }),
    ])
    expect(saveDraft).toHaveBeenCalledWith({
      targets: { 1: ['facebook', 'instagram'], 2: ['fb_profile'] },
      caption: 'Hi', firstComment: 'Link: x', variants, link: 'https://a.b', mode: 'now', publishAt: '',
      mediaType: 'video', mediaUrl: 'https://cdn/x.mp4', coverUrl: 'https://cdn/c.jpg', note: undefined,
    })
    expect(go).toHaveBeenCalledWith('/new')
  })

  it('drops media the handoff removed, with the note', () => {
    startPostAgain([post({ media_type: 'video', media_urls: [], cover_url: 'https://cdn/c.jpg', tg_message_id: '5' })])
    expect(saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      mediaType: 'none', mediaUrl: '', coverUrl: '', note: 'The original file was removed after you posted it by hand. Add it again.',
    }))
  })
})
