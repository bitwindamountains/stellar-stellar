// Pure selection logic and routes for the five screens. `now` and `tz` are always passed in.
import { groupPosts, type PostGroup } from './groups'
import { awaitingHandoff } from './postView'
import { utcToZoned } from './time'
import { isDone, sentByHand, type Account, type Post } from './types'

export type HistoryFilter = 'all' | 'facebook' | 'instagram' | 'hand'

const STALE_MS = 30 * 60_000
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export const localDay = (iso: string, tz: string): string => utcToZoned(iso, tz).slice(0, 10)

export function isStale(post: Post, now: Date): boolean {
  return post.status === 'posting' && !!post.claimed_at && now.getTime() - Date.parse(post.claimed_at) > STALE_MS
}

export function needsAttention(post: Post, now: Date): boolean {
  return ['failed', 'missed', 'partial'].includes(post.status) || isStale(post, now) || awaitingHandoff(post)
}

const live = (g: PostGroup) => g.rows.some((r) => r.status === 'scheduled' || r.status === 'posting')
const when = (g: PostGroup) => g.lead.publish_at ?? ''
const postedOf = (g: PostGroup) => g.rows.reduce((m, r) => (r.posted_at && r.posted_at > m ? r.posted_at : m), '')
const byTime = (a: PostGroup, b: PostGroup) => when(a).localeCompare(when(b)) || a.lead.num - b.lead.num
const newest = (a: PostGroup, b: PostGroup) => b.lead.num - a.lead.num

function plannedOn(posts: Post[], day: string, tz: string): PostGroup[] {
  return groupPosts(posts)
    .filter((g) => g.lead.publish_at && localDay(g.lead.publish_at, tz) === day && live(g))
    .sort(byTime)
}

export function todayView(posts: Post[], now: Date, tz: string) {
  const groups = groupPosts(posts)
  const needsYou = groups
    .filter((g) => g.rows.some((r) => needsAttention(r, now)))
    .sort((a, b) => when(b).localeCompare(when(a)) || newest(a, b))
  // A stuck (stale) or half-done (partial) post is a problem to check, so it shows only under Needs you.
  const held = (g: PostGroup) => g.rows.some((r) => isStale(r, now) || r.status === 'partial')
  const goingOut = plannedOn(posts, localDay(now.toISOString(), tz), tz).filter((g) => !held(g))
  const today = localDay(now.toISOString(), tz)
  const outToday = groups
    .filter((g) => g.lead.posted_at && localDay(g.lead.posted_at, tz) === today && !goingOut.includes(g))
    .sort((a, b) => postedOf(b).localeCompare(postedOf(a)))
  return { needsYou, goingOut, outToday }
}

export const plannedDay = plannedOn

export function weekDays(posts: Post[], start: string, tz: string) {
  const [y, m, d] = start.split('-').map(Number)
  return Array.from({ length: 7 }, (_, i) => {
    const t = new Date(Date.UTC(y, m - 1, d + i))
    const day = t.toISOString().slice(0, 10)
    return {
      day,
      weekday: t.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
      date: t.getUTCDate(),
      count: plannedOn(posts, day, tz).length,
    }
  })
}

// Post has no created_at in the app; num rises with creation, so it orders drafts.
export function draftGroups(posts: Post[]): PostGroup[] {
  return groupPosts(posts).filter((g) => g.rows.every((r) => r.status === 'draft')).sort(newest)
}

export function historyGroups(
  posts: Post[],
  filter: HistoryFilter,
  accountOf: (id: number) => Account | undefined,
): PostGroup[] {
  const match = (r: Post) =>
    filter === 'all' ||
    (filter === 'hand' ? r.platforms.some((p) => sentByHand(r, p, accountOf(r.account_id))) : isDone(r, filter))
  return groupPosts(posts)
    .filter((g) => g.rows.some((r) => r.status === 'posted') && g.rows.some(match))
    .sort((a, b) => postedOf(b).localeCompare(postedOf(a)))
}

export type Route =
  | { screen: 'today' }
  | { screen: 'planned'; day?: string }
  | { screen: 'history' }
  | { screen: 'post'; num: number }
  | { screen: 'new'; day?: string }
  | { screen: 'edit'; num: number }
  | { screen: 'handoff'; num: number }
  | { screen: 'accounts' }

export function parseRoute(parts: string[], query: URLSearchParams): Route {
  const q = query.get('day')
  const day = q && DAY_RE.test(q) ? q : undefined
  const num = /^\d+$/.test(parts[1] ?? '') ? Number(parts[1]) : NaN
  const today: Route = { screen: 'today' }
  switch (parts[0]) {
    case 'planned': return { screen: 'planned', day }
    case 'history': return parts.length > 1 ? (isNaN(num) ? today : { screen: 'post', num }) : { screen: 'history' }
    case 'new': return { screen: 'new', day }
    case 'edit': return isNaN(num) ? today : { screen: 'edit', num }
    case 'handoff': return isNaN(num) ? today : { screen: 'handoff', num }
    case 'accounts': return { screen: 'accounts' }
    default: return today
  }
}
