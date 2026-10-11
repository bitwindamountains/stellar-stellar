export const API_PLATFORMS = ['facebook', 'instagram'] as const
export const ASSISTED_PLATFORMS = ['fb_profile', 'tiktok', 'youtube'] as const
export type Platform = (typeof API_PLATFORMS)[number] | (typeof ASSISTED_PLATFORMS)[number]
export const PLATFORMS: Platform[] = [...API_PLATFORMS, ...ASSISTED_PLATFORMS]

export const PLATFORM_NAMES: Record<Platform, string> = {
  facebook: 'Facebook Page',
  instagram: 'Instagram',
  fb_profile: 'My profile',
  tiktok: 'TikTok',
  youtube: 'YouTube',
}
export const PLATFORM_CODES: Record<Platform, string> = {
  facebook: 'FB',
  instagram: 'IG',
  fb_profile: 'ME',
  tiktok: 'TT',
  youtube: 'YT',
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
  tg_message_id: string
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

/** Same rule as the publisher: a filled ID means the platform is done for this post. */
export function isDone(post: Post, p: Platform): boolean {
  if (p === 'facebook') return post.fb_post_id !== ''
  if (p === 'instagram') return post.ig_media_id !== ''
  return post.tg_message_id !== ''
}
