// Mirror of src/postpilot/validation.py for instant feedback. The publisher re-checks; keep messages in sync.
import { textFor, titleFor, type Variants } from './content'
import { PLATFORM_NAMES, type Account, type MediaType, type Platform } from './types'

export const IG_CAPTION_MAX = 2200
export const IG_HASHTAGS_MAX = 30
export const TELEGRAM_MESSAGE_MAX = 4096
const TELEGRAM_OVERHEAD = 60 // platform label line and title label (Telegram counts text after parsing tags)
const NON_JPEG = /\.(png|webp|gif)$/i // links with no extension get the benefit of the doubt

export const YOUTUBE_TITLE_MAX = 100

export interface Draft {
  account: Account | undefined
  platforms: Platform[]
  publishAt: string // datetime-local value, may be ''
  caption: string
  variants: Variants
  mediaType: MediaType
  mediaUrls: string[]
  link: string
}

export function hashtagCount(text: string): number {
  return (text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length
}

export function validate(d: Draft, requireTime: boolean): string[] {
  const errors: string[] = []
  const has = (p: Platform) => d.platforms.includes(p)
  const text = (p: Platform) => textFor(d.caption, d.variants, p)
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
    else if (urls[0] && NON_JPEG.test(urls[0].split(/[?#]/)[0])) errors.push('Instagram needs a JPEG image (PNG, WebP and GIF are rejected at post time)')
    if (text('instagram').length > IG_CAPTION_MAX)
      errors.push(`Instagram captions max ${IG_CAPTION_MAX.toLocaleString('en')} characters`)
    if (hashtagCount(text('instagram')) > IG_HASHTAGS_MAX) errors.push(`Instagram allows at most ${IG_HASHTAGS_MAX} hashtags`)
  }
  if (has('facebook') && !(text('facebook') || d.link || urls.length)) errors.push('Facebook post is empty: add a caption, link or image')
  if ((has('tiktok') || has('youtube')) && d.mediaType !== 'video') errors.push('TikTok/YouTube need a video')
  for (const p of ['fb_profile', 'tiktok', 'youtube'] as const) {
    if (!has(p)) continue
    // Telegram's 4,096 limit counts text after it parses the HTML: visible text, link, title, labels.
    const body = p === 'fb_profile' && d.link ? `${text(p)}\n\n${d.link}` : text(p)
    const size = body.length + titleFor(d.variants, p).length + TELEGRAM_OVERHEAD
    if (size > TELEGRAM_MESSAGE_MAX)
      errors.push(`${PLATFORM_NAMES[p]} caption too long for the phone handoff: shorten it by ${(size - TELEGRAM_MESSAGE_MAX).toLocaleString('en')} characters`)
  }
  if (titleFor(d.variants, 'youtube').length > YOUTUBE_TITLE_MAX) errors.push(`YouTube titles max ${YOUTUBE_TITLE_MAX} characters`)
  return errors
}
