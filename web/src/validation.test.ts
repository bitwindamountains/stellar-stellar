import { describe, expect, it } from 'vitest'
import type { Account } from './types'
import { hashtagCount, validate, xLength, type Draft } from './validation'

const account: Account = { id: 1, name: 'Kape', fb_page_id: 'P', ig_user_id: 'I', token_env: 'META_TOKEN_KAPE', timezone: 'Asia/Manila' }
const draft = (over: Partial<Draft>): Draft => ({
  account, platforms: ['facebook'], publishAt: '2026-10-05T18:00', caption: 'Hi', variants: {}, mediaType: 'none', mediaUrls: [], link: '', ...over,
})
const expectError = (d: Partial<Draft>, text: string) => expect(validate(draft(d), true).join('|')).toContain(text)

describe('validate (mirrors validation.py)', () => {
  it('accepts valid posts', () => {
    expect(validate(draft({}), true)).toEqual([])
    expect(validate(draft({ platforms: ['instagram'], mediaType: 'image', mediaUrls: ['https://x/a.jpg'] }), true)).toEqual([])
    expect(validate(draft({ platforms: ['tiktok', 'youtube'], mediaType: 'video', mediaUrls: ['https://x/a.mp4'] }), true)).toEqual([])
  })
  it('flags each rule', () => {
    expectError({ account: undefined }, 'Pick an account')
    expectError({ platforms: [] }, 'Pick at least one platform')
    expectError({ platforms: ['instagram'], account: { ...account, ig_user_id: '' }, mediaType: 'image', mediaUrls: ['https://x/a.jpg'] }, 'no Instagram user ID')
    expectError({ publishAt: '' }, 'Set when to post')
    expectError({ platforms: ['instagram'] }, 'Instagram needs an image')
    expectError({ mediaType: 'image' }, 'Add the image')
    expectError({ mediaType: 'image', mediaUrls: ['http://x/a.jpg'] }, 'https://')
    expectError({ mediaType: 'image', mediaUrls: ['https://drive.google.com/file/d/x'] }, 'Google Drive')
    expectError({ mediaType: 'video', mediaUrls: ['https://x/a.mp4'] }, "isn't supported yet")
    expectError({ platforms: ['tiktok'] }, 'TikTok/YouTube need a video')
    expectError({ caption: '' }, 'Facebook post is empty')
    expectError({ platforms: ['instagram'], mediaType: 'image', mediaUrls: ['https://x/a.jpg'], caption: 'x'.repeat(2201) }, '2,200')
    expectError({ platforms: ['instagram'], mediaType: 'image', mediaUrls: ['https://x/a.jpg'],
      caption: Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ') }, '30 hashtags')
  })
  it('applies each platform limit to that platform text only', () => {
    const tags = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ')
    const img = { platforms: ['facebook', 'instagram'] as const, mediaType: 'image' as const, mediaUrls: ['https://x/a.jpg'] }
    expect(validate(draft({ ...img, platforms: [...img.platforms], variants: { facebook: { hashtags: tags } } }), true)).toEqual([])
    expectError({ ...img, platforms: [...img.platforms], variants: { instagram: { hashtags: tags } } }, '30 hashtags')
    expectError({ platforms: ['youtube'], mediaType: 'video', mediaUrls: ['https://x/a.mp4'], variants: { youtube: { title: 'x'.repeat(101) } } }, 'YouTube titles')
    expect(validate(draft({ caption: '', variants: { facebook: { hashtags: '#kape' } } }), true)).toEqual([])
  })
  it('Instagram rejects PNG/WebP links, Facebook accepts them', () => {
    expectError({ platforms: ['instagram'], mediaType: 'image', mediaUrls: ['https://x/a.png'] }, 'JPEG')
    expectError({ platforms: ['instagram'], mediaType: 'image', mediaUrls: ['https://x/a.WEBP?v=1'] }, 'JPEG')
    expectError({ platforms: ['instagram'], mediaType: 'image', mediaUrls: ['https://x/a.png#preview'] }, 'JPEG')
    expectError({ platforms: ['instagram'], mediaType: 'image', mediaUrls: ['https://x/a.HEIC'] }, 'JPEG')
    expect(validate(draft({ platforms: ['instagram'], mediaType: 'image', mediaUrls: ['https://x/a.jpeg'] }), true)).toEqual([])
    expect(validate(draft({ mediaType: 'image', mediaUrls: ['https://x/a.png'] }), true)).toEqual([])
  })
  it('Telegram limit counts the whole message (mirrors validation.py)', () => {
    const video = { platforms: ['youtube'] as ['youtube'], mediaType: 'video' as const, mediaUrls: ['https://x/a.mp4'] }
    const title = { youtube: { title: 't'.repeat(100) } }
    expect(validate(draft({ ...video, caption: 'x'.repeat(3800), variants: title }), true)).toEqual([])
    expectError({ ...video, caption: 'x'.repeat(3990), variants: title }, 'shorten it by')
    // Counted after Telegram parses HTML, so '&' is one character.
    expect(validate(draft({ platforms: ['tiktok'], mediaType: 'video', mediaUrls: ['https://x/a.mp4'], caption: '&'.repeat(900) }), true)).toEqual([])
  })
  it('drafts may skip the time', () => {
    expect(validate(draft({ publishAt: '' }), false)).toEqual([])
  })
  it('counts hashtags like the publisher', () => {
    expect(hashtagCount('#kape #manila_cafe no#tag #')).toBe(3)
  })
})

describe('X and connected logins (mirrors validation.py)', () => {
  const linked: Account = { ...account, token_env: '', connections: [{ platform: 'meta', handle: 'Kape' }, { platform: 'x', handle: '@kape' }, { platform: 'tiktok', handle: 'kape' }] }
  it('counts like X', () => {
    expect(xLength('hello')).toBe(5)
    expect(xLength('see https://example.com/a/very/long/path?q=1')).toBe(27)
    expect(xLength('日本')).toBe(4)
    expect(xLength('ok 👍')).toBe(5)
    expect(xLength('é')).toBe(1)
  })
  it('needs logins', () => {
    expectError({ platforms: ['x'] }, 'connect X')
    expect(validate(draft({ account: linked, platforms: ['facebook', 'x'] }), true)).toEqual([])
  })
  it('limits X', () => {
    expectError({ account: linked, platforms: ['x'], caption: 'a'.repeat(281) }, '280')
    expectError({ account: linked, platforms: ['x'], caption: 'a'.repeat(260), link: 'https://example.com' }, '280')
    expectError({ account: linked, platforms: ['x'], mediaType: 'video', mediaUrls: ['https://x/a.mp4'] }, 'Video to X')
    expect(validate(draft({ account: linked, platforms: ['x'], caption: 'a'.repeat(280) }), true)).toEqual([])
  })
  it('limits connected TikTok captions, Shopee goes by hand', () => {
    expectError({ account: linked, platforms: ['tiktok'], mediaType: 'video', mediaUrls: ['https://x/a.mp4'], caption: 'x'.repeat(2201) }, '2,200')
    expect(validate(draft({ platforms: ['shopee'] }), true)).toEqual([])
  })
})
