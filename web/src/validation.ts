// Mirror of src/postpilot/validation.py for instant feedback. The publisher re-checks; keep messages in sync.
import type { Account, MediaType, Platform } from './types'

export const IG_CAPTION_MAX = 2200
export const IG_HASHTAGS_MAX = 30
export const TELEGRAM_TEXT_MAX = 4096

export interface Draft {
  account: Account | undefined
  platforms: Platform[]
  publishAt: string // datetime-local value, may be ''
  caption: string
  mediaType: MediaType
  mediaUrls: string[]
  link: string
}

export function hashtagCount(caption: string): number {
  return (caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length
}

export function validate(d: Draft, requireTime: boolean): string[] {
  const errors: string[] = []
  const has = (p: Platform) => d.platforms.includes(p)
  const api = has('facebook') || has('instagram')
  if (!d.account) errors.push('Pick an account')
  if (d.platforms.length === 0) errors.push('Pick at least one platform')
  if (d.account) {
    if (has('facebook') && !d.account.fb_page_id) errors.push(`Account '${d.account.name}' has no Facebook Page ID`)
    if (has('instagram') && !d.account.ig_user_id) errors.push(`Account '${d.account.name}' has no Instagram user ID`)
    if (api && !d.account.token_env) errors.push(`Account '${d.account.name}' has no token secret name`)
  }
  if (requireTime && !d.publishAt) errors.push('Set when to post')

  const urls = d.mediaUrls
  if (d.mediaType !== 'none' && urls.length === 0) errors.push(`Add the ${d.mediaType}`)
  if (urls.some((u) => !u.toLowerCase().startsWith('https://'))) errors.push('Media link must start with https://')
  if (urls.some((u) => u.toLowerCase().includes('drive.google.com')))
    errors.push("Google Drive links open a web page, not the file: use a direct link or upload the file")
  if (urls.length > 1) errors.push('Only one image per post for now (carousels come later)')

  if (d.mediaType === 'video' && api)
    errors.push("Video to Facebook/Instagram isn't supported yet; use TikTok, YouTube or your profile for now")
  if (has('instagram')) {
    if (d.mediaType !== 'image') errors.push('Instagram needs an image')
    if (d.caption.length > IG_CAPTION_MAX)
      errors.push(`Instagram captions max ${IG_CAPTION_MAX.toLocaleString('en')} characters`)
    if (hashtagCount(d.caption) > IG_HASHTAGS_MAX) errors.push(`Instagram allows at most ${IG_HASHTAGS_MAX} hashtags`)
  }
  if (has('facebook') && !(d.caption || d.link || urls.length)) errors.push('Facebook post is empty: add a caption, link or image')
  if ((has('tiktok') || has('youtube')) && d.mediaType !== 'video') errors.push('TikTok/YouTube need a video')
  const assisted = has('fb_profile') || has('tiktok') || has('youtube')
  if (assisted && d.caption.length > TELEGRAM_TEXT_MAX)
    errors.push(`Caption too long for the phone handoff (max ${TELEGRAM_TEXT_MAX.toLocaleString('en')})`)
  return errors
}
