// Mirror of src/postpilot/models.py. TikTok is by hand until the account connects TikTok (see byHand).
export const API_PLATFORMS = ['facebook', 'instagram', 'x'] as const
export const ASSISTED_PLATFORMS = ['fb_profile', 'tiktok', 'youtube', 'shopee'] as const
export type Platform = (typeof API_PLATFORMS)[number] | (typeof ASSISTED_PLATFORMS)[number]
export const PLATFORMS: Platform[] = [...API_PLATFORMS, ...ASSISTED_PLATFORMS]
/** Saved logins (table `connections`); 'meta' covers Facebook and Instagram. */
export type Connection = 'meta' | 'x' | 'tiktok'
export const SENT_BY_HAND = 'telegram' // tiktok_id when TikTok went out through the phone handoff

export const PLATFORM_NAMES: Record<Platform, string> = {
  facebook: 'Facebook Page',
  instagram: 'Instagram',
  x: 'X',
  fb_profile: 'My profile',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  shopee: 'Shopee',
}
export const PLATFORM_CODES: Record<Platform, string> = {
  facebook: 'FB',
  instagram: 'IG',
  x: 'X',
  fb_profile: 'ME',
  tiktok: 'TT',
  youtube: 'YT',
  shopee: 'SP',
}

export type Status = 'draft' | 'scheduled' | 'posting' | 'posted' | 'partial' | 'failed' | 'missed'
export type MediaType = 'none' | 'image' | 'video'

export interface Account {
  id: number
  name: string
  fb_page_id: string
  ig_user_id: string
  token_env: string
  timezone: string
  connections?: { platform: Connection; handle: string }[] // loaded with select('*, connections(platform, handle)')
}

export const ACCOUNT_SELECT = '*, connections(platform, handle)'

export function isConnected(account: Account | undefined, c: Connection): boolean {
  return !!account?.connections?.some((x) => x.platform === c)
}

export interface Post {
  num: number
  account_id: number
  platforms: Platform[]
  publish_at: string | null
  caption: string
  media_type: MediaType
  media_urls: string[]
  link: string
  status: Status
  attempts: number
  claimed_at: string | null
  fb_post_id: string
  fb_permalink: string
  ig_media_id: string
  ig_permalink: string
  x_post_id: string
  x_permalink: string
  tiktok_id: string
  tiktok_permalink: string
  tg_message_id: string
  variants: Partial<Record<Platform, { caption?: string; hashtags?: string; title?: string }>>
  assist_done_at: string | null
  last_error: string
  posted_at: string | null
}

export interface Run {
  id: number
  ran_at: string
  duration_ms: number
  posted: number
  partial: number
  failed: number
  missed: number
}

export function isAssisted(p: Platform): boolean {
  return (ASSISTED_PLATFORMS as readonly string[]).includes(p)
}

/** Will this account post p by hand? Same rule as Account.by_api in the publisher. */
export function byHand(p: Platform, account: Account | undefined): boolean {
  return isAssisted(p) && !(p === 'tiktok' && isConnected(account, 'tiktok'))
}

/** Did (or will) this post go out by hand on p? TikTok counts once it has a real API ID. */
export function sentByHand(post: Post, p: Platform): boolean {
  return isAssisted(p) && !(p === 'tiktok' && post.tiktok_id !== '' && post.tiktok_id !== SENT_BY_HAND)
}

/** Same rule as the publisher: a filled ID means the platform is done for this post. */
export function isDone(post: Post, p: Platform): boolean {
  if (p === 'facebook') return post.fb_post_id !== ''
  if (p === 'instagram') return post.ig_media_id !== ''
  if (p === 'x') return post.x_post_id !== ''
  if (p === 'tiktok') return post.tiktok_id !== ''
  return post.tg_message_id !== ''
}
