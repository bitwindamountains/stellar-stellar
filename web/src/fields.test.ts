import { describe, expect, it } from 'vitest'
import { bySection, sectionOf } from './fields'

describe('sectionOf', () => {
  it('puts each check under its section', () => {
    expect(sectionOf('Pick at least one platform')).toBe('where')
    expect(sectionOf("fb: Account 'fb' isn't linked to X: connect X on the Accounts page")).toBe('where')
    expect(sectionOf('Set when to post')).toBe('when')
    expect(sectionOf('Add the video')).toBe('media')
    expect(sectionOf('Instagram needs an image')).toBe('media')
    expect(sectionOf('fb: Only one media file per post for now')).toBe('media')
    expect(sectionOf('TikTok/YouTube need a video')).toBe('media')
    expect(sectionOf('Facebook post is empty: add a caption, link or image')).toBe('caption')
    expect(sectionOf('X posts max 280 characters (this one counts 300)')).toBe('caption')
    expect(sectionOf('YouTube titles max 100 characters')).toBe('caption')
  })

  it('groups in form order', () => {
    expect(bySection(['Set when to post', 'Add the image']).media).toEqual(['Add the image'])
  })
})
