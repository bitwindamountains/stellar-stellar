import { describe, expect, it } from 'vitest'
import { cleanVariants, isCustomized, textFor, titleFor } from './content'

describe('per-platform text (mirrors models.py)', () => {
  it('falls back to the base caption', () => {
    expect(textFor('Base caption', {}, 'facebook')).toBe('Base caption')
  })
  it('applies overrides and hashtags', () => {
    const v = { instagram: { caption: 'IG words', hashtags: '#kape #manila' }, tiktok: { hashtags: '#fyp' } }
    expect(textFor('Base caption', v, 'instagram')).toBe('IG words\n\n#kape #manila')
    expect(textFor('Base caption', v, 'tiktok')).toBe('Base caption\n\n#fyp')
  })
  it('treats blank overrides as unset', () => {
    expect(textFor('Base caption', { facebook: { caption: '  ', hashtags: '' } }, 'facebook')).toBe('Base caption')
    expect(isCustomized({ facebook: { caption: ' ' } }, 'facebook')).toBe(false)
  })
  it('titles are per platform', () => {
    expect(titleFor({ youtube: { title: 'Latte art' } }, 'youtube')).toBe('Latte art')
    expect(titleFor({ youtube: { title: 'Latte art' } }, 'tiktok')).toBe('')
  })
  it('cleans blank fields and unselected platforms', () => {
    expect(cleanVariants({ youtube: { title: 'T', caption: '' }, tiktok: { hashtags: '#x' }, facebook: { caption: ' ' } }, ['youtube', 'facebook']))
      .toEqual({ youtube: { title: 'T' } })
  })
})
