// One post sent to several accounts is one row per account sharing a group_id; the app shows it as one item.
import { awaitingHandoff, statusLabel } from './postView'
import type { Platform, Post } from './types'

export interface PostGroup {
  key: string
  lead: Post // lowest num: its time and caption stand for the group
  rows: Post[]
}

export function groupPosts(posts: Post[]): PostGroup[] {
  const byKey = new Map<string, Post[]>()
  for (const p of posts) {
    const key = p.group_id ?? `n${p.num}`
    byKey.set(key, [...(byKey.get(key) ?? []), p])
  }
  return [...byKey].map(([key, rows]) => {
    rows.sort((a, b) => a.num - b.num)
    return { key, lead: rows[0], rows }
  })
}

// The most urgent row speaks for the group.
const RANK = ['posting', 'failed', 'missed', 'partial', 'assist', 'scheduled', 'draft', 'posted']

export function groupStatus(rows: Post[]): { text: string; tone: string } {
  const labels = rows.map((r) => statusLabel(r))
  return labels.sort((a, b) => RANK.indexOf(a.tone) - RANK.indexOf(b.tone))[0]
}

/** Where tapping the group goes: a row waiting for you on your phone first, how it did once all went out, else the editor. */
export function groupHref(rows: Post[]): string {
  const handoff = rows.find(awaitingHandoff)
  if (handoff) return `#/handoff/${handoff.num}`
  return rows.every((r) => r.status === 'posted') ? `#/history/${rows[0].num}` : `#/edit/${rows[0].num}`
}

/** Live links to the post, per platform that gave one. */
export function postLinks(post: Post): { platform: Platform; url: string }[] {
  const links: [Platform, string][] = [
    ['facebook', post.fb_permalink],
    ['instagram', post.ig_permalink],
    ['x', post.x_permalink],
    ['tiktok', post.tiktok_permalink],
  ]
  return links.filter(([, url]) => url.startsWith('https://')).map(([platform, url]) => ({ platform, url }))
}
