import { isDone, needsFinishing, PLATFORM_CODES, PLATFORM_NAMES, type Platform, type Post } from './types'

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

export function needsYou(post: Post): boolean {
  return ['failed', 'missed'].includes(post.status) || awaitingHandoff(post)
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

const DAY_MS = 86_400_000

function dayStart(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Groups posts by local calendar day, soonest first; undated drafts go last. */
export function groupByDay(posts: Post[], now = new Date()) {
  const today = dayStart(now)
  const groups = new Map<string, { label: string; date: string; posts: Post[] }>()
  const sorted = [...posts].sort((a, b) => (a.publish_at ?? '9999').localeCompare(b.publish_at ?? '9999'))
  for (const post of sorted) {
    let key = 'undated'
    let label = 'No date yet'
    let date = ''
    if (post.publish_at) {
      const d = new Date(post.publish_at)
      const offset = Math.round((dayStart(d) - today) / DAY_MS)
      key = String(dayStart(d))
      label = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : offset === -1 ? 'Yesterday'
        : d.toLocaleDateString(undefined, { weekday: 'long' })
      date = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()
    }
    if (!groups.has(key)) groups.set(key, { label, date, posts: [] })
    groups.get(key)!.posts.push(post)
  }
  return [...groups.values()]
}

export function timeOf(iso: string | null): string {
  return iso ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }) : '--:--'
}

/**
 * One-tap retry is only offered when the post certainly didn't go out. "Check if it posted" and
 * "run stopped" failures may already be live, so those need a look first.
 */
export function canRetry(post: Post): boolean {
  return ['failed', 'missed'].includes(post.status) && !/check|stopped/i.test(post.last_error)
}

/** Today and the next 6 days, with how many live posts each has (failed and missed don't count). */
export function weekStrip(posts: Post[], now = new Date()) {
  const today = dayStart(now)
  return Array.from({ length: 7 }, (_, i) => {
    const start = new Date(today)
    start.setDate(start.getDate() + i) // calendar days, so DST shifts can't skip or repeat a day
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    const count = posts.filter((p) => {
      if (!p.publish_at || ['failed', 'missed'].includes(p.status)) return false
      const t = new Date(p.publish_at).getTime()
      return t >= start.getTime() && t < end.getTime()
    }).length
    return {
      key: start.toISOString(),
      label: i === 0 ? 'Today' : start.toLocaleDateString(undefined, { weekday: 'short' }),
      date: start.getDate(),
      count,
    }
  })
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
