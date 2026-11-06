import type { Variants } from './content'
import { failedPlatforms, mediaWasRemoved, PLATFORM_COLUMNS } from './postView'
import { saveDraft } from './prefs'
import { go } from './route'
import { supabase } from './supabase'
import type { Post } from './types'

/** Ask the publisher to run now. Without the dispatch function deployed, the next 30-minute run picks it up. */
export async function publishSoon(): Promise<void> {
  await supabase.functions.invoke('dispatch').catch(() => undefined)
}

/** Requeue a failed or missed post to go out now. Platforms that already have an ID are never posted again. */
export async function retryNow(num: number): Promise<string | null> {
  const { error } = await supabase
    .from('posts')
    .update({ status: 'scheduled', publish_at: new Date().toISOString(), attempts: 0, last_error: '', claimed_at: null })
    .eq('num', num)
    .in('status', ['failed', 'missed'])
  if (error) return error.message
  await publishSoon()
  return null
}

/** Requeue a failed post but redo only the platforms that failed; the ones that went out keep their IDs. */
export async function repostFailed(post: Post): Promise<string | null> {
  if (mediaWasRemoved(post)) return 'The original file was removed, so it cannot be reposted. Use Post again and add it again.'
  const clear = Object.fromEntries(failedPlatforms(post).flatMap((p) => (PLATFORM_COLUMNS[p] ?? []).map((c) => [c, ''])))
  const { data, error } = await supabase
    .from('posts')
    .update({ ...clear, status: 'scheduled', publish_at: new Date().toISOString(), attempts: 0, last_error: '', claimed_at: null })
    .eq('num', post.num)
    .eq('last_error', post.last_error) // a stale page must not clear a platform that succeeded since
    .in('status', ['failed', 'missed'])
    .select('num')
  if (error) return error.message
  if (!data?.length) return 'This post changed; reload'
  await publishSoon()
  return null
}

/** Copies a post (all its account rows) into a fresh "now" draft and opens New post; nothing posts until Save. */
export function startPostAgain(rows: Post[]): void {
  const lead = rows[0]
  // An upload is removed once the post is finished (publisher cleanup), so don't copy a dead link.
  const gone = rows.some(mediaWasRemoved)
  saveDraft({
    targets: Object.fromEntries(rows.map((r) => [r.account_id, r.platforms])),
    caption: lead.caption, firstComment: lead.first_comment, variants: (lead.variants as Variants) ?? {}, link: lead.link,
    mode: 'now', publishAt: '',
    mediaType: gone ? 'none' : lead.media_type,
    mediaUrl: gone ? '' : lead.media_urls[0] ?? '',
    coverUrl: gone ? '' : lead.cover_url ?? '',
    ...(gone ? {} : { videoSeconds: lead.video_seconds ?? null, videoWidth: lead.video_width ?? null, videoHeight: lead.video_height ?? null }),
    note: gone ? 'The original file was removed after the post went out. Add it again.' : undefined,
  })
  go('/new')
}
