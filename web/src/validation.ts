// Mirror of src/postpilot/validation.py for instant feedback. The publisher re-checks; keep messages in sync.
import { textFor, titleFor, type Variants } from './content'
import { byHand, isAssisted, isConnected, PLATFORM_NAMES, type Account, type MediaType, type Platform } from './types'

export const IG_CAPTION_MAX = 2200
export const IG_HASHTAGS_MAX = 30
export const IG_COMMENT_MAX = 2200 // Meta documents no comment limits; the caption limit is the safe bound
export const TELEGRAM_MESSAGE_MAX = 4096
const TELEGRAM_OVERHEAD = 60 // platform label line and title label (Telegram counts text after parsing tags)
const NON_JPEG = /\.(png|webp|gif|heic|heif|avif|bmp|tiff?|svg)$/i // links with no extension get the benefit of the doubt

// ponytail: FB/IG limits unconfirmed against Meta docs (X's 140 s is from docs.x.com); recheck before relying.
// Reel/video length limits in seconds [min, max] (Meta Reel specs, X media docs).
const VIDEO_SECONDS: Partial<Record<Platform, [number, number]>> = { facebook: [3, 90], instagram: [3, 900], x: [0, 140] }
const fmtSeconds = (s: number) => (s >= 60 && s % 60 === 0 ? `${s / 60} min` : `${s} s`)

export const YOUTUBE_TITLE_MAX = 100
export const X_TEXT_MAX = 280
export const TIKTOK_CAPTION_MAX = 2200
// X counts any link as 23, with or without https://. Same TLD list as validation.py (common ones only).
const TLDS = 'com|net|org|info|biz|io|co|me|app|dev|ai|ly|gg|tv|xyz|shop|store|online|site|link|ph|sg|my|jp|us|uk|ca|au'
const URL_RE = new RegExp(`https?:\\/\\/\\S+|\\b(?:[a-z0-9-]+\\.)+(?:${TLDS})\\b(?:\\/\\S*)?`, 'gi')

/** X's weighted count (twitter-text v3): links 23, Latin-range characters 1, others (CJK, emoji) 2. */
export function xLength(text: string): number {
  let size = 23 * (text.match(URL_RE)?.length ?? 0)
  let joined = false
  let flagOpen = false
  for (const ch of text.replace(URL_RE, '')) {
    const cp = ch.codePointAt(0)!
    if (cp === 0x200d) { joined = true; continue } // zero-width joiner: the next emoji is part of the same picture
    // variation selector, skin tone, keycap, flag tag: no weight of their own
    if ((cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x1f3fb && cp <= 0x1f3ff) || cp === 0x20e3 || (cp >= 0xe0020 && cp <= 0xe007f)) continue
    if (joined) { joined = false; continue }
    if (cp >= 0x1f1e6 && cp <= 0x1f1ff) { // two regional indicators make one flag
      flagOpen = !flagOpen
      if (!flagOpen) continue
    } else flagOpen = false
    const light = cp <= 4351 || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247)
    size += light ? 1 : 2
  }
  return size
}

/** The text the publisher sends to X: the caption, then the link. */
export function xText(d: Pick<Draft, 'caption' | 'variants' | 'link'>): string {
  return [textFor(d.caption, d.variants, 'x'), d.link].filter(Boolean).join('\n\n')
}

