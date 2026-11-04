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

export interface PlatformStats {
  as_of: string
  views?: number
  reach?: number
  likes?: number
  comments?: number
  shares?: number
  top_comments?: { author: string; text: string; likes: number; at: string }[]
}
export type PostStats = Partial<Record<'facebook' | 'instagram', PlatformStats>>

export interface Post {
  num: number
  account_id: number
  group_id: string | null // rows of one post sent to several accounts share it
  platforms: Platform[]
  publish_at: string | null
  caption: string
  first_comment: string
  cover_url: string
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
  fb_comment_id: string // may hold the sentinels 'not-added' / 'unclear': not a real ID
  ig_comment_id: string
  stats: PostStats
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

/** Can this account post p at all? Automatic platforms need their login or IDs; by-hand ones always work. */
export function canPost(p: Platform, account: Account | undefined): boolean {
  if (!account) return false
  const meta = !!account.token_env || isConnected(account, 'meta')
  if (p === 'facebook') return !!account.fb_page_id && meta
  if (p === 'instagram') return !!account.ig_user_id && meta
  if (p === 'x') return isConnected(account, 'x')
  return true
}

/** Will this account post p by hand? Same rule as Account.by_api in the publisher. */
export function byHand(p: Platform, account: Account | undefined): boolean {
  return isAssisted(p) && !(p === 'tiktok' && isConnected(account, 'tiktok'))
}

/** Did (or will) this post go out by hand on p? Pass the account when known: it decides a TikTok not yet sent. */
export function sentByHand(post: Post, p: Platform, account?: Account): boolean {
  if (p !== 'tiktok') return isAssisted(p)
  if (post.tiktok_id) return post.tiktok_id === SENT_BY_HAND
  // The phone handoff already went out without TikTok, so TikTok is the automatic upload (maybe still retrying).
  if (post.tg_message_id) return false
  return byHand('tiktok', account)
}

/** Uploaded to your TikTok drafts (inbox): you finish it in TikTok with the caption. Same as FINISH_IN_APP. */
export function isDraft(post: Post, p: Platform): boolean {
  return p === 'tiktok' && post.tiktok_id !== '' && post.tiktok_id !== SENT_BY_HAND
}

/** Something for you to do on your phone: posting by hand, or finishing a draft. */
export function needsFinishing(post: Post, p: Platform, account?: Account): boolean {
  return sentByHand(post, p, account) || isDraft(post, p)
}

/** Live on a platform that posted it automatically: such a post must not be deleted from the app. */
export function postedByApi(post: Post): boolean {
  return !!(post.fb_post_id || post.ig_media_id || post.x_post_id || (post.tiktok_id && post.tiktok_id !== SENT_BY_HAND))
}

/** Same rule as the publisher: a filled ID means the platform is done for this post. */
export function isDone(post: Post, p: Platform): boolean {
  if (p === 'facebook') return post.fb_post_id !== ''
  if (p === 'instagram') return post.ig_media_id !== ''
  if (p === 'x') return post.x_post_id !== ''
  if (p === 'tiktok') return post.tiktok_id !== ''
  return post.tg_message_id !== ''
}
