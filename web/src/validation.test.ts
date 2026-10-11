import { describe, expect, it } from 'vitest'
import type { Account } from './types'
import { hashtagCount, validate, type Draft } from './validation'

const account: Account = { id: 1, name: 'Kape', fb_page_id: 'P', ig_user_id: 'I', token_env: 'META_TOKEN_KAPE', timezone: 'Asia/Manila' }
const draft = (over: Partial<Draft>): Draft => ({
  account, platforms: ['facebook'], publishAt: '2026-10-05T18:00', caption: 'Hi', mediaType: 'none', mediaUrls: [], link: '', ...over,
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
  it('drafts may skip the time', () => {
    expect(validate(draft({ publishAt: '' }), false)).toEqual([])
  })
  it('counts hashtags like the publisher', () => {
    expect(hashtagCount('#kape #manila_cafe no#tag #')).toBe(3)
  })
})