export interface Draft {
  account: Account | undefined
  platforms: Platform[]
  publishAt: string // datetime-local value, may be ''
  caption: string
  variants: Variants
  mediaType: MediaType
  mediaUrls: string[]
  link: string
  firstComment?: string // undefined = none
  coverUrl?: string
  videoSeconds?: number | null // null/undefined = not measured yet: no duration check
  videoWidth?: number | null // pixels; null/undefined = unknown: no shape check
  videoHeight?: number | null
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
    if (api && !d.account.token_env && !isConnected(d.account, 'meta')) errors.push(`Account '${d.account.name}' isn't linked to Facebook: connect it on the Accounts page`)
    if (has('x') && !isConnected(d.account, 'x')) errors.push(`Account '${d.account.name}' isn't linked to X: connect X on the Accounts page`)
  }
  if (requireTime && !d.publishAt) errors.push('Set when to post')

  const urls = d.mediaUrls
  if (d.mediaType !== 'none' && urls.length === 0) errors.push(`Add the ${d.mediaType}`)
  if (urls.some((u) => !u.toLowerCase().startsWith('https://'))) errors.push('Media link must start with https://')
  if (urls.some((u) => u.toLowerCase().includes('drive.google.com')))
    errors.push("Google Drive links open a web page, not the file: use a direct link or upload the file")
  if (urls.length > 1) errors.push('Only one media file per post for now')

  const cover = d.coverUrl ?? ''
  if (cover) {
    if (d.mediaType !== 'video') errors.push('A cover is only for videos')
    if (!cover.toLowerCase().startsWith('https://')) errors.push('Cover link must start with https://')
    if (NON_JPEG.test(cover.split(/[?#]/)[0])) errors.push('The cover must be a JPEG')
  }
  if (d.mediaType === 'video' && d.videoSeconds != null) {
    for (const p of ['facebook', 'instagram', 'x'] as const) {
      const [min, max] = VIDEO_SECONDS[p]!
      if (has(p) && (d.videoSeconds > max || d.videoSeconds < min))
        errors.push(`${PLATFORM_NAMES[p]} takes videos of ${min ? `${fmtSeconds(min)} to ` : 'up to '}${fmtSeconds(max)}: this one is ${d.videoSeconds} s`)
    }
  }
  const [w, h] = [d.videoWidth, d.videoHeight]
  // Facebook Reels must be vertical and at least 540p, or Facebook fails them after they were accepted.
  if (d.mediaType === 'video' && has('facebook') && w && h && !(h > w && Math.min(w, h) >= 540))
    errors.push(`Facebook Reels need a vertical video at least 540 px wide: this one is ${w}×${h}`)
  if (has('instagram')) {
    if (d.mediaType !== 'image' && d.mediaType !== 'video') errors.push('Instagram needs an image or a video')
    else if (d.mediaType === 'image' && urls[0] && NON_JPEG.test(urls[0].split(/[?#]/)[0])) errors.push('Instagram needs a JPEG image (PNG, WebP and GIF are rejected at post time)')
    if (text('instagram').length > IG_CAPTION_MAX)
      errors.push(`Instagram captions max ${IG_CAPTION_MAX.toLocaleString('en')} characters`)
    if (hashtagCount(text('instagram')) > IG_HASHTAGS_MAX) errors.push(`Instagram allows at most ${IG_HASHTAGS_MAX} hashtags`)
  }
  if (has('facebook') && !(text('facebook') || d.link || urls.length)) errors.push('Facebook post is empty: add a caption, link or image')
  if ((has('tiktok') || has('youtube')) && d.mediaType !== 'video') errors.push('TikTok/YouTube need a video')
  if (has('x')) {
    const size = xLength(xText(d))
    if (size > X_TEXT_MAX) errors.push(`X posts max ${X_TEXT_MAX} characters (this one counts ${size.toLocaleString('en')})`)
  }
  if (has('tiktok') && !byHand('tiktok', d.account) && text('tiktok').length > TIKTOK_CAPTION_MAX)
    errors.push(`TikTok captions max ${TIKTOK_CAPTION_MAX.toLocaleString('en')} characters`)
  for (const p of ['fb_profile', 'tiktok', 'youtube', 'shopee'] as const) {
    if (!has(p)) continue
    // Telegram's 4,096 limit counts text after it parses the HTML: visible text, link, title, labels.
    const body = p === 'fb_profile' && d.link ? `${text(p)}\n\n${d.link}` : text(p)
    const size = body.length + titleFor(d.variants, p).length + TELEGRAM_OVERHEAD
    if (size > TELEGRAM_MESSAGE_MAX)
      errors.push(`${PLATFORM_NAMES[p]} caption too long for the phone handoff: shorten it by ${(size - TELEGRAM_MESSAGE_MAX).toLocaleString('en')} characters`)
  }
  const first = d.firstComment ?? ''
  if (first) {
    if (has('instagram')) {
      if (first.length > IG_COMMENT_MAX) errors.push(`First comment: Instagram allows at most ${IG_COMMENT_MAX.toLocaleString('en')} characters`)
    }
    // Every assisted platform gets the comment in Telegram, connected TikTok drafts included.
    if (d.platforms.some(isAssisted) && first.length + TELEGRAM_OVERHEAD > TELEGRAM_MESSAGE_MAX)
      errors.push('First comment too long for the phone handoff')
  }
  if (titleFor(d.variants, 'youtube').length > YOUTUBE_TITLE_MAX) errors.push(`YouTube titles max ${YOUTUBE_TITLE_MAX} characters`)
  return errors
}
