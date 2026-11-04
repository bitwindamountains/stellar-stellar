import type { PostGroup } from './groups'
import { isDone, needsFinishing, PLATFORM_CODES, PLATFORM_NAMES, type Platform, type PlatformStats, type Post, type Run } from './types'

export type ChipState = 'done' | 'queued' | 'assist' | 'retry'

export function chipState(post: Post, p: Platform): ChipState {
  if (isDone(post, p)) return needsFinishing(post, p) && !post.assist_done_at ? 'assist' : 'done'
  if (['partial', 'failed'].includes(post.status) && post.last_error.includes(p)) return 'retry'
  return 'queued'
}

const STATE_WORDS: Record<ChipState, string> = {
  done: 'posted',
  queued: 'scheduled',
  assist: 'waiting for you on your phone',
  retry: 'problem',
}

export function chips(post: Post) {
  return post.platforms.map((p) => {
    const state = chipState(post, p)
    return { platform: p, code: PLATFORM_CODES[p], state, label: `${PLATFORM_NAMES[p]}: ${STATE_WORDS[state]}` }
  })
}

/** Hand-posting still to do: sent to Telegram but not marked done in the app. */
export function awaitingHandoff(post: Post): boolean {
  return post.tg_message_id !== '' && !post.assist_done_at
}

export function statusLabel(post: Post, maxAttempts = 3): { text: string; tone: string } {
  if (awaitingHandoff(post)) return { text: 'By hand', tone: 'assist' }
  switch (post.status) {
    case 'partial':
      return { text: `Retrying ${post.attempts}/${maxAttempts}`, tone: 'partial' }
    case 'posting':
      return { text: 'Posting…', tone: 'posting' }
    default:
      return { text: post.status[0].toUpperCase() + post.status.slice(1), tone: post.status }
  }
}

/**
 * One-tap retry is only offered when the post certainly didn't go out. "Check if it posted" and
 * "run stopped" failures may already be live, so those need a look first.
 */
export function canRetry(post: Post): boolean {
  // A failed platform that still has its ID (a Reel that failed processing) is skipped by a plain retry: needs Repost.
  const keepsId = failedPlatforms(post).some((p) => post[PLATFORM_COLUMNS[p]![0] as keyof Post] !== '')
  return ['failed', 'missed'].includes(post.status) && !/check|stopped/i.test(post.last_error) && !keepsId
}

// ID column first, then link and comment columns; clearing them is what lets the publisher post there again.
export const PLATFORM_COLUMNS: Partial<Record<Platform, string[]>> = {
  facebook: ['fb_post_id', 'fb_permalink', 'fb_comment_id'],
  instagram: ['ig_media_id', 'ig_permalink', 'ig_comment_id'],
  x: ['x_post_id', 'x_permalink'],
  tiktok: ['tiktok_id', 'tiktok_permalink'],
}

/** Automatic platforms a failed post names as "<platform>: …" in last_error (not "<platform> comment: …"). */
export function failedPlatforms(post: Post): Platform[] {
  if (post.status !== 'failed') return []
  const parts = post.last_error.replace(/^Gave up after \d+ attempt\(s\)\. /, '').split('; ')
  return post.platforms.filter((p) => parts.some((s) => s.startsWith(`${p}: `)))
}

/** "Last run 16:06 · 1 posted · 0 failed" (time in `tz`; missed counts as failed), or "No runs yet". */
export function runLine(run: Run | null, tz: string): string {
  if (!run) return 'No runs yet'
  const at = new Date(run.ran_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz })
  return `Last run ${at} · ${run.posted} posted · ${run.failed + run.missed} failed`
}

/** The post had media, but the handoff removed the upload and cleared its link (see Handoff.done). */
export function mediaWasRemoved(post: Post): boolean {
  return post.media_type !== 'none' && post.media_urls.length === 0
}

/** Combines query results into one list without duplicates (a post can match several queries). */
export function mergePosts(...lists: (unknown[] | null)[]): Post[] {
  const byNum = new Map<number, Post>()
  for (const list of lists) for (const p of (list ?? []) as Post[]) byNum.set(p.num, p)
  return [...byNum.values()]
}

/** 1200 -> 1.2k, 2000 -> 2k, 1000000 -> 1m. */
export function compact(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}m`
  if (n >= 1000) return `${+(n / 1000).toFixed(1)}k`
  return String(n)
}

/** "1.2k views · 48 likes · 6 comments"; reach stands in when views are missing. */
export function statsLine(s: PlatformStats): string {
  const parts: [number | undefined, string][] = [
    s.views != null ? [s.views, 'views'] : [s.reach, 'reach'],
    [s.likes, 'likes'],
    [s.comments, 'comments'],
    [s.shares, 'shares'],
  ]
  return parts.filter(([n]) => n != null).map(([n, label]) => `${compact(n!)} ${label}`).join(' · ')
}

export function ago(iso: string, now = new Date()): string {
  const min = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  if (min < 1440) return `${Math.floor(min / 60)} h ago`
  return `${Math.floor(min / 1440)} d ago`
}

/** Where a post in flight is: being posted, waiting for the run that picks it up, or out. */
export function flightStep(g: PostGroup): string {
  if (g.rows.some((r) => r.status === 'posting')) return 'Posting…'
  if (g.rows.some((r) => ['scheduled', 'partial'].includes(r.status))) return 'Waiting for the next run'
  return 'Posted'
}

/** Splits a row's last_error (parts joined by '; ', see runner.py): comment notes ("Comment … on Facebook") go to
 *  their platform, everything else is shown once. */
export function errorNotes(lastError: string, platform: 'facebook' | 'instagram' | undefined): { general: string; comment: string[] } {
  const parts = lastError ? lastError.split('; ') : []
  const about = (s: string) => /^Comment.*? on (Facebook|Instagram)/.exec(s)?.[1].toLowerCase()
  return {
    general: parts.filter((s) => !about(s)).join('; '),
    comment: parts.filter((s) => !!platform && about(s) === platform),
  }
}
