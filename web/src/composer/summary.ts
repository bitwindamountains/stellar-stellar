// One-line summaries for the composer's setting rows (Where, When, Link).
import type { Targets } from '../prefs'
import { zonedToUtc } from '../time'
import { PLATFORMS, type Account, type Platform } from '../types'

const SHORT: Record<Platform, string> = { facebook: 'FB', instagram: 'IG', x: 'X', fb_profile: 'Profile', tiktok: 'TikTok', youtube: 'YouTube', shopee: 'Shopee' }

/** `fb · FB, IG`, `2 accounts · FB, IG, Profile`, or `Nowhere yet`. */
export function whereSummary(targets: Targets, accounts: Account[]): string {
  const active = accounts.filter((a) => targets[a.id]?.length)
  if (!active.length) return 'Nowhere yet'
  const picked = PLATFORMS.filter((p) => active.some((a) => targets[a.id].includes(p))).map((p) => SHORT[p]).join(', ')
  return `${active.length === 1 ? active[0].name : `${active.length} accounts`} · ${picked}`
}

/** `Now`, or the wall-clock time (already in `tz`) as `Mon 2 Nov, 18:36`. Built from parts so no locale reorders it. */
export function whenSummary(mode: 'now' | 'later', publishAt: string, tz: string, locale?: string): string {
  if (mode === 'now') return 'Now'
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(publishAt)) return 'Pick a time'
  const parts = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz })
    .formatToParts(new Date(zonedToUtc(publishAt, tz)))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((x) => x.type === type)?.value ?? ''
  return `${get('weekday')} ${get('day')} ${get('month')}, ${get('hour')}:${get('minute')}`
}

/** `—`, the link's host, or (not a valid link) its raw text cut to 24 characters. */
export function linkSummary(link: string): string {
  const raw = link.trim()
  if (!raw) return '—'
  try {
    return new URL(raw).hostname || raw.slice(0, 24)
  } catch {
    return raw.slice(0, 24)
  }
}
