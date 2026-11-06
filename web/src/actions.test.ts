import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Post } from './types'

const db = vi.hoisted(() => {
  const q: Record<string, unknown> = { rows: [{ num: 1 }] }
  const update = vi.fn(() => q)
  Object.assign(q, { eq: () => q, in: () => q, select: () => Promise.resolve({ data: q.rows, error: null }) })
  return { q, update }
})
vi.mock('./supabase', () => ({ supabase: { from: () => ({ update: db.update }), functions: { invoke: () => Promise.resolve() } } }))
vi.mock('./prefs', () => ({ saveDraft: vi.fn() }))
vi.mock('./route', () => ({ go: vi.fn() }))

const { repostFailed, startPostAgain } = await import('./actions')
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
        link: 'https://a.b', media_type: 'video', media_urls: ['https://cdn/x.mp4'], cover_url: 'https://cdn/c.jpg',
        video_seconds: 12.5, video_width: 1080, video_height: 1920 }),
      post({ num: 4, account_id: 2, platforms: ['fb_profile'], caption: 'Hi' }),
    ])
    expect(saveDraft).toHaveBeenCalledWith({
      targets: { 1: ['facebook', 'instagram'], 2: ['fb_profile'] },
      caption: 'Hi', firstComment: 'Link: x', variants, link: 'https://a.b', mode: 'now', publishAt: '',
      mediaType: 'video', mediaUrl: 'https://cdn/x.mp4', coverUrl: 'https://cdn/c.jpg', note: undefined,
      videoSeconds: 12.5, videoWidth: 1080, videoHeight: 1920,
    })
    expect(go).toHaveBeenCalledWith('/new')
  })

  it('drops media the handoff removed, with the note', () => {
    startPostAgain([post({ media_type: 'video', media_urls: [], cover_url: 'https://cdn/c.jpg', tg_message_id: '5' })])
    expect(saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      mediaType: 'none', mediaUrl: '', coverUrl: '', note: 'The original file was removed after the post went out. Add it again.',
    }))
  })
})

describe('repostFailed', () => {
  beforeEach(() => { vi.clearAllMocks(); db.q.rows = [{ num: 1 }] })
  const failed = post({ status: 'failed', platforms: ['facebook', 'instagram', 'x'], ig_media_id: 'i1', x_post_id: 'x1', fb_post_id: 'f1',
    fb_permalink: 'p', last_error: 'facebook: Facebook accepted the Reel, check Facebook; facebook comment: x' })

  it('clears only the failed platform and requeues', async () => {
    expect(await repostFailed(failed)).toBeNull()
    const sent = (db.update.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(sent).toMatchObject({ fb_post_id: '', fb_permalink: '', fb_comment_id: '', status: 'scheduled', last_error: '' })
    expect(sent).not.toHaveProperty('ig_media_id')
    expect(sent).not.toHaveProperty('x_post_id')
  })

  it('reposts Facebook after a run stopped with its unconfirmed Reel ID kept', async () => {
    const last_error = "facebook: Facebook accepted the Reel but was still processing; check it's on your Page; Run stopped while posting. Check facebook, instagram, x, then reschedule if it's missing."
    expect(await repostFailed({ ...failed, ig_media_id: '', x_post_id: '', last_error })).toBeNull()
    const sent = (db.update.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(sent).toMatchObject({ fb_post_id: '', status: 'scheduled' })
  })

  it('refuses when the media is gone or the row changed', async () => {
    expect(await repostFailed({ ...failed, media_type: 'video', media_urls: [] })).toMatch(/removed/)
    expect(db.update).not.toHaveBeenCalled()
    db.q.rows = []
    expect(await repostFailed(failed)).toBe('This post changed; reload')
  })
})
