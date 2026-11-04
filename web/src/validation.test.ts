import { describe, expect, it } from 'vitest'
import type { Account, Platform } from './types'
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
    expect(xLength('\u{1F44D}\u{1F3FD}')).toBe(2)
    expect(xLength('\u{1F468}‍\u{1F469}‍\u{1F467}')).toBe(2)
    expect(xLength('\u{1F1F5}\u{1F1ED}')).toBe(2)
    expect(xLength('❤️')).toBe(2)
    expect(xLength('visit shop.example.com today')).toBe(6 + 23 + 6)
    expect(xLength('e.g. this')).toBe(9)
  })
  it('needs logins', () => {
    expectError({ platforms: ['x'] }, 'connect X')
    expect(validate(draft({ account: linked, platforms: ['facebook', 'x'] }), true)).toEqual([])
  })
  it('limits X', () => {
    expectError({ account: linked, platforms: ['x'], caption: 'a'.repeat(281) }, '280')
    expectError({ account: linked, platforms: ['x'], caption: 'a'.repeat(260), link: 'https://example.com' }, '280')
    expect(validate(draft({ account: linked, platforms: ['x'], caption: 'a'.repeat(280) }), true)).toEqual([])
  })
  it('limits connected TikTok captions, Shopee goes by hand', () => {
    expectError({ account: linked, platforms: ['tiktok'], mediaType: 'video', mediaUrls: ['https://x/a.mp4'], caption: 'x'.repeat(2201) }, '2,200')
    expect(validate(draft({ platforms: ['shopee'] }), true)).toEqual([])
  })
  it('checks the first comment', () => {
    const ig = { platforms: ['instagram' as const], mediaType: 'image' as const, mediaUrls: ['https://x/a.jpg'] }
    const msg = 'First comment: Instagram allows at most 2,200 characters'
    expect(validate(draft({ ...ig, firstComment: 'x'.repeat(2200) }), true)).toEqual([])
    expectError({ ...ig, firstComment: 'x'.repeat(2201) }, msg)
    expect(validate(draft({ ...ig, firstComment: '\u{1F600}'.repeat(1100) }), true)).toEqual([]) // 2,200 UTF-16 units
    expectError({ ...ig, firstComment: '\u{1F600}'.repeat(1100) + 'x' }, msg)
    expect(validate(draft({ ...ig, firstComment: 'BUY #a #b #c #d #e https://a.co https://b.co' }), true)).toEqual([])
    expect(validate(draft({ ...ig, firstComment: '' }), true)).toEqual([])
    expect(validate(draft({ firstComment: 'x'.repeat(3000) }), true)).toEqual([])
    const video = { platforms: ['youtube' as const], mediaType: 'video' as const, mediaUrls: ['https://x/a.mp4'] }
    expectError({ ...video, firstComment: 'x'.repeat(4037) }, 'First comment too long for the phone handoff')
    expect(validate(draft({ ...video, firstComment: 'x'.repeat(4036) }), true)).toEqual([])
    expect(validate(draft({ firstComment: 'x'.repeat(5000) }), true)).toEqual([])
    // TikTok drafts get the comment block in Telegram too, even when TikTok is connected.
    const tiktok = { ...video, platforms: ['tiktok' as const] }
    expectError({ ...tiktok, account: linked, firstComment: 'x'.repeat(4037) }, 'First comment too long for the phone handoff')
    expect(validate(draft({ ...tiktok, account: linked, firstComment: 'x'.repeat(4036) }), true)).toEqual([])
    expectError({ ...tiktok, account: undefined, firstComment: 'x'.repeat(4037) }, 'First comment too long for the phone handoff')
  })
})

describe('video and covers (mirrors validation.py)', () => {
  const video = { mediaType: 'video' as const, mediaUrls: ['https://x/a.mp4'] }
  const linked: Account = { ...account, connections: [{ platform: 'meta', handle: 'Kape' }, { platform: 'x', handle: '@kape' }] }
  it('allows video to Facebook, Instagram and X', () => {
    expect(validate(draft({ ...video, account: linked, platforms: ['facebook', 'instagram', 'x'] }), true)).toEqual([])
  })
  it('keeps the JPEG rule for images only', () => {
    expect(validate(draft({ ...video, platforms: ['instagram'] }), true).join('|')).not.toContain('JPEG')
    expectError({ platforms: ['instagram'], mediaType: 'image', mediaUrls: ['https://x/a.png'] }, 'JPEG')
  })
  it('checks the cover', () => {
    expectError({ mediaType: 'image', mediaUrls: ['https://x/a.jpg'], coverUrl: 'https://x/c.jpg' }, 'A cover is only for videos')
    expectError({ ...video, coverUrl: 'http://x/c.jpg' }, 'https://')
    expectError({ ...video, coverUrl: 'https://x/c.png' }, 'The cover must be a JPEG')
    expect(validate(draft({ ...video, coverUrl: 'https://x/c.jpg' }), true)).toEqual([])
  })
  it('checks video length per platform only when known', () => {
    const got = validate(draft({ ...video, account: linked, platforms: ['facebook', 'x'], videoSeconds: 120 }), true).join('|')
    expect(got).toContain('Facebook Page takes videos of 3 s to 90 s')
    expect(got).toContain('this one is 120 s')
    expect(got).not.toContain('X takes')
    expect(validate(draft({ ...video, account: linked, platforms: ['facebook', 'x'], videoSeconds: null }), true)).toEqual([])
  })
  it('needs a vertical, at least 540 px wide clip for Facebook, only when the size is known', () => {
    const fb = (videoWidth: number | null, videoHeight: number | null, platforms: Platform[] = ['facebook']) =>
      validate(draft({ ...video, account: linked, platforms, videoWidth, videoHeight }), true)
    expect(fb(1920, 1080)).toEqual(['Facebook Reels need a vertical video at least 540 px wide: this one is 1920×1080'])
    expect(fb(480, 854)).toHaveLength(1)
    expect(fb(1080, 1080)).toHaveLength(1)
    expect(fb(540, 960)).toEqual([])
    expect(fb(null, null)).toEqual([])
    expect(fb(1920, 1080, ['x'])).toEqual([])
  })
})
