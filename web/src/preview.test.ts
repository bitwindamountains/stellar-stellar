import { describe, expect, it } from 'vitest'
import { IG_FOLD, previewText } from './preview'

const d = (over = {}) => ({ caption: 'Hello', variants: {}, link: '', ...over })

describe('previewText', () => {
  it('folds long Instagram captions', () => {
    const long = previewText('instagram', d({ caption: 'a'.repeat(200) }))
    expect(long.more).toBe(true)
    expect(long.text.length).toBe(IG_FOLD)
    expect(previewText('instagram', d()).more).toBe(false)
  })

  it('adds the link on Facebook, uses overrides and titles', () => {
    expect(previewText('facebook', d({ link: 'https://a.co' })).text).toBe('Hello\n\nhttps://a.co')
    const yt = previewText('youtube', d({ variants: { youtube: { title: 'T', caption: 'Desc' } } }))
    expect([yt.title, yt.text]).toEqual(['T', 'Desc'])
  })

  it('counts X like X does', () => {
    expect(previewText('x', d({ link: 'https://example.com/very/long/path' })).count?.used).toBe(5 + 2 + 23) // caption, blank line, link
  })
})
